# Quick Fix for 502 Bad Gateway in Production

## 🚨 Immediate Actions

### 1. SSH into Your Production Server

```bash
ssh user@your-production-server
cd /path/to/your/server
```

### 2. Check if Server is Running

```bash
# Check process
ps aux | grep node

# Check port
netstat -tulpn | grep :5000

# If using PM2
pm2 list
pm2 logs --lines 50
```

### 3. Check Server Logs

**Most likely issue:** Server crashed on startup. Check logs:

```bash
# If using PM2
pm2 logs chatbot-api --lines 100

# If using systemd
journalctl -u chatbot-api -n 100

# If running directly, check where stdout/stderr goes
```

**Look for:**
- `Environment variable validation failed` → Missing env vars
- `Failed to initialize database` → Database connection issue
- `ECONNREFUSED` → Database server not accessible

### 4. Test Server Manually

```bash
# Try starting server manually to see errors
cd /path/to/server
node src/index.js
```

**This will show you the exact error!**

---

## 🔧 Common Fixes

### Fix 1: Server Not Running

```bash
# Start with PM2
pm2 start src/index.js --name chatbot-api --env production
pm2 save

# Or start directly (not recommended for production)
NODE_ENV=production node src/index.js
```

### Fix 2: Missing Environment Variables

```bash
# Check .env file exists
ls -la .env

# Verify critical variables
cat .env | grep -E "JWT_SECRET|OPENAI_API_KEY|DB_HOST|NODE_ENV"

# If missing, create/update .env
nano .env
```

**Required variables:**
```env
NODE_ENV=production
PORT=5000
JWT_SECRET=your-secret-at-least-32-chars-long
OPENAI_API_KEY=sk-...
DB_HOST=your-db-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
CLIENT_ORIGIN=https://yourdomain.com
```

### Fix 3: Database Connection Failed

```bash
# Test database connection
mysql -h YOUR_DB_HOST -u YOUR_DB_USER -p YOUR_DB_NAME

# If fails:
# 1. Check database server is running
# 2. Verify credentials in .env
# 3. Check firewall allows connection
# 4. Verify database host is accessible
```

### Fix 4: Wrong Port Configuration

```bash
# Check what port server should use
cat .env | grep PORT

# Check if reverse proxy expects different port
# Check nginx/apache config
```

---

## ✅ Verify It's Working

### 1. Test Health Endpoint

```bash
# On production server
curl http://localhost:5000/api/health

# Should return:
# {"ok":true,"uptime":123.45,"timestamp":"...","database":"connected"}
```

### 2. Test from Browser

```bash
# Visit (replace with your domain)
https://chat.filemyrti.com/api/health
```

### 3. Check PM2 Status

```bash
pm2 status
pm2 monit
```

---

## 📋 Production Checklist

Before deploying, ensure:

- [ ] `.env` file exists with all required variables
- [ ] `NODE_ENV=production` is set
- [ ] Database is accessible from production server
- [ ] Server starts without errors (`node src/index.js`)
- [ ] Health endpoint works (`curl http://localhost:5000/api/health`)
- [ ] PM2 is installed and configured
- [ ] Reverse proxy (nginx) is configured correctly
- [ ] Server restarts automatically on crash

---

## 🆘 Still Getting 502?

1. **Check server logs** - The error is there!
2. **Test server directly** - `curl http://localhost:5000/api/health`
3. **Verify environment** - All vars are set correctly
4. **Check database** - Connection works
5. **Review reverse proxy** - Config matches server port

**Share the error from logs** and I can help debug!


