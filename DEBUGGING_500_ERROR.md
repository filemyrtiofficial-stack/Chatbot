# Debugging 500 Internal Server Error on `/api/chat`

## Why You're Getting This Error

A **500 Internal Server Error** means your server received the request but encountered an error while processing it. The error is caught by the catch block in the chat route handler.

## Common Causes & Solutions

### 1. **Database Connection Issues** ⚠️ MOST LIKELY

**Symptoms:**
- Error messages like `ECONNREFUSED`, `ER_ACCESS_DENIED_ERROR`, or `ER_NO_SUCH_TABLE`
- Server console shows database connection errors

**Check:**
```powershell
# Check if your database server is accessible
Test-NetConnection -ComputerName srv676.hstgr.io -Port 3306
```

**Solutions:**
- Verify database credentials in `server/.env` are correct
- Ensure database server is running and accessible
- Check if database tables exist (they should be auto-created on server start)

### 2. **OpenAI API Key Issues** ⚠️ VERY COMMON

**Symptoms:**
- Error messages mentioning OpenAI API
- Invalid API key errors
- API key might be truncated in `.env` file

**Check:**
```powershell
# Check your OpenAI API key in .env
Get-Content "server\.env" | Select-String "OPENAI_API_KEY"
```

**Solutions:**
- Ensure API key is on a single line (no line breaks)
- Verify the complete API key from your OpenAI account
- Make sure API key starts with `sk-` and is complete

### 3. **Database Tables Missing**

**Symptoms:**
- Error: `ER_NO_SUCH_TABLE` or table doesn't exist

**Solution:**
- Restart your server - tables are auto-created on startup
- Check server console for table creation messages

### 4. **Authentication Issues**

**Symptoms:**
- User not authenticated errors
- Token validation failures

**Solution:**
- Make sure you're logged in
- Check browser cookies for auth tokens
- Try logging out and logging back in

## How to Debug

### Step 1: Check Server Console Logs

**Look at your server terminal** where you ran `npm start`. You should see detailed error messages like:

```
[Chat Error] Error: ...
[Error Stack] ...
[Database Error] Connection failed
```

### Step 2: Check Browser Network Tab

1. Open browser DevTools (F12)
2. Go to **Network** tab
3. Click on the failed `/api/chat` request
4. Check the **Response** tab for error details

### Step 3: Verify Server is Running

```powershell
# Check if server is listening on port 5000
Test-NetConnection -ComputerName localhost -Port 5000
```

### Step 4: Test Database Connection

The server should show database initialization messages on startup:
```
✅ Database initialized
✅ Tables created
FileMyRTI server listening on http://localhost:5000
```

## Quick Fixes

### Fix 1: Restart Server
```powershell
cd server
npm start
```

### Fix 2: Check .env File
```powershell
# Verify all required variables are set
Get-Content "server\.env"
```

### Fix 3: Verify Database Connection
- Check your database hosting provider (srv676.hstgr.io)
- Ensure database is active and accessible
- Verify credentials are correct

### Fix 4: Test OpenAI API Key
- Go to https://platform.openai.com/api-keys
- Verify your API key is active
- Copy the complete key and update `.env`

## What I've Fixed

1. ✅ **Improved error logging** - Now shows detailed error messages in development
2. ✅ **Added database pool check** - Verifies database is initialized before use
3. ✅ **Added authentication check** - Verifies user is authenticated
4. ✅ **Better error responses** - Returns more helpful error messages

## Next Steps

1. **Restart your server** to load the improved error handling
2. **Check the server console** for the actual error message
3. **Share the error details** from the console so we can fix the specific issue

The improved error handling will now show you exactly what's failing!


