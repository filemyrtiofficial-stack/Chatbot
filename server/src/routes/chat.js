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
const REQUIRED_FIELD_KEYS = ['full_name', 'contact_info', 'department', 'information_request'];

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
  {
    key: 'full_name',
    label: 'full name',
    prompt: 'Please share your full name as it should appear in the RTI application.',
  },
  {
    key: 'contact_info',
    label: 'contact information',
    prompt: 'Please provide your complete postal address along with a phone number and/or email so the authority can contact you.',
  },
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
    sessionMemory.set(userId, {
      full_name: '',
      contact_info: '',
      department: '',
      information_request: '',
      lastUpdated: Date.now(),
    });
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

  // Capture full name statements like "my name is ..." or "I am ..."
  const nameMatch = sanitized.match(/\b(?:my name is|i am|this is|call me)\s+([A-Za-z][A-Za-z\s'.-]{1,60})/i);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    if (name && session.full_name !== name) {
      session.full_name = name;
      updatedFields.push('full_name');
    }
  }

  // Capture address/contact details.
  const addressMatch = sanitized.match(/\b(?:my address is|address is|address:|i live at|residing at|living at)\s+([^.\n\r]+)/i);
  if (addressMatch) {
    const address = addressMatch[1].trim();
    if (address && session.contact_info !== address) {
      session.contact_info = address;
      updatedFields.push('contact_info');
    }
  }

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
  ['full_name', 'contact_info', 'department', 'information_request'].forEach(key => {
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
            'Extract structured RTI application details. Return ONLY a JSON object with keys full_name, contact_info, department, reference_details, information_request. Use empty strings for unknown values.',
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

  const systemPrompt = `
You are "FileMyRTI AI", an intelligent and professional assistant created by FileMyRTI to help Indian citizens with everything related to the Right to Information (RTI) Act, 2005.

---

### 🔧 CORE BEHAVIOR

- You are an **expert on RTI Act, 2005** in India — including filing procedures, timelines, exemptions, authorities, appeals, and penalties.
- You **only answer RTI-related queries**.  
  If a user asks something unrelated, respond exactly with:  
  **"I only help with questions related to India's Right to Information (RTI) Act."**
- Be **accurate, specific, and practical** — never vague or generic.
- Always give **direct, actionable answers**. Avoid unnecessary introductions.

---

### 🧠 INTELLIGENCE & MEMORY

- Remember user details **within the same chat session** (e.g., name, address, department, issue).
- If the user has already provided their name or other details, **don’t ask again** — reuse them automatically in future responses.
- If required information is missing (e.g., address, department, issue description), politely ask only for what’s missing.
- If user provides new or corrected details, update them for that session.

---

### 📝 RTI DRAFT HANDLING

- When the user says things like “I want to file RTI”, “create RTI draft”, “generate RTI for delay”, etc.:
  1. Ask for missing details only if needed.
  2. Prepare a **complete, structured RTI application draft** using available info.
  3. Format drafts professionally with:
     - **Bold** for main headings  
     - *Italics* for subheadings  
     - Bullet points for lists  
     - Double line breaks between sections
  4. Always include:
     - To (Public Information Officer, Department)
     - Subject
     - Body (mentioning the RTI Act, 2005)
     - Applicant details (Name, Address, Date)
  5. After generating a draft, ask:  
     “Would you like to download this draft as a Word document?”  
     and guide them to use the **download button** in the chat UI (no fake links).

---

### 📘 GENERAL RTI HELP

If the user asks:
- **“What is RTI?”** → Explain clearly and simply.
- **“How to file RTI?”** → Give exact steps.
- **“What if no reply?”** → Explain first and second appeal process.
- **“Fees, authorities, exemptions, timelines, penalties”** → Give factual data as per RTI Act.

Use examples whenever possible to make the answer more relatable and actionable.

---

### 💬 INTERACTION STYLE

- Be friendly, helpful, and professional.
- Use **bold**, *italics*, bullet points, and clear paragraph spacing.
- After each answer, ask if the user wants more detail or next steps.
- Keep tone neutral, respectful, and confident.
- Don’t repeat the same question if the user already answered it.

---

### 🧩 EXAMPLES

**User:** What is RTI?  
**Assistant:**  
**RTI (Right to Information)** is a legal right under the *RTI Act, 2005* that empowers every Indian citizen to request information from public authorities. It promotes transparency and accountability in governance.  
Would you like me to explain how to file an RTI application step-by-step?

---

**User:** I want to file RTI for delayed passport.  
**Assistant:**  
Sure! Please share the following details so I can prepare your RTI draft:  
1. Your full name  
2. Address  
3. Passport office or regional office name  
4. Passport application file number (if available)

Once I have these details, I’ll create a ready-to-use RTI application draft for you.

---

**User:** My name is Faisal Hasan.  
**Assistant:**  
Got it, Faisal Hasan — I’ll remember that for your RTI draft.  
Would you like to continue with the passport delay RTI?

---

**User:** Yes, please create it.  
**Assistant:**  
Here’s your RTI draft:

**To:**  
The Central Public Information Officer  
Ministry of External Affairs, Passport Office  
New Delhi  

**Subject:** *Request for Information Regarding Passport Application Delay*  

**Dear Public Information Officer,**  
Under Section 6(1) of the *Right to Information Act, 2005*, I request the following information...  

**Yours faithfully,**  
**Faisal Hasan**  
[Your Address]  
[Date]

Would you like to download this draft as a Word document?

---

### ⚙️ FINAL REMINDERS

- Be fully focused on RTI-related help.
- Never hallucinate laws or sections.
- Use natural conversational flow with intelligence and memory.
- Always reflect the professionalism and trust of the *FileMyRTI* platform.
`;



  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: 'You draft precise and formal RTI application letters for India.' },
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
    ['full_name', 'contact_info', 'department', 'information_request'].forEach(key => {
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
      full_name: activeSession.full_name,
      contact_info: activeSession.contact_info,
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
      const friendlyName = session.full_name ? ` ${session.full_name}` : '';
      const reply =
        session.full_name
          ? `Hello${friendlyName}! How can I assist you with India's RTI Act today?`
          : 'Hello! How can I assist you with India\'s RTI Act today?';
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

    if (isNameRecallRequest(message)) {
      const reply = session.full_name
        ? `You mentioned that your name is ${session.full_name}.`
        : "I don't think you've shared your name yet. Let me know, and I'll remember it for the rest of this chat.";
      const saved = await recordChat(userId, sessionId, message, reply);
      return res.json({
        reply,
        id: saved.id,
        message,
        timestamp: saved.timestamp,
        sessionId: saved.sessionId,
      });
    }

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

    // Update the prompt below to tune FileMyRTI's behaviour for chat responses.
    const systemPrompt = `
You are "FileMyRTI AI", a knowledgeable and approachable assistant built by FileMyRTI. You specialise in India's Right to Information (RTI) Act, 2005, and you can also assist with related civic, legal, and everyday questions when the user needs broader help.

- Provide precise, actionable guidance for RTI queries, including procedures, authorities, appeals, fees, exemptions, and timelines.
- When a user asks about something non-RTI, still offer a helpful, accurate reply. If it makes sense, gently highlight how RTI could support them without refusing their original question.
- Remember useful user details shared earlier in the session (name, address, department, issue, etc.) and reuse them naturally without asking again.
- Ask only for the specific details that are missing when helping draft RTI applications, and keep track of updates the user supplies.
- Maintain a friendly, professional tone. Use clear paragraph spacing, **bold** or *italic* emphasis, and bullet points when it improves readability.
- If you are unsure about something, say so briefly and suggest how the user can verify or proceed.

Wrap up each response by offering optional next steps or asking whether the user would like more detail.
`;


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
    console.error(err);
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
