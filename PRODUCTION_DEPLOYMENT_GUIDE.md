# Production Deployment Guide

## 🚀 Quick Deployment Steps

### Prerequisites
- Node.js 18+ installed
- MySQL database accessible
- Server access (SSH)

---

## Step 1: Prepare Your Server

```bash
# SSH into your production server
ssh user@your-server

# Navigate to project directory
cd /path/to/Chatbot/server
```

---

## Step 2: Update Environment Variables

```bash
# Edit .env file
nano .env
```

**Update these values:**
```env
NODE_ENV=production
PORT=5000
CLIENT_ORIGIN=https://chat.filemyrti.com

# OpenAI Configuration
OPENAI_API_KEY=sk-proj-...your-complete-key...

# JWT Secret (must be 32+ characters)
JWT_SECRET=your-production-secret-min-32-chars-long

# Database Configuration
DB_HOST=your-db-host
DB_PORT=3306
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
```

**Save and exit (Ctrl+X, then Y, then Enter)**

---

## Step 3: Install Dependencies

```bash
# Install npm packages
npm install

# Install PM2 globally (if not already installed)
npm install -g pm2
```

---

## Step 4: Run Diagnostic Check

```bash
# Verify everything is configured correctly
npm run check
```

**Expected output:** All checks should pass ✅

---

## Step 5: Start with PM2

```bash
# Start server with PM2
npm run pm2:start

# Or manually:
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Enable PM2 to start on server reboot
pm2 startup
# Follow the instructions it prints
```

---

## Step 6: Verify Server is Running

```bash
# Check PM2 status
npm run pm2:status
# Or: pm2 status

# Should show chatbot-api as "online"

# Check logs
npm run pm2:logs
# Or: pm2 logs chatbot-api

# Test health endpoint
curl http://localhost:5000/api/health
# Should return: {"ok":true,"uptime":...,"database":"connected"}
```

---

## Step 7: Configure Reverse Proxy (Nginx Example)

```nginx
# /etc/nginx/sites-available/chatbot
server {
    listen 80;
    server_name chat.filemyrti.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.filemyrti.com;

    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/chat.filemyrti.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.filemyrti.com/privkey.pem;

    # API proxy
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

    # Frontend (if serving from same server)
    location / {
        root /var/www/chatbot/client/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

**Enable and reload:**
```bash
sudo ln -s /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 8: Test Production Deployment

1. **Test health endpoint:**
   ```bash
   curl https://chat.filemyrti.com/api/health
   ```

2. **Test from browser:**
   - Visit your production URL
   - Try logging in
   - Send a chat message

3. **Check logs:**
   ```bash
   pm2 logs chatbot-api --lines 50
   ```

---

## 📋 Useful PM2 Commands

```bash
# View status
pm2 status
npm run pm2:status

# View logs
pm2 logs chatbot-api
npm run pm2:logs

# Restart server
pm2 restart chatbot-api
npm run pm2:restart

# Stop server
pm2 stop chatbot-api
npm run pm2:stop

# Monitor resources
pm2 monit

# View detailed info
pm2 describe chatbot-api

# Delete from PM2
pm2 delete chatbot-api
```

---

## 🔧 Troubleshooting

### Server not starting?
```bash
# Check logs
pm2 logs chatbot-api --lines 100

# Check environment
npm run check

# Try starting manually
NODE_ENV=production node src/index.js
```

### Database connection failed?
```bash
# Test database connection
mysql -h YOUR_DB_HOST -u YOUR_DB_USER -p

# Check .env file
cat .env | grep DB_
```

### 502 Bad Gateway?
```bash
# Check if server is running
pm2 status

# Check if port is listening
netstat -tulpn | grep :5000

# Test server directly
curl http://localhost:5000/api/health
```

---

## ✅ Deployment Checklist

- [ ] Environment variables updated for production
- [ ] `NODE_ENV=production` set
- [ ] `CLIENT_ORIGIN` set to production domain
- [ ] All required environment variables set
- [ ] Database accessible from server
- [ ] Dependencies installed (`npm install`)
- [ ] Diagnostic check passes (`npm run check`)
- [ ] PM2 installed and configured
- [ ] Server started with PM2
- [ ] PM2 auto-start configured (`pm2 startup`)
- [ ] Health endpoint working
- [ ] Reverse proxy configured
- [ ] SSL/HTTPS enabled
- [ ] Tested from browser
- [ ] Logs being captured

---

## 🎉 Success!

Your server should now be running in production! 

**Monitor it:**
- Check logs: `pm2 logs chatbot-api`
- Monitor resources: `pm2 monit`
- Check status: `pm2 status`

**For updates:**
```bash
# Pull latest code
git pull

# Install new dependencies (if any)
npm install

# Restart server
pm2 restart chatbot-api
```

