import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().default('filemyrti'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required').optional(),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .min(1, 'GOOGLE_CLIENT_SECRET is required')
    .optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  ADMIN_WHATSAPP_NUMBER: z.string().default('918106342858'), // Admin's WhatsApp number to receive notifications
});

let cachedConfig;

export function getConfig() {
  if (cachedConfig) return cachedConfig;

  const parseResult = envSchema.safeParse(process.env);
  if (!parseResult.success) {
    console.error('Environment variable validation failed:', parseResult.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }

  cachedConfig = parseResult.data;

  if (
    !cachedConfig.GOOGLE_CALLBACK_URL &&
    cachedConfig.GOOGLE_CLIENT_ID &&
    cachedConfig.GOOGLE_CLIENT_SECRET
  ) {
    cachedConfig.GOOGLE_CALLBACK_URL = `http://localhost:${cachedConfig.PORT}/api/auth/google/callback`;
  }

  return cachedConfig;
}

export function isProduction() {
  const { NODE_ENV } = getConfig();
  return NODE_ENV === 'production';
}
