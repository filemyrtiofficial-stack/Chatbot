# Debug Steps for 502 Error

## 🚨 **Step-by-Step Debugging**

Since you're still getting 502 errors, let's debug systematically:

### **Step 1: Run Diagnostic Script**

I've created a diagnostic script. **On your production server**, run:

```bash
cd /path/to/your/server
npm run check
```

This will check:
- ✅ Environment variables
- ✅ Database connection
- ✅ OpenAI API key
- ✅ Server startup

**Share the output** - this will show exactly what's wrong!

---

### **Step 2: Check Server Logs**

**Most important:** Check what error the server is showing:

```bash
# If using PM2
pm2 logs chatbot-api --lines 100

# If not using PM2, check where logs go
# Try starting manually to see errors:
cd /path/to/server
NODE_ENV=production node src/index.js
```

**Look for:**
- `Environment variable validation failed` → Missing env vars
- `Failed to initialize database` → Database issue
- `ECONNREFUSED` → Can't connect to database
- `ER_ACCESS_DENIED_ERROR` → Wrong database credentials

---

### **Step 3: Verify Server is Running**

```bash
# Check if process is running
ps aux | grep node

# Check if port is listening
netstat -tulpn | grep :5000
# or
lsof -i :5000

# Test server directly (bypass reverse proxy)
curl http://localhost:5000/api/health
```

**Expected:** Should return `{"ok":true,...}`

**If this fails:** Server is not running or crashed.

---

### **Step 4: Check Environment Variables**

```bash
cd /path/to/server

# Check .env exists
ls -la .env

# Check critical variables
cat .env | grep -E "NODE_ENV|PORT|JWT_SECRET|OPENAI_API_KEY|DB_HOST"

# Verify JWT_SECRET length
node -e "require('dotenv').config(); console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length || 0)"
```

**Required:**
- `NODE_ENV=production`
- `PORT=5000` (or your port)
- `JWT_SECRET` (at least 32 characters)
- `OPENAI_API_KEY` (complete key)
- All database variables

---

### **Step 5: Test Database Connection**

```bash
# Test database connection manually
mysql -h YOUR_DB_HOST -u YOUR_DB_USER -p YOUR_DB_NAME

# If this fails, server will crash on startup!
```

---

## 🔧 **Common Fixes**

### **Fix 1: Server Crashed - Check Logs**

```bash
# Start server and capture output
cd /path/to/server
NODE_ENV=production node src/index.js 2>&1 | tee server.log
```

**Share the error from this output!**

### **Fix 2: Missing Environment Variables**

```bash
# Create/update .env
nano .env

# Ensure these are set:
NODE_ENV=production
PORT=5000
JWT_SECRET=your-secret-min-32-chars-long
OPENAI_API_KEY=sk-...complete-key...
DB_HOST=your-db-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
CLIENT_ORIGIN=https://chat.filemyrti.com
```

### **Fix 3: Database Connection Failed**

```bash
# Test connection
mysql -h YOUR_DB_HOST -u YOUR_DB_USER -p

# If fails:
# 1. Check database server is running
# 2. Verify credentials
# 3. Check firewall
# 4. Verify host is accessible
```

### **Fix 4: Start with PM2**

```bash
# Install PM2
npm install -g pm2

# Start server
cd /path/to/server
pm2 start src/index.js --name chatbot-api --env production

# Check status
pm2 status
pm2 logs chatbot-api
```

---

## 📋 **What to Share**

To help debug, please share:

1. **Output of diagnostic script:**
   ```bash
   npm run check
   ```

2. **Server logs:**
   ```bash
   pm2 logs chatbot-api --lines 50
   # OR
   NODE_ENV=production node src/index.js
   ```

3. **Health check result:**
   ```bash
   curl http://localhost:5000/api/health
   ```

4. **Process status:**
   ```bash
   ps aux | grep node
   netstat -tulpn | grep :5000
   ```

---

## 🆘 **Quick Test**

Run this on your production server:

```bash
cd /path/to/server

# 1. Check .env
echo "Checking .env..."
[ -f .env ] && echo "✅ .env exists" || echo "❌ .env missing"

# 2. Check Node.js
echo "Node version: $(node -v)"

# 3. Run diagnostic
npm run check

# 4. Try starting server
echo "Starting server..."
NODE_ENV=production node src/index.js
```

**Share the complete output** and I can pinpoint the exact issue!


