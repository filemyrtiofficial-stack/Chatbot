import express from 'express';
import bcrypt from 'bcryptjs';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { z } from 'zod';
import { pool } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  clearAuthCookies,
  generateRefreshToken,
  getCookieNames,
  hashRefreshToken,
  setAuthCookies,
  signAccessToken,
} from '../utils/tokens.js';
import {
  deleteRefreshToken,
  findRefreshTokenByHash,
  limitRefreshTokensForUser,
  purgeExpiredRefreshTokens,
  saveRefreshToken,
} from '../models/refreshTokens.js';
import { getConfig } from '../config.js';

const router = express.Router();
const config = getConfig();
const googleEnabled = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        callbackURL: config.GOOGLE_CALLBACK_URL,
      },
      (accessToken, refreshToken, profile, done) => {
        done(null, profile);
      }
    )
  );
}

router.use(passport.initialize());

const signupSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(72),
});

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    pictureUrl: row.picture_url ?? row.pictureUrl ?? null,
  };
}

async function issueTokens(res, user) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    pictureUrl: user.pictureUrl ?? null,
  };
  const accessToken = signAccessToken(payload);
  const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();
  await purgeExpiredRefreshTokens();
  await saveRefreshToken(user.id, tokenHash, expiresAt);
  await limitRefreshTokensForUser(user.id);
  setAuthCookies(res, accessToken, refreshToken);
}

function ensureGoogleConfigured(req, res, next) {
  if (!googleEnabled) {
    return res.status(503).json({ error: 'Google OAuth is not configured' });
  }
  return next();
}

function resolveClientUrl(path = '/') {
  const base = config.CLIENT_ORIGIN.replace(/\/+$/, '');
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${safePath}`;
}

function buildDisplayName(profile) {
  const full = profile.displayName?.trim();
  if (full) return full;
  const parts = [profile.name?.givenName, profile.name?.familyName]
    .filter(Boolean)
    .map(part => String(part).trim());
  if (parts.length > 0) {
    return parts.join(' ');
  }
  const email = profile.emails?.[0]?.value;
  if (email) {
    return email.split('@')[0];
  }
  return 'Google User';
}

function extractPicture(profile) {
  const photo = profile.photos?.[0]?.value;
  return photo || null;
}

async function upsertGoogleUser(profile) {
  const googleId = profile.id;
  const email = profile.emails?.[0]?.value?.toLowerCase();
  if (!googleId || !email) {
    const error = new Error('Google account details are incomplete');
    error.statusCode = 400;
    throw error;
  }
  const displayName = buildDisplayName(profile);
  const picture = extractPicture(profile);

  const [existingByGoogle] = await pool.query(
    'SELECT id, name, email, picture_url FROM users WHERE google_id = ?',
    [googleId]
  );
  if (existingByGoogle.length > 0) {
    const userRow = existingByGoogle[0];
    const shouldUpdate =
      (displayName && displayName !== userRow.name) || picture !== userRow.picture_url;
    if (shouldUpdate) {
      await pool.query('UPDATE users SET name = ?, picture_url = ? WHERE id = ?', [
        displayName || userRow.name,
        picture,
        userRow.id,
      ]);
      return mapUser({ ...userRow, name: displayName || userRow.name, picture_url: picture });
    }
    return mapUser(userRow);
  }

  const [existingByEmail] = await pool.query(
    'SELECT id, name, email, picture_url FROM users WHERE email = ?',
    [email]
  );
  if (existingByEmail.length > 0) {
    const row = existingByEmail[0];
    await pool.query('UPDATE users SET google_id = ?, name = ?, picture_url = ? WHERE id = ?', [
      googleId,
      displayName || row.name,
      picture,
      row.id,
    ]);
    return mapUser({ ...row, name: displayName || row.name, picture_url: picture });
  }

  const [result] = await pool.query(
    'INSERT INTO users (name, email, google_id, picture_url) VALUES (?, ?, ?, ?)',
    [displayName, email, googleId, picture]
  );
  return mapUser({
    id: result.insertId,
    name: displayName,
    email,
    picture_url: picture,
  });
}

router.post('/signup', async (req, res, next) => {
  try {
    const body = signupSchema.parse(req.body);
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [body.email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [body.name, body.email, passwordHash]
    );
    const user = { id: result.insertId, name: body.name, email: body.email, pictureUrl: null };
    await issueTokens(res, user);
    return res.status(201).json({ user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors.map(e => e.message).join(', ') });
    }
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const [rows] = await pool.query(
      'SELECT id, name, email, password_hash, picture_url FROM users WHERE email = ?',
      [body.email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userRow = rows[0];
    const valid = await bcrypt.compare(body.password, userRow.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = mapUser(userRow);
    await issueTokens(res, user);
    return res.json({ user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors.map(e => e.message).join(', ') });
    }
    return next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const { REFRESH_COOKIE_NAME } = getCookieNames();
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const entry = await findRefreshTokenByHash(tokenHash);
      if (entry) {
        await deleteRefreshToken(entry.userId, tokenHash);
      }
    }
    clearAuthCookies(res);
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { REFRESH_COOKIE_NAME } = getCookieNames();
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token missing' });
    }
    const tokenHash = hashRefreshToken(refreshToken);
    const entry = await findRefreshTokenByHash(tokenHash);
    if (!entry) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Refresh token invalid' });
    }
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      await deleteRefreshToken(entry.userId, tokenHash);
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    await deleteRefreshToken(entry.userId, tokenHash);
    const [rows] = await pool.query('SELECT id, name, email, picture_url FROM users WHERE id = ?', [
      entry.userId,
    ]);
    if (rows.length === 0) {
      clearAuthCookies(res);
      return res.status(404).json({ error: 'User not found' });
    }
    const user = mapUser(rows[0]);
    await issueTokens(res, user);
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
});

const googleFailureRedirect = resolveClientUrl('/login?error=google');

router.get(
  '/google',
  ensureGoogleConfigured,
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
  })
);

router.get(
  '/google/callback',
  ensureGoogleConfigured,
  passport.authenticate('google', {
    session: false,
    failureRedirect: googleFailureRedirect,
  }),
  async (req, res) => {
    try {
      const profile = req.user;
      if (!profile) {
        return res.redirect(`${googleFailureRedirect}&reason=missing_profile`);
      }
      const user = await upsertGoogleUser(profile);
      await issueTokens(res, user);
      return res.redirect(resolveClientUrl('/'));
    } catch (err) {
      req.log?.error?.(err);
      return res.redirect(`${googleFailureRedirect}&reason=server_error`);
    }
  }
);

router.get('/me', authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

export default router;
