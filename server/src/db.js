import mysql from 'mysql2/promise';
import { getConfig } from './config.js';

const {
  DB_HOST,
  DB_USER,
  DB_PASSWORD,
  DB_PORT,
  DB_NAME,
} = getConfig();

const baseConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD || '',
  port: DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

export let pool; // assigned after DB creation

export async function initDatabase() {
  // 1) Connect without database to ensure DB exists
  const admin = await mysql.createConnection({
    host: baseConfig.host,
    user: baseConfig.user,
    password: baseConfig.password,
    port: baseConfig.port,
  });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  } finally {
    await admin.end();
  }

  // 2) Create pool bound to the database
  pool = mysql.createPool({ ...baseConfig, database: DB_NAME });

  // 3) Create tables if missing
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(150) UNIQUE,
        password_hash VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        session_id VARCHAR(64),
        message TEXT,
        response TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const [sessionColumn] = await conn.query("SHOW COLUMNS FROM chats LIKE 'session_id'");
    if (sessionColumn.length === 0) {
      await conn.query('ALTER TABLE chats ADD COLUMN session_id VARCHAR(64) AFTER user_id');
    }

    const [indexRows] = await conn.query("SHOW INDEX FROM chats WHERE Key_name = 'idx_chats_session'");
    if (indexRows.length === 0) {
      await conn.query('CREATE INDEX idx_chats_session ON chats (session_id)');
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS rti_applications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        session_id VARCHAR(64) NOT NULL,
        status ENUM('collecting','completed') DEFAULT 'collecting',
        current_field VARCHAR(32),
        full_name TEXT,
        contact_info TEXT,
        department TEXT,
        reference_details TEXT,
        information_request TEXT,
        draft_text LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_rti_session (session_id),
        INDEX idx_rti_user (user_id)
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_refresh_user (user_id),
        CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  } finally {
    conn.release();
  }
}
