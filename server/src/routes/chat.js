import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const FALLBACK = "I only help with questions related to India's Right to Information (RTI) Act.";
const CLARIFY =
  'Please specify your RTI-related query or provide details on the information you seek, so I can guide you on the right RTI application, filing steps, or applicable rules in India.';

const GREETING_WORDS = ['hi', 'hello', 'hey', 'namaste', 'good morning', 'good evening', 'good afternoon'];
const RTI_KEYWORDS = [
  'rti',
  'right to information',
  'rti act',
  'rti application',
  'rti draft',
  'file rti',
  'submit rti',
  'rti appeal',
  'information commission',
  'public information officer',
  'pio',
  'first appeal',
  'second appeal',
  'central information commission',
  'state information commission',
];
const GENERAL_RTI_PATTERNS = [
  /what is (the )?rti/i,
  /what does rti/i,
  /how (do|to) (i )?(file|submit) (an )?rti/i,
  /tell me about rti/i,
  /who can file an? rti/i,
  /when can i file an? rti/i,
];
const GENERIC_CLARIFICATION_PATTERNS = [
  /^rti$/i,
  /^help with rti$/i,
  /^i need help with rti/i,
  /^guide me on rti/i,
  /^need rti help/i,
];
const DRAFT_TRIGGER_REGEX = /(file|draft|write|prepare|compose|create)\s+(an?\s+)?rti(\s+(application|draft))?/i;
const REQUIRED_SESSION_FIELDS = ['name', 'address', 'department', 'informationRequest'];

// Simple in-memory session store keyed by userId to retain user-provided details during the conversation.
const sessionStore = new Map();

function normalizeMessage(message = '') {
  return message.toString().trim();
}

export function isGreeting(message = '') {
  const normalized = normalizeMessage(message).toLowerCase();
  if (!normalized) return false;
  return GREETING_WORDS.some(word => new RegExp(`\\b${word}\\b`, 'i').test(normalized));
}

export function isRtiRelated(message = '') {
  const normalized = normalizeMessage(message).toLowerCase();
  if (!normalized) return false;
  return RTI_KEYWORDS.some(keyword => normalized.includes(keyword));
}

export function isGeneralRtiQuestion(message = '') {
  return GENERAL_RTI_PATTERNS.some(pattern => pattern.test(message));
}

export function needsClarification(message = '') {
  if (GENERIC_CLARIFICATION_PATTERNS.some(pattern => pattern.test(message))) {
    return true;
  }
  const normalized = normalizeMessage(message).toLowerCase();
  if (!normalized) return false;
  const tokens = normalized.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const genericTokens = new Set(['help', 'need', 'rti', 'file', 'filing', 'application', 'draft', 'information', 'info']);
  const allGeneric = tokens.every(token => genericTokens.has(token));
  return allGeneric && tokens.length <= 4;
}

export function classifyUserMessage(message = '') {
  const trimmed = normalizeMessage(message);
  const lower = trimmed.toLowerCase();
  if (!trimmed) {
    return 'non_rti';
  }
  if (isGreeting(trimmed) && !isRtiRelated(trimmed) && !isGeneralRtiQuestion(trimmed)) {
    return 'greeting';
  }
  const providesPersonalInfo = /\b(my name is|i am|this is|call me|my address is|address:|i live at|department|authority|information (?:about|regarding|on))\b/i.test(
    trimmed
  );
  if (DRAFT_TRIGGER_REGEX.test(trimmed) || /rti\s+draft/i.test(lower)) {
    return 'draft_request';
  }
  if (!isRtiRelated(trimmed) && !isGeneralRtiQuestion(trimmed) && !providesPersonalInfo) {
    return 'non_rti';
  }
  if (providesPersonalInfo) {
    return 'personal_info';
  }
  if (isGeneralRtiQuestion(trimmed)) {
    return 'general_question';
  }
  if (needsClarification(trimmed)) {
    return 'clarification';
  }
  return 'rti_help';
}

function getSession(userId) {
  if (!sessionStore.has(userId)) {
    sessionStore.set(userId, {
      name: '',
      address: '',
      department: '',
      informationRequest: '',
      awaitingDraft: false,
      lastUpdated: Date.now(),
    });
  }
  return sessionStore.get(userId);
}

function cleanCapturedValue(value = '') {
  return value.split(/[\n.;]/)[0]?.trim() || '';
}

function extractPersonalInfo(message = '') {
  const info = {};
  const nameMatch = message.match(/\b(?:my name is|i am|this is|call me)\s+([A-Za-z][A-Za-z\s'.-]{1,60})/i);
  if (nameMatch) {
    info.name = cleanCapturedValue(nameMatch[1]);
  }
  const addressMatch = message.match(/\b(?:my address is|address is|address:|i live at|living at|residing at)\s+([^.;\n]+)/i);
  if (addressMatch) {
    info.address = cleanCapturedValue(addressMatch[1]);
  }
  const departmentMatch = message.match(/\b(?:department|authority|office|ministry)\s*(?:is|:)\s*([^.;\n]+)/i);
  if (departmentMatch) {
    info.department = cleanCapturedValue(departmentMatch[1]);
  }
  const infoRequestMatch =
    message.match(/\b(?:information (?:regarding|about|on)|details (?:regarding|about)|i am seeking|i want information(?: on| about)?)\s+([^.;\n]+)/i) ||
    message.match(/\b(?:regarding|about)\s+my\s+rti\s+(?:application|request)\s*([^.;\n]+)/i);
  if (infoRequestMatch) {
    info.informationRequest = cleanCapturedValue(infoRequestMatch[1]);
  }
  return info;
}

function updateSessionWithInfo(session, extractedInfo) {
  const storedFields = [];
  for (const field of Object.keys(extractedInfo)) {
    const value = extractedInfo[field].trim();
    if (!value) continue;
    if (session[field] !== value) {
      session[field] = value;
      storedFields.push(field);
    }
  }
  if (storedFields.length) {
    session.lastUpdated = Date.now();
  }
  return storedFields;
}

function getMissingFields(session) {
  return REQUIRED_SESSION_FIELDS.filter(field => !session[field]);
}

function buildRtiDraft(session) {
  const applicantName = session.name || '<<Full Name>>';
  const address = session.address || '<<Complete Address with contact number/email>>';
  const department = session.department || '<<Department / Public Authority>>';
  const informationRequest = session.informationRequest || '<<Clearly list the information you are seeking>>';

  return `### RTI Application Draft

**Applicant Name:** ${applicantName}
**Contact Information:** ${address}
**Department / Authority:** ${department}

#### Subject
Request for information under the Right to Information Act, 2005.

#### Body
To,
The Public Information Officer
${department}

Dear Sir/Madam,

I, ${applicantName}, am filing this application under the Right to Information Act, 2005. Please provide me with the following information:

- ${informationRequest}

Kindly supply the information in accordance with the provisions of the Act. If any part of the requested information is held by another authority, please transfer the request under Section 6(3) and inform me.

#### Declaration
- I am an Indian citizen.
- I am enclosing the application fee as per the prescribed rules, or please inform me of the payment requirements.

Thank you for your assistance.

Yours faithfully,
${applicantName}
${address}`;
}

function formatMissingList(fields) {
  if (!fields.length) return '';
  if (fields.length === 1) return fields[0] === 'informationRequest' ? 'the details of the information you need' : `your ${fields[0]}`;
  const readable = fields.map(field =>
    field === 'informationRequest' ? 'details of the information you need' : `your ${field}`
  );
  return `${readable.slice(0, -1).join(', ')} and ${readable.at(-1)}`;
}

function buildAcknowledgement(fields, session) {
  const parts = [];
  if (fields.includes('name')) {
    parts.push(`Nice to meet you, ${session.name}.`);
  }
  if (fields.includes('address')) {
    parts.push('Thanks for sharing your contact information.');
  }
  if (fields.includes('department')) {
    parts.push('Noted the department you wish to address.');
  }
  if (fields.includes('informationRequest')) {
    parts.push('I have captured the details of the information you are seeking.');
  }
  return parts.join(' ');
}

app.post('/chat', (req, res) => {
  const { userId, message } = req.body || {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const trimmedMessage = normalizeMessage(message);
  const lowerMessage = trimmedMessage.toLowerCase();
  const session = getSession(userId);

  const extractedInfo = extractPersonalInfo(trimmedMessage);
  const newlyStoredFields = updateSessionWithInfo(session, extractedInfo);

  const classification = classifyUserMessage(trimmedMessage);
  const missingFieldsAfterUpdate = getMissingFields(session);

  // Greeting responses do not interfere with RTI intent handling.
  const greetingDetected = isGreeting(trimmedMessage);
  const greetingPrefix =
    greetingDetected && (classification !== 'non_rti' || isRtiRelated(trimmedMessage))
      ? session.name
        ? `Hello ${session.name}! `
        : 'Hello! '
      : '';

  if (classification === 'greeting') {
    let reply = greetingPrefix || (session.name ? `Hello ${session.name}! ` : 'Hello! ');
    if (session.awaitingDraft && missingFieldsAfterUpdate.length) {
      reply += `I can finish your RTI draft once you share ${formatMissingList(missingFieldsAfterUpdate)}.`;
    } else {
      reply += 'How can I assist you with India\'s RTI Act today?';
    }
    return res.json({ reply: reply.trim() });
  }

  if (classification === 'non_rti') {
    return res.json({ reply: FALLBACK });
  }

  if (classification === 'general_question') {
    const reply =
      `${greetingPrefix}The Right to Information Act, 2005 empowers Indian citizens to request information from public authorities. ` +
      'You can file an RTI by addressing the concerned Public Information Officer (PIO), paying the prescribed fee, and clearly stating the information you seek. ' +
      'Let me know if you would like guidance on drafting a request or identifying the correct department.';
    return res.json({ reply: reply.trim() });
  }

  if (classification === 'clarification') {
    const reply = `${greetingPrefix}${CLARIFY}`.trim();
    return res.json({ reply });
  }

  const autoDraftReady = session.awaitingDraft && missingFieldsAfterUpdate.length === 0;

  if (classification === 'draft_request') {
    if (missingFieldsAfterUpdate.length === 0) {
      session.awaitingDraft = false;
      const draft = buildRtiDraft(session);
      const reply = `${greetingPrefix}Here is your RTI draft:\n\n${draft}`.trim();
      return res.json({ reply });
    }
    session.awaitingDraft = true;
    const reply =
      `${greetingPrefix}Happy to prepare your RTI draft. Please share ${formatMissingList(missingFieldsAfterUpdate)} so I can auto-fill the application.`.trim();
    return res.json({ reply });
  }

  if (autoDraftReady) {
    session.awaitingDraft = false;
    const draft = buildRtiDraft(session);
    const reply = `${greetingPrefix}Here is your RTI draft with the details you shared:\n\n${draft}`.trim();
    return res.json({ reply });
  }

  if (classification === 'personal_info') {
    const acknowledgement = buildAcknowledgement(newlyStoredFields, session) || 'Thanks for sharing your details.';
    if (session.awaitingDraft) {
      if (missingFieldsAfterUpdate.length === 0) {
        session.awaitingDraft = false;
        const draft = buildRtiDraft(session);
        const reply = `${greetingPrefix}${acknowledgement} Here is your RTI draft:\n\n${draft}`.trim();
        return res.json({ reply });
      }
      const reply = `${greetingPrefix}${acknowledgement} Once you provide ${formatMissingList(missingFieldsAfterUpdate)}, I will send the RTI draft.`.trim();
      return res.json({ reply });
    }
    const reply = `${greetingPrefix}${acknowledgement} Let me know when you\'re ready to proceed with your RTI query or draft.`.trim();
    return res.json({ reply });
  }

  if (classification === 'rti_help' || isRtiRelated(lowerMessage)) {
    if (needsClarification(trimmedMessage)) {
      const reply = `${greetingPrefix}${CLARIFY}`.trim();
      return res.json({ reply });
    }
    const reply =
      `${greetingPrefix}I\'m here to help with RTI matters. You can ask me to prepare a draft, explain RTI rules, or clarify filing steps. ` +
      'Share the specifics of your request, and I\'ll guide you further.';
    return res.json({ reply: reply.trim() });
  }

  return res.json({ reply: FALLBACK });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`FileMyRTI assistant running on port ${PORT}`);
});

export default app;
