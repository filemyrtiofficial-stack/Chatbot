import express from 'express';
import bcrypt from 'bcryptjs';
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

const router = express.Router();

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
  return { id: row.id, name: row.name, email: row.email };
}

async function issueTokens(res, user) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();
  await purgeExpiredRefreshTokens();
  await saveRefreshToken(user.id, tokenHash, expiresAt);
  await limitRefreshTokensForUser(user.id);
  setAuthCookies(res, accessToken, refreshToken);
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
    const user = { id: result.insertId, name: body.name, email: body.email };
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
      'SELECT id, name, email, password_hash FROM users WHERE email = ?',
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
    const [rows] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [
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

router.get('/me', authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

export default router;
