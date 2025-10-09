import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getConfig, isProduction } from '../config.js';

const ACCESS_COOKIE_NAME = 'filemyrti_access';
const REFRESH_COOKIE_NAME = 'filemyrti_refresh';

export function getCookieNames() {
  return { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME };
}

const config = getConfig();

const accessTokenOptions = {
  expiresIn: `${config.ACCESS_TOKEN_TTL_MINUTES}m`,
};

export function signAccessToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET, accessTokenOptions);
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_SECRET);
}

export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken() {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

export function setAuthCookies(res, accessToken, refreshToken) {
  const common = {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? 'strict' : 'lax',
    path: '/',
  };

  res.cookie(ACCESS_COOKIE_NAME, accessToken, {
    ...common,
    maxAge: config.ACCESS_TOKEN_TTL_MINUTES * 60 * 1000,
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...common,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res) {
  const base = {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? 'strict' : 'lax',
    path: '/',
  };
  res.clearCookie(ACCESS_COOKIE_NAME, base);
  res.clearCookie(REFRESH_COOKIE_NAME, base);
}
