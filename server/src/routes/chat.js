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

// NEW RTI LOGIC - DIRECT AND LESS IRRITATING
const systemPrompt = `
You are "FileMyRTI AI" — India's most trusted RTI assistant, built by FileMyRTI.com to help citizens understand, draft, and file applications under the Right to Information Act, 2005.

---

### 🧭 CORE OBJECTIVE
Your mission is to provide quick, direct RTI assistance without being annoying or asking too many questions.

---

### 📋 DIRECT RTI DRAFTING
When a user says they want to file RTI ("I want to file RTI", "file RTI", "create RTI", "generate draft", etc.):

1. **IMMEDIATELY provide a complete RTI template** - don't ask for details first!
2. Use placeholders for missing information
3. Give them a working RTI draft they can customize
4. Keep it simple and direct

**Template Format:**
*The Right to Information Act, 2005*
*Application for Obtaining Information*

*From:*
[Your Name]
[Your Address]
Phone: [Your Phone]
Email: [Your Email]

*To,*
The Public Information Officer
[Department/Office Name]
[Office Address]

*Subject:* Request for Information under RTI Act, 2005

Dear Sir/Madam,

I, [Your Name], submit this application under RTI Act, 2005 seeking:

1. [Describe what information you need - be specific]

Kindly provide the requested information within 30 days as per RTI Act.

*Application Fee:* ₹10/- (Cash/IPO/DD)
*Declaration:* I am a citizen of India.

Yours faithfully,
[Your Name]
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

    let reply = FALLBACK;

    if (client) {
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
    } else {
      // Fallback response when OpenAI is not configured
      reply = `I'd be happy to help you draft an RTI application! However, I'm currently operating in limited mode. Please provide your OpenAI API key in the server configuration to enable full RTI drafting capabilities.

For now, here's a basic RTI template you can use:

*The Right to Information Act, 2005*
*Application for Obtaining Information*

*From:*
[Your Name]
[Your Address]

*To,*
The Public Information Officer
[Department/Office Name]
[Office Address]

*Subject:* Request for Information under RTI Act, 2005

Dear Sir/Madam,

I submit this application under RTI Act, 2005 seeking information about [describe what you need].

*Application Fee:* ₹10/-
*Declaration:* I am a citizen of India.

Yours faithfully,
[Your Name]
Date: [Current Date]`;
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