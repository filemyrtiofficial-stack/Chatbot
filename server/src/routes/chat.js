import express from 'express';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import { pool } from '../db.js';
import { getConfig } from '../config.js';

const router = express.Router();

const FALLBACK = "I'm here to help—feel free to ask about India's RTI Act or anything else on your mind.";
const CLARIFY =
  'Please specify your RTI-related query or provide details on the information you seek, so I can guide you on the right RTI application, filing steps, or applicable rules in India.';
const config = getConfig();
const openAiKey = config.OPENAI_API_KEY;
const client = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;
const OPENAI_MODEL = config.OPENAI_MODEL;
// const REQUIRED_FIELD_KEYS = ['full_name', 'contact_info', 'department', 'information_request'];
const REQUIRED_FIELD_KEYS = ['department', 'information_request']; // Removed full_name and contact_info

const systemPrompt = `
You are "FileMyRTI AI" — India's most trusted RTI assistant, built by FileMyRTI.com to help citizens understand, draft, and file applications under the Right to Information Act, 2005.

---

### 🧭 CORE OBJECTIVE
Your mission is to:
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

---

*The Right to Information Act, 2005*  
*Application for Obtaining Information*

*From:*  
[Applicant Name]  
[Address Line 1] [City] – [PIN], [State]  
Phone: [Phone Number]  
Email: [Email Address]

*To,*  
The Public Information Officer  
[Department / Office Name]  
[Office Address / City / State]

*Subject:* Request for Information under the RTI Act, 2005 regarding [brief topic]

*Respected Sir/Madam,*  
I, [Applicant Name], respectfully submit this application under the Right to Information Act, 2005, seeking the following information:

1. [Specific question 1]  
2. [Specific question 2]  
3. [Add more points as needed]

Kindly provide certified copies of the requested records wherever available.  

*Application Fee Enclosed:* ₹10/- (IPO/DD/Court Fee Stamp/Online Payment)  

*Additional Submissions:*  
• Under Section 6(3), please transfer this application to the concerned office if the information is held elsewhere.  
• Under Section 7(3), inform me if any additional fees are required.  
• Under Section 7(8)(iii), please mention the name and contact details of the First Appellate Authority with your reply.  

*Declaration:* I am a citizen of India.  

*Yours faithfully,*  
(Signature)  
[Applicant Name]  
Date: [Date]

---

3. After presenting the draft, always ask:  
> "Would you like to download this draft as a Word document?"

---

### 🧱 FIRST APPEAL TEMPLATE
If the user receives no reply within 30 days or an unsatisfactory response, generate this format:

---

*The Right to Information Act, 2005*  
*First Appeal (Form for State or Central Government)*  

*To*  
The First Appellate Authority under RTI Act  
[Designation / Department Name]  
[Office Address]

*Subject:* Appeal Against Non-Response or Unsatisfactory Response from the Public Information Officer  

*Dear Sir/Madam,*  
As I am aggrieved by the lack of response / unsatisfactory response from the Public Information Officer (PIO), I hereby file this appeal for your kind decision.  

1. *Appellant Details:* Name, Address, Phone, Email  
2. *PIO Details:* Name/Designation and Address  
3. *RTI Application Date & Mode of Submission*  
4. *Fee Details:* ₹10 paid via IPO/DD/Online  
5. *Information Sought:* (Summary)  
6. *PIO Decision:* No response / Unsatisfactory / Partial  
7. *Grounds for Appeal:*  
 - Failure to respond within 30 days under Section 7(1).  
 - No valid exemption under Sections 8 or 9 invoked.  
 - Violation of Section 4(1)(d) – duty to give reasons.  
8. *Relief Sought:* Direct the PIO to provide the requested information without delay.  
9. *Enclosures:* Copy of RTI application & proof of submission.  

*Declaration:* Information above is true to the best of my knowledge.  

(Signature)   
[Applicant Name]   Date: [Date]

---

### 📘 INFORMATIONAL RESPONSES
If a user asks:

- *"What is RTI?"* → Give a short, clear definition.  
- *"How to file RTI?"* → Explain both online and offline filing steps.  
  - If they seem hesitant or confused, offer help from FileMyRTI.com and mention the contact number (+91 9911100589).  
- *"No reply to RTI"* → Explain first and second appeal processes.  
- *"Fees / Exemptions / Timeline / Authorities"* → Provide factual answers with examples.  

End where possible with:  
> "Would you like me to create a sample RTI draft for your case?"

---

### 💬 STYLE & TONE
- *Tone:* Professional, clear, and empathetic — like a helpful RTI expert assisting a citizen.  
- *Formatting:*  
  - *Bold* for headings  
  - Italics for sub-headings  
  - Bullets for lists  
  - Double line breaks for sections  
- Avoid long introductions — be concise and action-oriented.  
- Always conclude with a next step (question / offer / call to action).

---

### ⚡ INTERACTION EXAMPLES

*Example 1 – General Question*  
*User:* What is RTI?  
*Assistant:*  
*RTI (Right to Information)* is a law that empowers every Indian citizen to request information from any public authority. It promotes transparency and accountability in governance.  
Would you like me to explain how to file an RTI step-by-step?

---

*Example 2 – Complaint Context (Private Issue)*  
*User:* I want to file RTI against Noise Earbuds Company.  
*Assistant:*  
The RTI Act applies only to government and public authorities, not private companies. However, if you believe a government body is involved (e.g., consumer protection authority, BIS certification office), I can help you draft an RTI for that department.  
Would you like me to suggest the appropriate authority or help you speak with a FileMyRTI expert at +91 9911100589?

---

*Example 3 – No Response to RTI*  
*User:* I didn't get a reply to my RTI.  
*Assistant:*  
If no reply is received within 30 days, you can file a *First Appeal* under Section 19(1) of the RTI Act with the Appellate Authority of the same department.  
Would you like me to generate a First Appeal draft for you using the official format?

---

### 🧩 ADDITIONAL RULES
- Never criticize or compare official government portals.  
- Promote FileMyRTI's mission of transparency, empowerment, and citizen awareness.  
- Ensure every answer is *accurate, concise, and actionable.*  
- Maintain FileMyRTI's brand voice — *trustworthy, clear, citizen-first.*

---

*FileMyRTI AI — Empowering India through Transparency.*
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

const APPLICATION_FIELDS = [
  // Commented out: name and contact info fields - now using placeholders in drafts
  // {
  //   key: 'full_name',
  //   label: 'full name',
  //   prompt: 'Please share your full name as it should appear in the RTI application.',
  // },
  // {
  //   key: 'contact_info',
  //   label: 'contact information',
  //   prompt: 'Please provide your complete postal address along with a phone number and/or email so the authority can contact you.',
  // },
  {
    key: 'department',
    label: 'department or public authority',
    prompt: 'Which department, organisation, or public authority should this RTI be addressed to? Include the office/location if you know it.',
  },
  {
    key: 'reference_details',
    label: 'reference numbers or dates',
    prompt: 'Share any reference numbers, account IDs, dates, or related documents that should be mentioned. If you have none, please say "None".',
  },
  {
    key: 'information_request',
    label: 'information you are requesting',
    prompt: 'Describe clearly the information you are seeking. You can list questions or specific data points you want from the authority.',
  },
];

const APPLICATION_FIELD_MAP = APPLICATION_FIELDS.reduce((acc, field) => {
  acc[field.key] = field;
  return acc;
}, {});

const APPLICATION_TRIGGER_REGEX = /(file|draft|submit)\s+(an?\s+)?rti|rti\s+application|rti\s+draft/i;

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

  console.log(`[Session Cleanup] Removed ${expiredKeys.length} expired sessions. Current sessions: ${sessionMemory.size}`);
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

const GENERAL_SUPPORT_PATTERNS = [
  {
    regex: /\b(pf|provident\s+fund|epfo|epf|uan|universal\s+account\s+number)\b/i,
    reply:
      'It sounds like you are facing an Employee Provident Fund issue. You can check your PF status on the EPFO portal with your UAN, or raise a grievance at https://epfigms.gov.in/. If you would like to file an RTI to get an official update from a government department, just let me know.',
  },
  {
    regex: /\b(salary|wages?|pay\s*slip|payroll|salary\s+delay|pending\s+payment)\b/i,
    reply:
      'Salary delays and payroll concerns are usually handled by writing to your employer and, if needed, escalating to the labour department. Keep copies of your appointment letter and previous payslips. If this is with a government employer and you need an RTI drafted, I can help with that once you are ready.',
  },
  {
    regex: /\b(gratuity|bonus|leave\s+encashment|final\s+settlement)\b/i,
    reply:
      'For gratuity, bonus, or final settlement matters, start by writing a detailed representation to HR and keep proof of submission. If the employer is a public authority and you decide to pursue information via RTI, I can help prepare that application step by step.',
  },
];

const NAME_RECALL_PATTERNS = [
  /\bwhat(?:'s|\s+is)\s+my\s+name\b/i,
  /\btell\s+me\s+my\s+name\b/i,
  /\btell\s+name\b/i,
  /\bdo\s+you\s+remember\s+my\s+name\b/i,
  /\bwho\s+am\s+i\b/i,
];

function getSession(userId) {
  if (!sessionMemory.has(userId)) {
    // Initialise per-user memory slots that map directly to RTI draft fields.
    // Removed full_name and contact_info - now using placeholders in drafts
    sessionMemory.set(userId, {
      department: '',
      information_request: '',
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
  if (!message || !userId) return [];
  const session = getSession(userId);
  const updatedFields = [];
  const sanitized = message.trim();

  // Commented out: No longer asking users for name and contact info - using placeholders instead
  // Capture full name statements like "my name is ..." or "I am ..."
  // const nameMatch = sanitized.match(/\b(?:my name is|i am|this is|call me)\s+([A-Za-z][A-Za-z\s'.-]{1,60})/i);
  // if (nameMatch) {
  //   const name = nameMatch[1].trim();
  //   if (name && session.full_name !== name) {
  //     session.full_name = name;
  //     updatedFields.push('full_name');
  //   }
  // }

  // Capture address/contact details.
  // const addressMatch = sanitized.match(/\b(?:my address is|address is|address:|i live at|residing at|living at)\s+([^.\n\r]+)/i);
  // if (addressMatch) {
  //   const address = addressMatch[1].trim();
  //   if (address && session.contact_info !== address) {
  //     session.contact_info = address;
  //     updatedFields.push('contact_info');
  //   }
  // }

  // Capture department or authority names.
  const departmentMatch = sanitized.match(/\b(?:department|authority|office|ministry)\s*(?:is|:)\s*([^.\n\r]+)/i);
  if (departmentMatch) {
    const department = departmentMatch[1].trim();
    if (department && session.department !== department) {
      session.department = department;
      updatedFields.push('department');
    }
  }

  // Capture information request sentences.
  const infoMatch =
    sanitized.match(/\b(?:i (?:am seeking|need|want)|please provide)\s+(?:the\s+)?(?:information|details)\s*(?:regarding|about|on)\s+([^.\n\r]+)/i) ||
    sanitized.match(/\b(?:information request|information needed)\s*:?\s*([^.\n\r]+)/i);
  if (infoMatch) {
    const info = infoMatch[1].trim();
    if (info && session.information_request !== info) {
      session.information_request = info;
      updatedFields.push('information_request');
    }
  }

  if (updatedFields.length > 0) {
    session.lastUpdated = Date.now();
  }
  return updatedFields;
}

function getGeneralSupportResponse(message = '') {
  if (!message) return null;
  for (const pattern of GENERAL_SUPPORT_PATTERNS) {
    if (pattern.regex.test(message)) {
      return pattern.reply;
    }
  }
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

function nextMissingField(application) {
  if (!application) return null;
  for (const field of APPLICATION_FIELDS) {
    if (!application[field.key] || !String(application[field.key]).trim()) {
      return field.key;
    }
  }
  return null;
}

async function createApplication(userId, sessionId) {
  const firstField = APPLICATION_FIELDS[0].key;
  const [result] = await pool.query(
    'INSERT INTO rti_applications (user_id, session_id, status, current_field) VALUES (?, ?, "collecting", ?)',
    [userId, sessionId, firstField]
  );
  return getApplicationById(result.insertId);
}

function stripJsonCodeFences(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/```json|```/gi, '').trim();
  }
  return trimmed;
}

function normalizeExtractedFields(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const normalized = {};
  APPLICATION_FIELDS.forEach(field => {
    const value = raw[field.key];
    if (value === null || value === undefined) {
      normalized[field.key] = '';
      return;
    }
    if (Array.isArray(value)) {
      normalized[field.key] = value.join(' ').trim();
      return;
    }
    if (typeof value === 'object') {
      normalized[field.key] = JSON.stringify(value);
      return;
    }
    normalized[field.key] = String(value).trim();
  });
  return normalized;
}

function collectNonEmptyFields(fields) {
  if (!fields) return {};
  return Object.entries(fields).reduce((acc, [key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      acc[key] = value.trim();
    }
    return acc;
  }, {});
}

function updateSessionFromFields(userId, fields = {}) {
  if (!userId || !fields) return;
  const session = getSession(userId);
  let updated = false;
  // Removed 'full_name' and 'contact_info' - now using placeholders
  ['department', 'information_request'].forEach(key => {
    const value = fields[key];
    if (typeof value === 'string' && value.trim() && session[key] !== value.trim()) {
      session[key] = value.trim();
      updated = true;
    }
  });
  if (updated) {
    session.lastUpdated = Date.now();
  }
}

function hasAllRequiredFields(fields) {
  if (!fields) return false;
  return REQUIRED_FIELD_KEYS.every(key => {
    const value = fields[key];
    return typeof value === 'string' && value.trim();
  });
}

async function extractApplicationDetailsFromMessage(message) {
  if (!client) return null;

  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Extract structured RTI application details. Return ONLY a JSON object with keys department, reference_details, information_request. Use empty strings for unknown values. Do not extract full_name or contact_info.',
        },
        { role: 'user', content: message },
      ],
      temperature: 0,
      max_tokens: 400,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return null;
    const cleaned = stripJsonCodeFences(content);
    const parsed = JSON.parse(cleaned);
    return normalizeExtractedFields(parsed);
  } catch (err) {
    console.warn('Failed to extract RTI application details from message', err);
    return null;
  }
}

async function setApplicationField(applicationId, fieldKey, value) {
  await pool.query(
    `UPDATE rti_applications SET ${fieldKey} = ?, updated_at = NOW() WHERE id = ?`,
    [value, applicationId]
  );
}

async function setApplicationState(applicationId, updates) {
  const fields = [];
  const values = [];
  Object.entries(updates).forEach(([key, value]) => {
    fields.push(`${key} = ?`);
    values.push(value);
  });
  if (fields.length === 0) return;
  values.push(applicationId);
  await pool.query(
    `UPDATE rti_applications SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
    values
  );
}

async function generateRtiDraft(application) {
  const fieldValues = APPLICATION_FIELDS.reduce((acc, field) => {
    acc[field.key] = (application[field.key] || '').toString().trim();
    return acc;
  }, {});

  if (!client) {
    return null;
  }

  // Using the global systemPrompt defined at the top of the file
  // Construct the user prompt from application field values
  const prompt = `Please create a formal RTI application letter with the following details:
  
Department/Authority: ${fieldValues.department}
Reference Details: ${fieldValues.reference_details}
Information Request: ${fieldValues.information_request}

Use placeholders for personal details (name, address, phone, email) as [Applicant Name], [Address Line 1], [City], [State], [PIN], [Phone Number], [Email Address]. Please format this as a professional RTI application letter.`;

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 600,
  });

  const draft = completion.choices?.[0]?.message?.content?.trim();
  return draft || null;
}

async function finalizeApplication(userId, application, session) {
  if (!client) {
    return {
      handled: true,
      reply:
        'I have all the information needed, but generating the RTI draft is unavailable because the OpenAI API key is not configured. Please try again after the administrator updates the server settings.',
      draftAvailable: false,
    };
  }

  const refreshed = await getApplicationById(application.id);
  if (!refreshed) {
    return {
      handled: true,
      reply: 'I could not retrieve your RTI application details. Please try again.',
      draftAvailable: false,
    };
  }

  // Sync the freshly fetched application data back into the active session.
  updateSessionFromFields(userId, refreshed);
  if (session) {
    // Removed 'full_name' and 'contact_info' - now using placeholders
    ['department', 'information_request'].forEach(key => {
      const value = refreshed[key];
      if (typeof value === 'string' && value.trim()) {
        session[key] = value.trim();
      }
    });
    session.lastUpdated = Date.now();
  }
  if (!refreshed.reference_details || !refreshed.reference_details.trim()) {
    const defaultReference = 'No specific reference details provided.';
    if (refreshed.reference_details !== defaultReference) {
      await setApplicationState(refreshed.id, { reference_details: defaultReference });
      refreshed.reference_details = defaultReference;
    }
  }

  const draftText = await generateRtiDraft(refreshed);
  if (!draftText) {
    return {
      handled: true,
      reply: 'I was unable to generate the RTI draft right now. Let\'s try again in a moment.',
      draftAvailable: false,
    };
  }

  await setApplicationState(refreshed.id, {
    status: 'completed',
    current_field: null,
    draft_text: draftText,
  });

  const reply = [
    'Here is your ready-to-copy RTI application draft:',
    '---',
    draftText,
    '---',
    'You can download a text copy anytime using the “Download draft” button.',
  ].join('\n');

  return {
    handled: true,
    reply,
    draftAvailable: true,
    draftText,
  };
}

async function handleRtiApplication({ userId, sessionId, message, existingApplication, session }) {
  const trimmed = message.trim();
  const activeSession = session || getSession(userId);
  let application = existingApplication || (await getLatestApplication(userId, sessionId));
  const triggered = shouldStartApplication(trimmed);

  if (!application) {
    if (!triggered) return null;

    let extractedFields = null;
    if (client) {
      extractedFields = await extractApplicationDetailsFromMessage(trimmed);
    }

    application = await createApplication(userId, sessionId);
    const sessionPrefill = collectNonEmptyFields({
      // Removed full_name and contact_info - now using placeholders
      department: activeSession.department,
      information_request: activeSession.information_request,
    });
    let recognizedFields = { ...sessionPrefill };
    if (extractedFields) {
      const extracted = collectNonEmptyFields(extractedFields);
      recognizedFields = { ...sessionPrefill, ...extracted };
    }
    if (Object.keys(recognizedFields).length > 0) {
      await setApplicationState(application.id, recognizedFields);
      application = { ...application, ...recognizedFields };
      updateSessionFromFields(userId, recognizedFields);
    }

    const allFieldsPresent = hasAllRequiredFields({
      ...sessionPrefill,
      ...(extractedFields || {}),
    });
    if (allFieldsPresent) {
      const referenceValue =
        application.reference_details && application.reference_details.trim()
          ? application.reference_details
          : 'No specific reference details provided.';

      await setApplicationState(application.id, {
        reference_details: referenceValue,
        current_field: null,
      });
      application.reference_details = referenceValue;
      application.current_field = null;

      return finalizeApplication(userId, application, activeSession);
    }

    const nextFieldKey = nextMissingField(application) || APPLICATION_FIELDS[0].key;
    await setApplicationState(application.id, { current_field: nextFieldKey });
    application.current_field = nextFieldKey;
    const nextPrompt = APPLICATION_FIELD_MAP[nextFieldKey].prompt;
    const introLines = [
      Object.keys(recognizedFields).length > 0
        ? 'Thanks! I still need a couple more details to complete your RTI draft.'
        : 'Great! Let\'s draft your RTI application together. I\'ll collect a few quick details.',
      '',
      nextPrompt,
    ].join('\n');

    return { handled: true, reply: introLines, draftAvailable: false };
  }

  // Auto-fill any outstanding RTI draft fields using remembered session values.
  const missingFieldsForSession = REQUIRED_FIELD_KEYS.filter(key => {
    const currentValue = application[key];
    return !currentValue || !String(currentValue).trim();
  });
  if (missingFieldsForSession.length > 0) {
    const sessionAutoFill = missingFieldsForSession.reduce((acc, key) => {
      const sessionValue = activeSession[key];
      if (typeof sessionValue === 'string' && sessionValue.trim()) {
        acc[key] = sessionValue.trim();
      }
      return acc;
    }, {});
    if (Object.keys(sessionAutoFill).length > 0) {
      await setApplicationState(application.id, sessionAutoFill);
      application = { ...application, ...sessionAutoFill };
      updateSessionFromFields(userId, sessionAutoFill);
      if (application.current_field && sessionAutoFill[application.current_field]) {
        const nextFieldAfterAuto = nextMissingField(application);
        await setApplicationState(application.id, { current_field: nextFieldAfterAuto });
        application.current_field = nextFieldAfterAuto;
      }
    }
  }

  if (application.status === 'completed') {
    if (triggered) {
      application = await createApplication(userId, sessionId);
      const firstField = APPLICATION_FIELD_MAP[APPLICATION_FIELDS[0].key];
      const intro = [
        'Starting a fresh RTI draft for you.',
        '',
        firstField.prompt,
      ].join('\n');
      return { handled: true, reply: intro, draftAvailable: false };
    }
    return null;
  }

  if (triggered) {
    const currentField = application.current_field || nextMissingField(application);
    const fieldInfo = currentField ? APPLICATION_FIELD_MAP[currentField] : null;
    const reply = fieldInfo
      ? `We\'re already gathering details. ${fieldInfo.prompt}`
      : 'We\'re already gathering information for this RTI draft. Please respond to the pending question.';
    return { handled: true, reply, draftAvailable: false };
  }

  let currentField = application.current_field || nextMissingField(application);
  if (!currentField) {
    return finalizeApplication(userId, application, activeSession);
  }

  const fieldInfo = APPLICATION_FIELD_MAP[currentField];
  if (!trimmed) {
    return {
      handled: true,
      reply: `Please provide ${fieldInfo.label}. ${fieldInfo.prompt}`,
      draftAvailable: false,
    };
  }

  let value = trimmed;
  if (currentField === 'reference_details' && trimmed.toLowerCase() === 'none') {
    value = 'No specific reference details provided.';
  }

  await setApplicationField(application.id, currentField, value);
  application[currentField] = value;
  updateSessionFromFields(userId, { [currentField]: value });

  const nextFieldKey = nextMissingField(application);
  if (nextFieldKey) {
    await setApplicationState(application.id, { current_field: nextFieldKey });
    application.current_field = nextFieldKey;
    const nextPrompt = APPLICATION_FIELD_MAP[nextFieldKey].prompt;
    return {
      handled: true,
      reply: `Thanks! ${nextPrompt}`,
      draftAvailable: false,
    };
  }

  return finalizeApplication(userId, application, activeSession);
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
    const hasCollectingApplication =
      existingApplication && existingApplication.status === 'collecting';

    const generalRtiQuestion = isGeneralRtiQuestion(message);

    if (isGreeting(message) && !isRTIRelated(message) && !generalRtiQuestion) {
      // Removed name-based greeting - keeping it simple
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

    // Offer helpful guidance for general non-RTI queries without forcing an RTI workflow.
    const generalSupport = getGeneralSupportResponse(message);
    if (generalSupport && !hasCollectingApplication) {
      const saved = await recordChat(userId, sessionId, message, generalSupport);
      return res.json({
        reply: generalSupport,
        id: saved.id,
        message,
        timestamp: saved.timestamp,
        sessionId: saved.sessionId,
      });
    }

    // Commented out: No longer asking for or storing user names
    // if (isNameRecallRequest(message)) {
    //   const reply = session.full_name
    //     ? `You mentioned that your name is ${session.full_name}.`
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

    if (!generalRtiQuestion && hasCollectingApplication && needsClarification(message)) {
      const saved = await recordChat(userId, sessionId, message, CLARIFY);
      return res.json({
        reply: CLARIFY,
        id: saved.id,
        message,
        timestamp: saved.timestamp,
        sessionId: saved.sessionId,
      });
    }

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



    // Call OpenAI
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      max_tokens: 400, // slightly more room for practical answers
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
      `attachment; filename="rti-draft-${sessionId}.txt"`
    );
    return res.send(draftText);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
