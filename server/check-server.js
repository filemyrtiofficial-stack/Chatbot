#!/usr/bin/env node
/**
 * Server Diagnostic Script
 * Run this to check if your server can start properly
 * Usage: node check-server.js
 */

import 'dotenv/config';
import { getConfig } from './src/config.js';
import mysql from 'mysql2/promise';

console.log('🔍 Server Diagnostic Check\n');
console.log('=' .repeat(50));

// 1. Check Environment Variables
console.log('\n1️⃣ Checking Environment Variables...');
try {
  const config = getConfig();
  console.log('✅ Environment variables validated');
  console.log(`   NODE_ENV: ${config.NODE_ENV}`);
  console.log(`   PORT: ${config.PORT}`);
  console.log(`   DB_HOST: ${config.DB_HOST}`);
  console.log(`   DB_NAME: ${config.DB_NAME}`);
  console.log(`   JWT_SECRET: ${config.JWT_SECRET ? '✅ Set (' + config.JWT_SECRET.length + ' chars)' : '❌ Missing'}`);
  console.log(`   OPENAI_API_KEY: ${config.OPENAI_API_KEY ? '✅ Set (' + config.OPENAI_API_KEY.substring(0, 10) + '...)' : '❌ Missing'}`);
} catch (err) {
  console.error('❌ Environment variable validation failed:');
  console.error('   ', err.message);
  if (err.flatten) {
    console.error('   Details:', err.flatten().fieldErrors);
  }
  process.exit(1);
}

// 2. Check Database Connection
console.log('\n2️⃣ Checking Database Connection...');
try {
  const config = getConfig();
  const testConn = await mysql.createConnection({
    host: config.DB_HOST,
    user: config.DB_USER,
    password: config.DB_PASSWORD || '',
    port: config.DB_PORT,
  });
  
  console.log('✅ Database server is reachable');
  
  // Test database exists
  const [dbs] = await testConn.query(`SHOW DATABASES LIKE ?`, [config.DB_NAME]);
  if (dbs.length > 0) {
    console.log(`✅ Database '${config.DB_NAME}' exists`);
  } else {
    console.log(`⚠️  Database '${config.DB_NAME}' does not exist (will be created)`);
  }
  
  await testConn.end();
} catch (err) {
  console.error('❌ Database connection failed:');
  console.error('   Error:', err.message);
  console.error('   Code:', err.code);
  console.error('   Errno:', err.errno);
  if (err.code === 'ECONNREFUSED') {
    console.error('\n   💡 Database server is not reachable');
    console.error('   Check: DB_HOST, DB_PORT, firewall rules');
  } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('\n   💡 Database credentials are incorrect');
    console.error('   Check: DB_USER, DB_PASSWORD');
  }
  process.exit(1);
}

// 3. Check OpenAI API Key Format
console.log('\n3️⃣ Checking OpenAI API Key...');
try {
  const config = getConfig();
  if (!config.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set');
    process.exit(1);
  }
  
  if (config.OPENAI_API_KEY.length < 20) {
    console.error('❌ OPENAI_API_KEY appears to be truncated');
    console.error(`   Length: ${config.OPENAI_API_KEY.length} (should be ~50+ chars)`);
    process.exit(1);
  }
  
  if (!config.OPENAI_API_KEY.startsWith('sk-')) {
    console.warn('⚠️  OPENAI_API_KEY does not start with "sk-"');
  } else {
    console.log('✅ OpenAI API key format looks correct');
  }
} catch (err) {
  console.error('❌ Error checking OpenAI API key:', err.message);
  process.exit(1);
}

// 4. Test Server Startup
console.log('\n4️⃣ Testing Server Startup...');
try {
  const express = (await import('express')).default;
  const app = express();
  
  // Minimal test
  app.get('/test', (req, res) => {
    res.json({ ok: true });
  });
  
  const testServer = app.listen(0, () => {
    const port = testServer.address().port;
    console.log(`✅ Express server can start (tested on port ${port})`);
    testServer.close();
  });
} catch (err) {
  console.error('❌ Server startup test failed:', err.message);
  process.exit(1);
}

console.log('\n' + '='.repeat(50));
console.log('✅ All checks passed! Server should start successfully.');
console.log('\nNext steps:');
console.log('1. Start server: npm start');
console.log('2. Or with PM2: pm2 start src/index.js --name chatbot-api');
console.log('3. Check health: curl http://localhost:5000/api/health\n');

