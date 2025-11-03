import express from 'express';
import { z } from 'zod';
import { getConfig } from '../config.js';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const contactFormSchema = z.object({
  phoneNumber: z.string().min(1, 'Phone number is required'),
  query: z.string().min(1, 'Query is required'),
});

let browserInstance = null;
let whatsappPage = null;

/**
 * Initialize Puppeteer browser and WhatsApp Web session
 * This keeps the browser open to maintain WhatsApp Web session
 */
async function initWhatsAppSession() {
  if (browserInstance && whatsappPage) {
    try {
      // Check if page is still connected
      if (!whatsappPage.isClosed()) {
        return { browser: browserInstance, page: whatsappPage };
      }
    } catch (error) {
      console.log('WhatsApp page disconnected, reinitializing...');
    }
  }

  try {
    console.log('Initializing WhatsApp Web session with Puppeteer...');

    const config = getConfig();
    const userDataDir = path.join(__dirname, '../../.whatsapp-session');

    // Try to find Chrome/Chromium in common locations for production servers
    let executablePath = undefined;
    if (config.NODE_ENV === 'production') {
      // Common paths for Chrome/Chromium on Linux servers
      const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ];

      for (const chromePath of possiblePaths) {
        try {
          if (fs.existsSync(chromePath)) {
            executablePath = chromePath;
            console.log(`Found Chrome/Chromium at: ${chromePath}`);
            break;
          }
        } catch (e) {
          // Continue checking other paths
        }
      }

      if (!executablePath) {
        console.warn('Chrome/Chromium not found in standard paths. Please install Chrome/Chromium or run: npx puppeteer browsers install chrome');
      }
    }

    browserInstance = await puppeteer.launch({
      headless: config.NODE_ENV === 'production', // Show browser in development
      executablePath, // Use system Chrome if available
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
      ],
      userDataDir, // Persist session data
    });

    whatsappPage = await browserInstance.newPage();
    await whatsappPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Navigate to WhatsApp Web
    await whatsappPage.goto('https://web.whatsapp.com', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Wait for WhatsApp Web to load and check if logged in
    try {
      // Wait for either QR code or chat list (logged in)
      await whatsappPage.waitForSelector('canvas[aria-label*="Scan"], div[data-testid="chat-list"]', {
        timeout: 30000,
      });

      const isLoggedIn = await whatsappPage.$('div[data-testid="chat-list"]');

      if (!isLoggedIn) {
        console.log('⚠️  WhatsApp Web is not logged in. Please scan the QR code:');
        console.log('   1. Open WhatsApp on your phone');
        console.log('   2. Go to Settings > Linked Devices');
        console.log('   3. Scan the QR code shown in the browser');
        console.log('   4. The browser will automatically detect when you\'re logged in');

        // Wait for user to scan QR code (wait for chat list to appear)
        await whatsappPage.waitForSelector('div[data-testid="chat-list"]', {
          timeout: 300000, // 5 minutes to scan QR code
        });

        console.log('✅ WhatsApp Web logged in successfully!');
      } else {
        console.log('✅ WhatsApp Web session active');
      }
    } catch (error) {
      console.error('Error waiting for WhatsApp Web to load:', error);
      throw error;
    }

    return { browser: browserInstance, page: whatsappPage };
  } catch (error) {
    console.error('Error initializing WhatsApp session:', error);
    browserInstance = null;
    whatsappPage = null;
    throw error;
  }
}

/**
 * Send WhatsApp message using Puppeteer
 */
async function sendWhatsAppMessage(adminPhone, message) {
  let page;

  try {
    // Initialize or reuse WhatsApp session
    const { page: whatsappPage } = await initWhatsAppSession();
    page = whatsappPage;

    // Format phone number (remove spaces, +, etc., keep only digits)
    const formattedPhone = adminPhone.replace(/[^\d]/g, '');

    // Construct WhatsApp Web URL with phone number and message
    const whatsappUrl = `https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;

    // Navigate to the chat
    await page.goto(whatsappUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for the message input box to appear
    await page.waitForSelector('div[data-testid="conversation-compose-box-input"]', {
      timeout: 10000,
    });

    // Check if message box is already filled (from URL)
    const messageInput = await page.$('div[data-testid="conversation-compose-box-input"]');
    const existingText = await page.evaluate((el) => el.textContent, messageInput);

    // If message is not in input, type it
    if (!existingText || existingText.trim() !== message.trim()) {
      // Click on the input area
      await page.click('div[data-testid="conversation-compose-box-input"]');

      // Clear any existing text
      await page.evaluate(() => {
        const input = document.querySelector('div[data-testid="conversation-compose-box-input"]');
        if (input) {
          input.innerHTML = '';
          input.textContent = '';
        }
      });

      // Type the message
      await page.type('div[data-testid="conversation-compose-box-input"]', message, {
        delay: 50, // Small delay between keystrokes
      });
    }

    // Wait a moment for message to be typed
    await page.waitForTimeout(500);

    // Click send button
    const sendButton = await page.$('button[data-testid="send"]') ||
      await page.$('span[data-testid="send"]') ||
      await page.$('span[data-icon="send"]');

    if (sendButton) {
      await sendButton.click();

      // Wait for message to be sent (check for sent status)
      await page.waitForTimeout(2000);

      console.log('✅ WhatsApp message sent successfully');
      return true;
    } else {
      // Alternative: Press Enter key
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      console.log('✅ WhatsApp message sent successfully (using Enter key)');
      return true;
    }
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);

    // If page is disconnected, reset instance
    if (page && page.isClosed()) {
      browserInstance = null;
      whatsappPage = null;
    }

    return false;
  }
}

// POST contact form submission
router.post('/', async (req, res) => {
  try {
    const parsed = contactFormSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid request payload',
      });
    }

    const { phoneNumber, query } = parsed.data;
    const config = getConfig();
    const adminPhone = config.ADMIN_WHATSAPP_NUMBER;

    if (!adminPhone) {
      console.warn('ADMIN_WHATSAPP_NUMBER not configured. Skipping WhatsApp notification.');
      return res.json({
        success: true,
        message: 'Your query has been submitted successfully',
        notificationSent: false,
      });
    }

    // Create notification message
    const message = `🔔 *New Contact Form Submission*\n\n📞 *Phone:* ${phoneNumber}\n\n💬 *Query:*\n${query}\n\n⏰ *Time:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

    // Send WhatsApp notification
    const notificationSent = await sendWhatsAppMessage(adminPhone, message);

    return res.json({
      success: true,
      message: 'Your query has been submitted successfully',
      notificationSent,
    });
  } catch (error) {
    console.error('Error processing contact form:', error);
    return res.status(500).json({
      error: 'Failed to submit your query. Please try again later.',
    });
  }
});

// Graceful shutdown - close browser on process termination
process.on('SIGINT', async () => {
  if (browserInstance) {
    console.log('Closing WhatsApp browser session...');
    await browserInstance.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browserInstance) {
    console.log('Closing WhatsApp browser session...');
    await browserInstance.close();
  }
  process.exit(0);
});

export default router;
