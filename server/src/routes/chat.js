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
  'rti', 'right to information', 'information act',
  'file', 'draft', 'create', 'generate', 'submit', 'application',
  'police', 'court', 'government', 'department', 'office', 'authority',
  'complaint', 'grievance', 'corruption', 'misconduct', 'transparency'
];

const APPLICATION_TRIGGER_REGEX = /(file|draft|submit|create|generate)\s+(an?\s+)?rti|rti\s+(application|draft)/i;

// NEW RTI LOGIC - DIRECT AND LESS IRRITATING
const systemPrompt = `
You are "FileMyRTI AI" — India's most trusted RTI assistant, built by FileMyRTI.com to help citizens understand, draft, and file applications under the Right to Information Act, 2005.

---

### 🧭 CORE OBJECTIVE
Your mission is to provide quick, direct RTI assistance without being annoying or asking too many questions.

---

### 📋 DIRECT RTI DRAFTING
When users request RTI help, immediately provide a complete, customized RTI template. Be smart about context:

**For specific requests like "file RTI for police station":**
- Fill in the department as "Police Station"
- Provide relevant information request examples for police stations
- Include proper PIO details

**For general RTI requests:**
- Provide a generic template with placeholders
- Give examples of what information can be requested

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
    const messageLower = message.toLowerCase();
    const isRtiRequest = APPLICATION_TRIGGER_REGEX.test(message) ||
      RTI_KEYWORDS.some(keyword => messageLower.includes(keyword)) ||
      messageLower.includes('rti') ||
      messageLower.includes('information') ||
      messageLower.includes('file') ||
      messageLower.includes('draft') ||
      messageLower.includes('government') ||
      messageLower.includes('police') ||
      messageLower.includes('court');

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
      // Fallback RTI template when OpenAI is not available but it's an RTI request
      reply = `Here's a ready-to-use RTI application template:

*The Right to Information Act, 2005*
*Application for Obtaining Information*

*From:*
[Your Full Name]
[Your Complete Address with PIN Code]
Phone: [Your Phone Number]
Email: [Your Email Address]

*To,*
The Public Information Officer
[Department/Office Name - e.g., Police Station Name]
[Complete Office Address with City/State]

*Subject:* Request for Information under RTI Act, 2005

Dear Sir/Madam,

I, [Your Full Name], submit this application under the Right to Information Act, 2005, seeking the following information:

1. [Describe specifically what information you need - be clear and detailed]

Kindly provide certified copies of all relevant documents/records.

*Application Fee:* ₹10/- (Cash/IPO/DD/Court Fee Stamp)
*Declaration:* I am a citizen of India.

Yours faithfully,
[Your Full Name]
Date: [Current Date]

---
**How to File:**
1. Fill in your personal details in [brackets]
2. Specify the exact information you need
3. Attach ₹10 fee
4. Send to the concerned Public Information Officer`;
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