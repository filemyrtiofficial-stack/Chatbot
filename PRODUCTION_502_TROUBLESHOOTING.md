# Production 502 Bad Gateway - Troubleshooting Guide

## What is a 502 Error?

A **502 Bad Gateway** means your reverse proxy (nginx/apache/cloudflare) can reach your server, but the server is either:
- ❌ Not running
- ❌ Crashed on startup
- ❌ Not listening on the expected port
- ❌ Taking too long to respond (timeout)
- ❌ Misconfigured

---

## 🔍 **Step-by-Step Diagnosis**

### Step 1: Check if Server Process is Running

**On your production server, run:**
```bash
# Check if Node.js process is running
ps aux | grep node

# Or check specific port
netstat -tulpn | grep :5000
# or
lsof -i :5000

# Check with PM2 (if using)
pm2 list
pm2 logs
```

**Expected:** You should see your Node.js process running on port 5000 (or configured port).

---

### Step 2: Check Server Logs

**Most common issue:** Server crashed on startup due to:
- Missing environment variables
- Database connection failure
- Invalid configuration

**Check logs:**
```bash
# If using PM2
pm2 logs chatbot-api --lines 100

# If using systemd
journalctl -u chatbot-api -n 100

# If running directly
# Check where your logs are (stdout/stderr)
```

**Look for errors like:**
- `Environment variable validation failed`
- `Failed to initialize database`
- `ECONNREFUSED` (database connection)
- `JWT_SECRET must be at least 32 characters`

---

### Step 3: Verify Environment Variables

**On production server, check `.env` file:**
```bash
cd /path/to/your/server
cat .env
```

**Required variables:**
- ✅ `NODE_ENV=production`
- ✅ `PORT=5000` (or your configured port)
- ✅ `OPENAI_API_KEY=sk-...` (complete key)
- ✅ `JWT_SECRET=...` (at least 32 characters)
- ✅ `DB_HOST=...`
- ✅ `DB_USER=...`
- ✅ `DB_PASSWORD=...`
- ✅ `DB_NAME=...`
- ✅ `CLIENT_ORIGIN=https://yourdomain.com`

**Common issues:**
- Missing `NODE_ENV=production`
- Truncated `OPENAI_API_KEY`
- Wrong `CLIENT_ORIGIN` (should be production URL)
- Database credentials incorrect

---

### Step 4: Test Database Connection

**The server crashes if database connection fails:**
```bash
# Test database connection manually
mysql -h YOUR_DB_HOST -u YOUR_DB_USER -p YOUR_DB_NAME
```

**If connection fails:**
- Check database server is running
- Verify credentials
- Check firewall rules
- Verify database host is accessible from production server

---

### Step 5: Check Reverse Proxy Configuration

**If using nginx, check config:**
```nginx
location /api {
    proxy_pass http://localhost:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
}
```

**Common issues:**
- Wrong port in `proxy_pass`
- Timeout too short
- Missing headers

---

### Step 6: Test Server Directly

**Bypass reverse proxy to test:**
```bash
# On production server
curl http://localhost:5000/api/health

# Should return:
# {"ok":true,"uptime":123.45,"timestamp":"2024-..."}
```

**If this fails:** Server is not running or crashed.

---

## 🚨 **Most Common Causes & Fixes**

### 1. Server Crashed on Startup (90% of cases)

**Symptoms:**
- Process not running
- Logs show startup error

**Fix:**
```bash
# Check what error occurred
cd /path/to/server
node src/index.js

# Fix the error (usually env vars or database)
# Then restart with PM2
pm2 restart chatbot-api
```

---

### 2. Missing Environment Variables

**Symptoms:**
- `Environment variable validation failed` in logs

**Fix:**
```bash
# Create/update .env file with all required vars
nano .env

# Verify all vars are set
node -e "require('dotenv').config(); console.log(process.env.JWT_SECRET?.length)"
```

---

### 3. Database Connection Failed

**Symptoms:**
- `ECONNREFUSED` or `ER_ACCESS_DENIED_ERROR` in logs
- `Failed to initialize database`

**Fix:**
```bash
# Test database connection
mysql -h YOUR_DB_HOST -u YOUR_DB_USER -p

# If fails, check:
# - Database server is running
# - Credentials are correct
# - Firewall allows connection
# - Database host is accessible
```

---

### 4. Server Not Listening on Correct Port

**Symptoms:**
- Process running but 502 error persists
- Reverse proxy can't connect

**Fix:**
```bash
# Check what port server is listening on
netstat -tulpn | grep node

# Verify PORT in .env matches reverse proxy config
```

---

### 5. Process Manager Not Running

**Symptoms:**
- Server starts but stops immediately
- No process manager keeping it alive

**Fix:**
```bash
# Install PM2
npm install -g pm2

# Start server with PM2
cd /path/to/server
pm2 start src/index.js --name chatbot-api

# Save PM2 config
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

---

## 🛠️ **Quick Fix Script**

**Run this on your production server:**

```bash
#!/bin/bash
echo "=== Checking Server Status ==="

# Check if process is running
if pgrep -f "node.*index.js" > /dev/null; then
    echo "✅ Node.js process is running"
else
    echo "❌ Node.js process is NOT running"
fi

# Check port
if netstat -tuln | grep -q ":5000"; then
    echo "✅ Port 5000 is listening"
else
    echo "❌ Port 5000 is NOT listening"
fi

# Check .env file
if [ -f ".env" ]; then
    echo "✅ .env file exists"
    # Check critical vars
    source .env
    if [ -z "$JWT_SECRET" ]; then
        echo "❌ JWT_SECRET is missing"
    fi
    if [ -z "$OPENAI_API_KEY" ]; then
        echo "❌ OPENAI_API_KEY is missing"
    fi
else
    echo "❌ .env file NOT found"
fi

# Test database connection
if command -v mysql &> /dev/null; then
    echo "Testing database connection..."
    # Add your test command here
fi

# Test server health
echo "Testing server health endpoint..."
curl -s http://localhost:5000/api/health || echo "❌ Server not responding"
```

---

## 📋 **Production Deployment Checklist**

Before deploying, ensure:

- [ ] All environment variables are set in production `.env`
- [ ] `NODE_ENV=production` is set
- [ ] Database is accessible from production server
- [ ] Server starts successfully (`node src/index.js`)
- [ ] Health endpoint works (`/api/health`)
- [ ] Process manager (PM2) is configured
- [ ] Reverse proxy is configured correctly
- [ ] Logs are being captured
- [ ] Server restarts automatically on crash

---

## 🔧 **Recommended Production Setup**

### 1. Use PM2 Process Manager

```bash
npm install -g pm2

# Start server
pm2 start src/index.js --name chatbot-api --env production

# Monitor
pm2 monit

# Auto-restart on crash
pm2 startup
pm2 save
```

### 2. Add Health Check Endpoint

The server already has `/api/health`, but enhance it:

```javascript
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT 1');
    res.json({ 
      ok: true, 
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (err) {
    res.status(503).json({ 
      ok: false, 
      error: 'Database unavailable',
      timestamp: new Date().toISOString()
    });
  }
});
```

### 3. Setup Logging

```bash
# PM2 logs
pm2 logs chatbot-api

# Or redirect to file
pm2 start src/index.js --name chatbot-api --log /var/log/chatbot-api.log
```

---

## 🆘 **Still Not Working?**

1. **Check server logs** - Most errors are logged there
2. **Test server directly** - `curl http://localhost:5000/api/health`
3. **Verify environment** - All required vars are set
4. **Check database** - Connection is working
5. **Review reverse proxy** - Configuration is correct

**Share the error logs** and I can help debug further!

