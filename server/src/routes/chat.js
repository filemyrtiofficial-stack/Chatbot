import express from 'express';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import { pool } from '../db.js';
import { getConfig } from '../config.js';

const router = express.Router();

const FALLBACK = "I can only help you with RTI-related queries for India's RTI Act.";
const CLARIFY =
  'Please specify your RTI-related query or provide details on the information you seek, so I can guide you on the right RTI application, filing steps, or applicable rules in India.';
const SERVICE_UNAVAILABLE =
  'The RTI assistant is temporarily unavailable because the OpenAI service is not configured. Please try again later.';

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
    'rti',
    'right to information',
    'information commission',
    'central information commission',
    'state information commission',
    'public information officer',
    'pio',
    'first appeal',
    'second appeal',
    'section 6',
    'section 7',
    'section 8',
    'rti application',
    'govt information',
    'government information',
    'appellate authority',
    'cic',
  ];
  return keywords.some(k => t.includes(k));
}

function needsClarification(text) {
  if (!text) return false;
  const normalized = text.trim().toLowerCase().replace(/[?.!]+$/g, '');
  if (!normalized) return false;

  const genericPatterns = [
    /^(how\s+to\s+file\s+(an?\s+)?rti)$/,
    /^(how\s+do\s+i\s+file\s+(an?\s+)?rti)$/,
    /^(help\s+(me\s+)?(file|with)\s+(an?\s+)?rti)$/,
    /^(rti\s+(help|info|information))$/,
    /^(tell\s+me\s+about\s+rti)$/,
    /^(what\s+is\s+the?\s*rti\s+act?)$/,
    /^(guide\s+me(\s+on|\s+about)?\s*(the)?\s*rti)$/,
    /^(how\s+to\s+apply\s+for\s+(an?\s+)?rti)$/,
  ];

  if (genericPatterns.some(rx => rx.test(normalized))) {
    return true;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= 4 && normalized.includes('rti')) {
    return true;
  }

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

  const prompt = `Create a formal Right to Information (RTI) application letter for India. Use the details below and format it as a ready-to-send letter:\n\n` +
    `Applicant Name: ${fieldValues.full_name}\n` +
    `Applicant Contact & Address: ${fieldValues.contact_info}\n` +
    `Department / Public Authority: ${fieldValues.department}\n` +
    `Reference Details: ${fieldValues.reference_details || 'None provided'}\n` +
    `Information Requested: ${fieldValues.information_request}\n\n` +
    `The letter must include:\n` +
    `1. Applicant address/contact block\n` +
    `2. Date line\n` +
    `3. Address block for the Public Information Officer (PIO) of the mentioned department\n` +
    `4. A subject line referencing the RTI Act, 2005\n` +
    `5. A clear body that lists the information sought in numbered points\n` +
    `6. A statement about RTI application fee (mentioning IPO/DD if applicable)\n` +
    `7. Preferred mode of receiving information\n` +
    `8. Closing with “Sincerely”, applicant name, and placeholders for signature and date\n` +
    `9. An enclosures line if references were provided.\n\n` +
    `Return only the formatted letter in plain text with blank lines between sections.`;

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

async function finalizeApplication(userId, application) {
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

async function handleRtiApplication({ userId, sessionId, message, existingApplication }) {
  const trimmed = message.trim();
  let application = existingApplication || (await getLatestApplication(userId, sessionId));
  const triggered = shouldStartApplication(trimmed);

  if (!application) {
    if (!triggered) return null;

    let extractedFields = null;
    if (client) {
      extractedFields = await extractApplicationDetailsFromMessage(trimmed);
    }

    application = await createApplication(userId, sessionId);
    let recognizedFields = {};
    if (extractedFields) {
      recognizedFields = collectNonEmptyFields(extractedFields);
      if (Object.keys(recognizedFields).length > 0) {
        await setApplicationState(application.id, recognizedFields);
        application = { ...application, ...recognizedFields };
      }
    }

    const allFieldsPresent = hasAllRequiredFields(extractedFields);
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

      return finalizeApplication(userId, application);
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
    return finalizeApplication(userId, application);
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

  return finalizeApplication(userId, application);
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

    const existingApplication = await getLatestApplication(userId, sessionId);
    const hasCollectingApplication =
      existingApplication && existingApplication.status === 'collecting';

    // If unrelated, respond immediately with fallback
    if (!isRTIRelated(message) && !hasCollectingApplication) {
      const saved = await recordChat(userId, sessionId, message, FALLBACK);
      return res.json({
        reply: FALLBACK,
        id: saved.id,
        message,
        timestamp: saved.timestamp,
        sessionId: saved.sessionId,
      });
    }

    const rtiFlow = await handleRtiApplication({
      userId,
      sessionId,
      message,
      existingApplication,
    });

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

    if (needsClarification(message)) {
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
      return res.status(503).json({ error: SERVICE_UNAVAILABLE });
    }

    const systemPrompt = `
You are FileMyRTI, an assistant ONLY for India's Right to Information (RTI) Act.
1. Respond ONLY to RTI-related queries. If unrelated, reply exactly with "${FALLBACK}".
2. Ask relevant questions when the user's input is incomplete. Do NOT ask unnecessary questions.
3. Gather essential information for an RTI draft:
   - To (public authority)
   - From (applicant's name & address)
   - Details of information requested
   - Any applicable references or documents
  4. If the user doesn't provide To/From details, still generate a complete RTI draft using placeholders like "[Applicant Name]" or "[Public Authority]".
  5. Keep answers concise, clear, friendly, and under 200 words. Avoid legal advice. Provide practical steps like filing method, fees, and timelines.
  6. Always keep context of previous user inputs to avoid repeated questions.
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

    // Safety: enforce fallback if model ignored instructions
    if (!isRTIRelated(reply)) {
      reply = FALLBACK;
    }

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
