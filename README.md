FileMyRTI Chatbot

Overview
- MERN-style app (React + Node/Express) using MySQL and OpenAI.
- Focused strictly on India's RTI Act. Unrelated questions return: "I can only help you with RTI-related queries for India's RTI Act."
- Supports guided RTI draft creation with downloadable letters per conversation.

Structure
- `server`: Express API (auth, chat history, RTI draft workflow, OpenAI integration)
- `client`: Vite + React UI (login, signup, protected chat interface)

Requirements
- Node.js 18+
- MySQL 8+
- OpenAI API key

Setup
1) Backend
   - Copy `server/.env.example` to `server/.env` and fill in the values.
   - Ensure MySQL is running and credentials match.
   - From `filemyrti-chatbot/server` run:
     - `npm install`
     - `npm run dev`

   Notes
   - Database tables are created automatically on server start if missing.
   - CORS allows `http://localhost:5173` by default (configure via `CLIENT_ORIGIN`).

2) Frontend
   - Optional: create `client/.env` and set `VITE_API_BASE=http://localhost:5000` if the backend URL differs.
   - From `filemyrti-chatbot/client` run:
     - `npm install`
     - `npm run dev`

Usage
- Visit `http://localhost:5173`.
- Sign up or log in.
- Ask RTI-related questions or start an application draft in the chat.
- When a draft is ready, download the generated RTI letter from the conversation list.

Security
- Passwords are hashed with bcryptjs (12 rounds).
- Auth uses short-lived access tokens and rotating refresh tokens stored in httpOnly cookies.
- Helmet, rate limiting, and structured logging (pino) are enabled by default.
- Sample environment variables never include real secrets.

Environment Variables (server)
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (default: gpt-4o-mini)
- `JWT_SECRET` (required in production)
- `ACCESS_TOKEN_TTL_MINUTES` (default: 15)
- `REFRESH_TOKEN_TTL_DAYS` (default: 7)
- `RATE_LIMIT_WINDOW_MINUTES` / `RATE_LIMIT_MAX_REQUESTS`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `CLIENT_ORIGIN` (default: http://localhost:5173)
- `ADMIN_WHATSAPP_NUMBER` (optional) - Admin's WhatsApp number to receive contact form notifications (format: +91XXXXXXXXXX)

WhatsApp Notifications
- When users submit the contact form, admins receive WhatsApp notifications via WhatsApp Web
- Uses Puppeteer to automate WhatsApp Web (no API keys required, completely free)
- Setup:
  1. Add `ADMIN_WHATSAPP_NUMBER` to your `.env` file
  2. On first run, the browser will open and show WhatsApp Web QR code
  3. Scan the QR code with your phone's WhatsApp
  4. The session will be saved and reused for future messages
  5. In production, run with `headless: true` (set `NODE_ENV=production`)
- Note: Requires Chrome/Chromium to be installed on the server
