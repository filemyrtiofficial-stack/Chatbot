import { pool } from '../db.js';

export async function saveRefreshToken(userId, tokenHash, expiresAt) {
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt]
  );
}

export async function deleteRefreshToken(userId, tokenHash) {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ? AND token_hash = ?', [
    userId,
    tokenHash,
  ]);
}

export async function purgeExpiredRefreshTokens() {
  await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
}

export async function findRefreshTokenByHash(tokenHash) {
  const [rows] = await pool.query(
    'SELECT id, user_id AS userId, expires_at AS expiresAt FROM refresh_tokens WHERE token_hash = ? LIMIT 1',
    [tokenHash]
  );
  return rows[0] || null;
}

export async function limitRefreshTokensForUser(userId, keepLatest = 5) {
  await pool.query(
    `
      DELETE FROM refresh_tokens
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM (
            SELECT id
            FROM refresh_tokens
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
          ) as recent_tokens
        )
    `,
    [userId, userId, keepLatest]
  );
}
