import express from 'express';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import { pool } from '../db.js';
import { getConfig } from '../config.js';

const router = express.Router();

const FALLBACK = "I only help with questions related to India's Right to Information (RTI) Act.";
const config = getConfig();
const openAiKey = config.OPENAI_API_KEY;
const client = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;
const OPENAI_MODEL = config.OPENAI_MODEL;

// RTI Request Detection Patterns
const RTI_KEYWORDS = [
  'rti', 'rtr', 'rt i', 'right to information', 'information act',
  'file', 'draft', 'create', 'generate', 'submit', 'application',
  'police', 'court', 'government', 'department', 'office', 'authority',
  'complaint', 'grievance', 'corruption', 'misconduct', 'transparency',
  'help', 'assist', 'guide', 'how to'
];

const APPLICATION_TRIGGER_REGEX = /(file|draft|submit|create|generate|help|assist)\s+(an?\s+)?(rti|rtr|rt\s*i)/i;

// NEW RTI LOGIC - DIRECT AND LESS IRRITATING
const systemPrompt = `
You are "FileMyRTI AI" — India's most trusted RTI assistant, built by FileMyRTI.com to help citizens understand, draft, and file applications under the Right to Information Act, 2005.

---

### 🧭 CORE OBJECTIVE
Your mission is to provide quick, direct RTI assistance without being annoying or asking too many questions.

---

### 📋 DIRECT RTI DRAFTING
When users request RTI help (including typos like "RTR", "RTI", "file RTI", "help with RTI", etc.), immediately provide a complete, customized RTI template. Be smart about context:

**For specific requests like "file RTI for police station":**
- Fill in the department as "Police Station"
- Provide relevant information request examples for police stations
- Include proper PIO details

**For general RTI requests or questions:**
- Provide a generic template with placeholders
- Give examples of what information can be requested
- Answer RTI-related questions directly

**Common RTI scenarios:**
- Police station: FIR copies, case status, officer details
- Government offices: File copies, policy documents, statistics
- Courts: Case status, judgment copies, procedure details

**Template Format:**
*The Right to Information Act, 2005*
*Application for Obtaining Information*

*From:*
[Your Full Name]
[Your Complete Address with PIN Code]
Phone: [Your Phone Number]
Email: [Your Email Address]

*To,*
The Public Information Officer
[Specific Department/Office Name]
[Complete Office Address with City/State]

*Subject:* Request for Information under RTI Act, 2005

Dear Sir/Madam,

I, [Your Full Name], submit this application under the Right to Information Act, 2005, seeking the following information:

1. [Specific, detailed information request]

Kindly provide certified copies of all relevant documents/records within 30 days as per RTI Act.

*Application Fee:* ₹10/- (Cash/IPO/DD/Court Fee Stamp)
*Declaration:* I am a citizen of India.

Yours faithfully,
[Your Full Name]
Date: [Current Date]

---

**How to File:**
1. Attach ₹10 fee (court fee stamp/cash)
2. Send to the correct PIO office
3. Keep a copy for your records

---

### 💡 RTI GUIDANCE
- Answer RTI questions directly
- Provide specific information when asked
- Don't overwhelm with too many questions
- If user needs help with specific departments/authorities, provide guidance
- For complex cases, suggest professional help

---

### 🚫 NON-RTI QUERIES
If user asks about non-RTI topics, politely redirect:
"I specialize in RTI applications. For other queries, please visit the appropriate government department."
`;

const chatMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message is required')
    .max(2000, 'Message is too long'),
  sessionId: z
    .string()
    .trim()
    .min(1, 'sessionId is required')
    .max(64)
    .optional(),
});

if (!client) {
  console.warn(
    '[FileMyRTI] OpenAI API key is not configured. Chat answers and RTI draft generation will be limited.'
  );
}

// POST chat message
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const parsed = chatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid request payload',
      });
    }

    const { message, sessionId: providedSessionId } = parsed.data;
    const sessionId = providedSessionId || randomUUID();

    // Check if this looks like an RTI-related request
    const messageLower = message.toLowerCase().replace(/[^\w\s]/g, ''); // Remove punctuation
    const isRtiRequest = APPLICATION_TRIGGER_REGEX.test(message) ||
      RTI_KEYWORDS.some(keyword => messageLower.includes(keyword.replace(/\s+/g, ' '))) ||
      /\b(rt[iu]|rtr|right\s*to\s*info)/i.test(message) ||
      (messageLower.includes('file') && (messageLower.includes('rti') || messageLower.includes('rtr'))) ||
      (messageLower.includes('help') && (messageLower.includes('rti') || messageLower.includes('rtr')));


    let reply = FALLBACK;

    if (client && isRtiRequest) {
      try {
        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ];

        const completion = await client.chat.completions.create({
          model: OPENAI_MODEL,
          messages,
          max_tokens: 2000,
          temperature: 0.3,
        });

        reply = completion.choices[0]?.message?.content?.trim() || FALLBACK;

        // Save to database
        await pool.execute(
          'INSERT INTO chat_history (session_id, user_id, message, response) VALUES (?, ?, ?, ?)',
          [sessionId, userId, message, reply]
        );

      } catch (openaiError) {
        console.error('[OpenAI Error]', openaiError);
        reply = FALLBACK;
      }
    } else if (isRtiRequest) {
      // Provide RTI template when OpenAI is not available but it's an RTI request
      const messageLower = message.toLowerCase();

      // Try to detect what kind of RTI request it is
      let department = "[Department/Office Name]";
      let exampleRequest = "[Describe specifically what information you need - be clear and detailed]";

      if (messageLower.includes('police') || messageLower.includes('station')) {
        department = "Police Station [Station Name]";
        exampleRequest = "1. Certified copy of FIR No. [FIR Number] dated [Date]\n2. Status of investigation in the above mentioned case\n3. Details of officers involved in the investigation";
      } else if (messageLower.includes('court')) {
        department = "District Court [Court Name]";
        exampleRequest = "1. Certified copy of judgment in Case No. [Case Number]\n2. Current status of the case\n3. Details of next hearing date";
      } else if (messageLower.includes('government') || messageLower.includes('ministry')) {
        department = "Ministry of [Ministry Name]";
        exampleRequest = "1. Certified copies of policy documents related to [specific topic]\n2. Statistical data for the year [year]\n3. Details of schemes/programs under [department]";
      }

      reply = `Here's your RTI application template:

*The Right to Information Act, 2005*
*Application for Obtaining Information*

*From:*
[Your Full Name]
[Your Complete Address with PIN Code]
Phone: [Your Phone Number]
Email: [Your Email Address]

*To,*
The Public Information Officer
${department}
[Complete Office Address with City/State and PIN Code]

*Subject:* Request for Information under RTI Act, 2005

Dear Sir/Madam,

I, [Your Full Name], submit this application under the Right to Information Act, 2005, seeking the following information:

${exampleRequest}

Kindly provide certified copies of all relevant documents/records within 30 days as per RTI Act.

*Application Fee:* ₹10/- (Cash/IPO/DD/Court Fee Stamp)
*Declaration:* I am a citizen of India.

Yours faithfully,
[Your Full Name]
Date: [Current Date]

---
**How to File:**
1. Fill in your personal details in [brackets]
2. Customize the information request based on what you need
3. Attach ₹10 court fee stamp or IPO
4. Send to the concerned Public Information Officer by registered post or in person`;
    }

    res.json({
      id: randomUUID(),
      sessionId,
      reply,
      message,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[Chat API Error]', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;