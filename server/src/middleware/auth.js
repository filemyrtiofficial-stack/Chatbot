import { getCookieNames, verifyAccessToken } from '../utils/tokens.js';

export function authMiddleware(req, res, next) {
  const { ACCESS_COOKIE_NAME } = getCookieNames();
  const authHeader = req.headers['authorization'] || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = req.cookies?.[ACCESS_COOKIE_NAME] || null;
  const token = bearer || cookieToken;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      pictureUrl: payload.pictureUrl ?? null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
