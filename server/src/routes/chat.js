import express from 'express';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import { pool } from '../db.js';
import { getConfig } from '../config.js';

const router = express.Router();

const FALLBACK = "I only help with questions related to India's Right to Information (RTI) Act.";
const CLARIFY =
  'Please specify your RTI-related query or provide details on the information you seek, so I can guide you on the right RTI application, filing steps, or applicable rules in India.';
const config = getConfig();
const openAiKey = config.OPENAI_API_KEY;
const client = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;
const OPENAI_MODEL = config.OPENAI_MODEL;
// const REQUIRED_FIELD_KEYS = ['full_name', 'contact_info', 'department', 'information_request'];
//const REQUIRED_FIELD_KEYS = ['department', 'information_request']; // Removed full_name and contact_info

// COMMENTED OUT - OLD RTI LOGIC THAT WAS TOO VERBOSE AND IRRITATING
/*
const systemPrompt = `
You are "FileMyRTI AI" — India's most trusted RTI assistant, built by FileMyRTI.com to help citizens understand, draft, and file applications under the Right to Information Act, 2005.

---

### 🧭 CORE OBJECTIVE
Your mission is tooo:
1. Help users *understand their rights* under the RTI Act, 2005.
2. Guide them step-by-step in *filing RTI applications, **appeals, or **requests for certified information*.
3. Generate *professionally formatted RTI drafts* that users can directly submit or review.

You *only handle RTI-related queries.*
If a user asks about anything else, reply exactly:
> "I only help with questions related to India's Right to Information (RTI) Act."

---

### ⚙ INTELLIGENCE & MEMORY
- Remember user details (name, address, issue, department) *within the same chat session*.
- Automatically reuse saved details; don't re-ask.
- If essential info is missing (department, issue, etc.), *ask only what's missing*.
- Maintain *placeholders* for personal details when not provided:
  - [Applicant Name]
  - [Address Line 1], [City], [State], [PIN]
  - [Phone Number], [Email Address]
  These allow the user to fill them later.
- Use a placeholder for the PIO section too —
  e.g.,
  *To:* The Public Information Officer
  *Department:* [Enter Department Name]
  *Office Address:* [Enter PIO Address]
- If the user updates any detail, use the latest.

---

### 🧠 KNOWLEDGE SCOPE
You are an *expert* in:
- RTI Act 2005 — Sections, Rules, and Procedures
- Filing (offline & online), fees, exemptions (Section 8), and appeals
- Identifying correct authorities / PIOs
- Handling *typical citizen issues*: passport delays, PF settlement, marksheet verification, government recruitment, land matters, public works queries, etc.
- *Complaint-pattern awareness:*
  Many users come with grievance-type requests (e.g., faulty product, private-company issues).
  When a query is unrelated to government/public-authority information, politely explain that RTI cannot be used for private-entity complaints and guide them appropriately.
  Example: If the issue involves a private brand (e.g., Noise earbuds), explain that RTI applies only to public authorities, not private companies.
- *Platform guidance:*
  - Encourage filing through the *official government RTI portals* when the user is comfortable.
  - If the user prefers human help or finds portals difficult, gently offer FileMyRTI's paid assistance and share contact number *+91 9911100589* for expert support.

Never invent laws or fake links.

---

### 🧾 DRAFTING RTI APPLICATIONS
When a user requests an RTI draft ("file RTI", "create RTI", "generate draft", etc.):
1. Ask for missing contextual details only (issue / department / information sought).
   Use placeholders for personal details.
2. Produce a *complete, professional RTI draft* in the following format:
*/

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

const sessionIdParamSchema = z.object({
  sessionId: z
    .string()
    .trim()
    .min(1, 'sessionId is required')
    .max(64),
});

if (!client) {
  console.warn(
    '[FileMyRTI] OpenAI API key is not configured. Chat answers and RTI draft generation will be limited.'
  );
}

// Removed APPLICATION_FIELDS - using AI directly to generate RTI drafts with placeholders
// The AI will handle all RTI draft generation through conversation

const APPLICATION_TRIGGER_REGEX = /(file|draft|submit|create|generate)\s+(an?\s+)?rti|rti\s+(application|draft)/i;

// Lightweight in-memory session store so the assistant can remember user details during a chat.
const sessionMemory = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 1000; // Maximum number of sessions to keep in memory
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Cleanup every 5 minutes

// Session cleanup mechanism
function cleanupExpiredSessions() {
  const now = Date.now();
  const expiredKeys = [];

  for (const [userId, session] of sessionMemory.entries()) {
    if (now - session.lastUpdated > SESSION_TTL) {
      expiredKeys.push(userId);
    }
  }

  expiredKeys.forEach(userId => sessionMemory.delete(userId));

  // If still over limit, remove oldest sessions
  if (sessionMemory.size > MAX_SESSIONS) {
    const entries = Array.from(sessionMemory.entries());
    entries.sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);

    const toRemove = entries.slice(0, sessionMemory.size - MAX_SESSIONS);
    toRemove.forEach(([userId]) => sessionMemory.delete(userId));
  }

  console.log(`[Session Cleanup] Removed ${expiredKeys.length} expired sessions.Current sessions: ${sessionMemory.size} `);
}

// Start periodic cleanup
setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL);
const GREETING_PATTERNS = [
  /^hi(?: there)?$/i,
  /^hello(?: there)?$/i,
  /^hey(?: there)?$/i,
  /^namaste$/i,
  /^good (morning|evening|afternoon)$/i,
];

// Removed GENERAL_SUPPORT_PATTERNS - AI will handle all responses according to system prompt

const NAME_RECALL_PATTERNS = [
  /\bwhat(?:'s|\s+is)\s+my\s+name\b/i,
  /\btell\s+me\s+my\s+name\b/i,
  /\btell\s+name\b/i,
  /\bdo\s+you\s+remember\s+my\s+name\b/i,
  /\bwho\s+am\s+i\b/i,
];

function getSession(userId) {
  if (!sessionMemory.has(userId)) {
    // Initialize simple session - AI will handle context through conversation
    sessionMemory.set(userId, {
      lastUpdated: Date.now(),
    });
  } else {
    // Update last accessed time
    const session = sessionMemory.get(userId);
    session.lastUpdated = Date.now();
  }
  return sessionMemory.get(userId);
}

function isGreeting(message = '') {
  const normalized = message.trim().toLowerCase().replace(/[!.]/g, '').replace(/\s+/g, ' ');
  if (!normalized) return false;
  return GREETING_PATTERNS.some(pattern => pattern.test(normalized));
}

function storeUserInfo(userId, message = '') {
  // Removed - AI will handle context through conversation history
  // No need to extract structured fields anymore
  return [];
}

function getGeneralSupportResponse(message = '') {
  // Removed - AI will handle all responses according to system prompt
  // AI will respond to non-RTI queries with the standard message
  return null;
}

function isNameRecallRequest(message = '') {
  if (!message) return false;
  return NAME_RECALL_PATTERNS.some(pattern => pattern.test(message));
}

async function recordChat(userId, sessionId, message, response) {
  const [result] = await pool.query(
    'INSERT INTO chats (user_id, session_id, message, response) VALUES (?, ?, ?, ?)',
    [userId, sessionId, message, response]
  );
  const chatId = result.insertId;
  const [rows] = await pool.query('SELECT timestamp FROM chats WHERE id = ?', [chatId]);
  const rawTimestamp = rows?.[0]?.timestamp;
  const timestamp =
    rawTimestamp instanceof Date
      ? rawTimestamp.toISOString()
      : new Date().toISOString();
  return { id: chatId, timestamp, sessionId };
}

function isRTIRelated(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const keywords = [
    // Core RTI terms
    'rti',
    'right to information',
    'information act',
    'rti act',
    'rti application',
    'rti draft',
    'rti appeal',
    'rti filing',
    'file rti',
    'how to file rti',
    'write rti',
    'rti format',
    'rti sample',
    'rti example',

    // Key authorities
    'central information commission',
    'state information commission',
    'information commission',
    'public information officer',
    'pio',
    'appellate authority',
    'first appeal',
    'second appeal',
    'cic',
    'sic',

    // Legal sections
    'section 6',
    'section 7',
    'section 8',
    'section 19',

    // General RTI context
    'govt information',
    'government information',
    'government office',
    'public authority',
    'information request',
    'application for information',
    'transparency law',
    'citizen information request',

    // Common user intents (natural phrasing)
    'how to get information from government',
    'how to ask government for details',
    'delay in government service',
    'passport delay information',
    'municipal complaint information',
    'file complaint under rti',
    'status of my application',
    'information not received',
    'appeal under rti'
  ];

  return keywords.some(k => t.includes(k));
}

function needsClarification(text) {
  if (!text) return false;

  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[?.!]+$/g, '')
    .replace(/\s+/g, ' ');

  if (!normalized) return false;

  const genericPatterns = [
    /^(how\s+to\s+file\s+(an?\s+)?rti)$/i,
    /^(how\s+do\s+i\s+file\s+(an?\s+)?rti)$/i,
    /^(help\s+(me\s+)?(file|with)\s+(an?\s+)?rti)$/i,
    /^(rti\s+(help|info|information))$/i,
    /^(tell\s+me\s+about\s+rti)$/i,
    /^(what\s+is\s+(the\s+)?rti(\s+act)?)$/i,
    /^(guide\s+me(\s+on|\s+about)?\s*(the)?\s*rti)$/i,
    /^(how\s+to\s+apply\s+for\s+(an?\s+)?rti)$/i,
    /^(explain\s+(the\s+)?rti(\s+act)?)$/i,
    /^(rti\s+(details|process|procedure))$/i,
    /^(need\s+(to\s+)?file\s+(an?\s+)?rti)$/i,
  ];

  if (genericPatterns.some(rx => rx.test(normalized))) return true;

  if (['rti', 'rti act', 'the rti act'].includes(normalized)) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= 4 && normalized.includes('rti')) return true;

  return false;
}


function isGeneralRtiQuestion(text) {
  if (!text) return false;
  const normalized = text.trim().toLowerCase().replace(/[?.!]+$/g, '');
  if (!normalized) return false;

  const patterns = [
    /^(what\s+is\s+(the\s+)?rti(\s+act)?)$/,
    /^(explain\s+(the\s+)?rti(\s+act)?)$/,
    /^(tell\s+me\s+about\s+(the\s+)?rti(\s+act)?)$/,
    /^(meaning\s+of\s+rti)$/,
    /^(define\s+rti)$/,
    /^(rti\s+meaning)$/,
    /^(how\s+does\s+rti\s+work)$/,
    /^(what\s+is\s+right\s+to\s+information)$/,
    /^(how\s+to\s+file\s+(an?\s+)?rti)$/,
    /^(how\s+do\s+i\s+file\s+(an?\s+)?rti)$/,
    /^(guide\s+me(\s+on|\s+about)?\s*(the)?\s*rti)$/,
    /^(how\s+to\s+apply\s+for\s+(an?\s+)?rti)$/,
  ];

  if (patterns.some(rx => rx.test(normalized))) {
    return true;
  }

  if (normalized.includes('what is rti')) return true;
  if (normalized.includes('explain rti')) return true;
  if (normalized.includes('about rti')) return true;
  if (normalized.includes('how to file rti')) return true;
  if (normalized.includes('how do i file rti')) return true;
  if (normalized.includes('guide me on rti')) return true;

  return false;
}

async function getLatestApplication(userId, sessionId) {
  const [rows] = await pool.query(
    'SELECT * FROM rti_applications WHERE user_id = ? AND session_id = ? ORDER BY updated_at DESC LIMIT 1',
    [userId, sessionId]
  );
  return rows[0] || null;
}

async function getApplicationById(id) {
  const [rows] = await pool.query('SELECT * FROM rti_applications WHERE id = ?', [id]);
  return rows[0] || null;
}

function shouldStartApplication(message) {
  if (!message) return false;
  return APPLICATION_TRIGGER_REGEX.test(message.toLowerCase());
}

// Simplified RTI draft generation - AI handles everything through conversation
async function generateRtiDraftFromMessage(userId, sessionId, message, conversationHistory = []) {
  if (!client) {
    return null;
  }

  // Build conversation context for AI
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: message }
  ];

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    temperature: 0.3,
    max_tokens: 1200, // More tokens for complete RTI draft
    user: String(userId),
  });

  const draft = completion.choices?.[0]?.message?.content?.trim();
  return draft || null;
}

// Simplified RTI application handling - AI handles everything through conversation
async function handleRtiApplication({ userId, sessionId, message, existingApplication, session }) {
  // Check if user is requesting an RTI draft
  const triggered = shouldStartApplication(message);

  if (!triggered) {
    // Not an RTI draft request - let AI handle it normally
    return null;
  }

  // User wants an RTI draft - let AI generate it directly
  // Get recent conversation history for context
  const [historyRows] = await pool.query(
    'SELECT message, response FROM chats WHERE user_id = ? AND session_id = ? ORDER BY timestamp DESC LIMIT 10',
    [userId, sessionId]
  );

  // Build conversation history (reverse to chronological order)
  const conversationHistory = historyRows.reverse().flatMap(row => [
    { role: 'user', content: row.message },
    { role: 'assistant', content: row.response }
  ]);

  // Generate RTI draft using AI
  const draftText = await generateRtiDraftFromMessage(userId, sessionId, message, conversationHistory);

  if (!draftText) {
    return {
      handled: true,
      reply: 'I was unable to generate the RTI draft right now. Please try again in a moment.',
      draftAvailable: false,
    };
  }

  // Save draft to database
  let application = existingApplication;
  if (!application) {
    const [result] = await pool.query(
      'INSERT INTO rti_applications (user_id, session_id, status, draft_text) VALUES (?, ?, "completed", ?)',
      [userId, sessionId, draftText]
    );
    application = await getApplicationById(result.insertId);
  } else {
    await pool.query(
      'UPDATE rti_applications SET status = "completed", draft_text = ?, updated_at = NOW() WHERE id = ?',
      [draftText, application.id]
    );
  }

  // Return AI response (which includes the draft)
  return {
    handled: true,
    reply: draftText, // AI response contains the formatted RTI draft
    draftAvailable: true,
    draftText,
  };
}

// GET chat history
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      'SELECT id, session_id AS sessionId, message, response, timestamp FROM chats WHERE user_id = ? ORDER BY timestamp ASC',
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

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
    let sessionId = providedSessionId;
    if (!sessionId) {
      sessionId = randomUUID();
    }

    // Initialise session memory for this user and capture any personal details in the latest message.
    const session = getSession(userId);
    storeUserInfo(userId, message);

    const existingApplication = await getLatestApplication(userId, sessionId);
    const generalRtiQuestion = isGeneralRtiQuestion(message);

    if (isGreeting(message) && !isRTIRelated(message) && !generalRtiQuestion) {
      // Simple greeting - let AI handle RTI-related conversations
      const reply = 'Hello! How can I assist you with India\'s RTI Act today?';
      const saved = await recordChat(userId, sessionId, message, reply);
      return res.json({
        reply,
        id: saved.id,
        message,
        timestamp: saved.timestamp,
        sessionId: saved.sessionId,
      });
    }

    // Removed general support patterns - AI handles all responses according to system prompt

    // Commented out: No longer asking for or storing user names
    // if (isNameRecallRequest(message)) {
    //   const reply = session.full_name
    //     ? `You mentioned that your name is ${ session.full_name }.`
    //     : "I don't think you've shared your name yet. Let me know, and I'll remember it for the rest of this chat.";
    //   const saved = await recordChat(userId, sessionId, message, reply);
    //   return res.json({
    //     reply,
    //     id: saved.id,
    //     message,
    //     timestamp: saved.timestamp,
    //     sessionId: saved.sessionId,
    //   });
    // }

    let rtiFlow = null;
    if (!generalRtiQuestion) {
      rtiFlow = await handleRtiApplication({
        userId,
        sessionId,
        message,
        existingApplication,
        session,
      });
    }

    if (rtiFlow) {
      const saved = await recordChat(userId, sessionId, message, rtiFlow.reply);
      return res.json({
        reply: rtiFlow.reply,
        id: saved.id,
        message,
        timestamp: saved.timestamp,
        sessionId: saved.sessionId,
        draftAvailable: rtiFlow.draftAvailable || false,
        draftText: rtiFlow.draftText || null,
      });
    }

    // Removed structured clarification flow - AI handles all conversations

    if (!client) {
      const saved = await recordChat(userId, sessionId, message, FALLBACK);
      return res.json({
        reply: FALLBACK,
        id: saved.id,
        message,
        timestamp: saved.timestamp,
        sessionId: saved.sessionId,
        draftAvailable: false,
      });
    }



    // Get conversation history for context
    const [historyRows] = await pool.query(
      'SELECT message, response FROM chats WHERE user_id = ? AND session_id = ? ORDER BY timestamp DESC LIMIT 10',
      [userId, sessionId]
    );

    // Build conversation history (reverse to chronological order)
    const conversationHistory = historyRows.reverse().flatMap(row => [
      { role: 'user', content: row.message },
      { role: 'assistant', content: row.response }
    ]);

    // Call OpenAI with conversation history
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      max_tokens: 1200, // Allow for complete RTI drafts
      user: String(userId),
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || FALLBACK;

    // Save chat to DB
    const saved = await recordChat(userId, sessionId, message, reply);

    return res.json({
      reply,
      id: saved.id,
      message,
      timestamp: saved.timestamp,
      sessionId: saved.sessionId,
      draftAvailable: false,
    });
  } catch (err) {
    console.error('[Chat Error]', err);
    console.error('[Session Memory Size]', sessionMemory.size);
    console.error('[Memory Usage]', process.memoryUsage());
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:sessionId', async (req, res) => {
  try {
    const userId = req.user.id;
    const parsed = sessionIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'sessionId is required',
      });
    }
    const { sessionId } = parsed.data;

    const [result] = await pool.query(
      'DELETE FROM chats WHERE user_id = ? AND session_id = ?',
      [userId, sessionId]
    );
    await pool.query(
      'DELETE FROM rti_applications WHERE user_id = ? AND session_id = ?',
      [userId, sessionId]
    );

    return res.json({ deleted: result.affectedRows || 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/applications', async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      'SELECT session_id AS sessionId, status, draft_text IS NOT NULL AS hasDraft FROM rti_applications WHERE user_id = ? ORDER BY updated_at DESC',
      [userId]
    );
    const seen = new Map();
    rows.forEach(row => {
      if (!seen.has(row.sessionId)) {
        seen.set(row.sessionId, {
          sessionId: row.sessionId,
          status: row.status,
          hasDraft: Boolean(row.hasDraft),
        });
      }
    });
    return res.json(Array.from(seen.values()));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/application/:sessionId/download', async (req, res) => {
  try {
    const userId = req.user.id;
    const parsed = sessionIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'sessionId is required',
      });
    }
    const { sessionId } = parsed.data;

    const [rows] = await pool.query(
      'SELECT draft_text FROM rti_applications WHERE user_id = ? AND session_id = ? AND draft_text IS NOT NULL ORDER BY updated_at DESC LIMIT 1',
      [userId, sessionId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Draft not found for this session.' });
    }

    const draftText = rows[0].draft_text;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename = "rti-draft-${sessionId}.txt"`
    );
    return res.send(draftText);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
