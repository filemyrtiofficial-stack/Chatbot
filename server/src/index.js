//indexedDB.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { initDatabase, pool } from './db.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import contactRoutes from './routes/contact.js';
import { authMiddleware } from './middleware/auth.js';
import { getConfig, isProduction } from './config.js';

const config = getConfig();
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // Trust only the first proxy (for rate limiting security)

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

app.get('/api/health', async (req, res) => {
  try {
    // Test database connection if pool is initialized
    if (pool) {
      await pool.query('SELECT 1');
      return res.json({ 
        ok: true, 
        uptime: process.uptime(), 
        timestamp: new Date().toISOString(),
        database: 'connected'
      });
    }
    return res.json({ 
      ok: true, 
      uptime: process.uptime(), 
      timestamp: new Date().toISOString(),
      database: 'initializing'
    });
  } catch (err) {
    return res.status(503).json({ 
      ok: false, 
      error: 'Database unavailable',
      timestamp: new Date().toISOString(),
      message: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/contact', contactRoutes); // No auth required for contact form

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
    const server = app.listen(config.PORT, '0.0.0.0', () => {
      console.log(`FileMyRTI server listening on http://0.0.0.0:${config.PORT}`);
      console.log(`Environment: ${config.NODE_ENV}`);
      console.log(`Health check: http://localhost:${config.PORT}/api/health`);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        if (pool) {
          pool.end(() => {
            console.log('Database pool closed');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      });
    });
  })
  .catch(err => {
    console.error('Failed to initialize database', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState
    });
    process.exit(1);
  });
