#!/bin/bash
# Production Server Startup Script
# This script helps diagnose and start the server

set -e

echo "🚀 FileMyRTI Production Server Startup"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Please create .env file with required environment variables"
    exit 1
fi

echo -e "${GREEN}✅ .env file found${NC}"

# Check Node.js version
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"

# Check if PM2 is installed
if command -v pm2 &> /dev/null; then
    echo -e "${GREEN}✅ PM2 is installed${NC}"
    USE_PM2=true
else
    echo -e "${YELLOW}⚠️  PM2 not found. Install with: npm install -g pm2${NC}"
    USE_PM2=false
fi

# Run diagnostic check
echo ""
echo "Running diagnostic checks..."
node check-server.js

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Diagnostic checks failed. Please fix the errors above.${NC}"
    exit 1
fi

# Start server
echo ""
echo "Starting server..."

if [ "$USE_PM2" = true ]; then
    echo "Using PM2..."
    pm2 start src/index.js --name chatbot-api --env production
    pm2 save
    echo ""
    echo -e "${GREEN}✅ Server started with PM2${NC}"
    echo "View logs: pm2 logs chatbot-api"
    echo "Monitor: pm2 monit"
    echo "Status: pm2 status"
else
    echo "Starting directly (not recommended for production)..."
    NODE_ENV=production node src/index.js
fi

