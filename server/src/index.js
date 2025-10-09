import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { initDatabase } from './db.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import { authMiddleware } from './middleware/auth.js';
import { getConfig, isProduction } from './config.js';

const config = getConfig();
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);

const logger = pinoHttp({
  transport: isProduction()
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
});

const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use(logger);
app.use(
  cors({
    origin: config.CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(limiter);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) =>
  res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  req.log?.error(err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const message =
    status === 500 && isProduction() ? 'Internal server error' : err.message || 'Server error';
  return res.status(status).json({ error: message });
});

initDatabase()
  .then(() => {
    app.listen(config.PORT, () => {
      console.log(`FileMyRTI server listening on http://localhost:${config.PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
