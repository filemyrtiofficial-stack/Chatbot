import express from 'express';
import { z } from 'zod';
import { getConfig } from '../config.js';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import qrcode from 'qrcode-terminal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const contactFormSchema = z.object({
  phoneNumber: z.string().min(1, 'Phone number is required'),
  query: z.string().min(1, 'Query is required'),
});

let browserInstance = null;
let whatsappPage = null;
let isInitializing = false;
let isReady = false;
let initPromise = null;

// Initialize WhatsApp session in background when module loads (non-blocking)
setTimeout(async () => {
  if (!isReady && !isInitializing) {
    console.log('🔄 Auto-initializing WhatsApp session in background...');
    try {
      await initWhatsAppSession();
    } catch (error) {
      console.error('Background WhatsApp initialization error:', error);
    }
  }
}, 5000); // Wait 5 seconds after server starts

/**
 * Initialize Puppeteer browser and WhatsApp Web session
 * This keeps the browser open to maintain WhatsApp Web session
 * This is a long-running operation and should be called asynchronously
 */
async function initWhatsAppSession() {
  // If already initializing, wait for that to complete
  if (isInitializing && initPromise) {
    return initPromise;
  }

  if (browserInstance && whatsappPage && isReady) {
    try {
      // Check if page is still connected
      if (!whatsappPage.isClosed()) {
        return { browser: browserInstance, page: whatsappPage };
      }
    } catch (error) {
      console.log('WhatsApp page disconnected, reinitializing...');
      isReady = false;
    }
  }

  // Start initialization
  isInitializing = true;
  initPromise = (async () => {
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

      // Force headless mode in production or if no DISPLAY variable (server environment)
      const isHeadless = config.NODE_ENV === 'production' || !process.env.DISPLAY;

      browserInstance = await puppeteer.launch({
        headless: isHeadless ? 'new' : false, // Use 'new' headless mode or false for visible browser
        executablePath, // Use system Chrome if available
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          ...(isHeadless ? ['--disable-dev-shm-usage', '--disable-setuid-sandbox'] : []),
        ],
        userDataDir, // Persist session data
      });

      whatsappPage = await browserInstance.newPage();
      await whatsappPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set up network request interception to capture QR code data
      let qrCodeRef = null;
      whatsappPage.on('response', async (response) => {
        const url = response.url();
        if (url.includes('login_code.json') || url.includes('ref=')) {
          try {
            const data = await response.json();
            if (data && data.ref) {
              qrCodeRef = data.ref;
            }
          } catch (e) {
            // Try to extract ref from URL
            const urlMatch = url.match(/[?&]ref=([^&]+)/);
            if (urlMatch) {
              qrCodeRef = urlMatch[1];
            }
          }
        }
      });

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
          console.log('⚠️  WhatsApp Web is not logged in. Extracting QR code...');

          // Wait for QR code to appear
          await whatsappPage.waitForSelector('canvas[aria-label*="Scan"], canvas', {
            timeout: 10000,
          });

          // Find and capture QR code canvas
          const qrCanvas = await whatsappPage.$('canvas[aria-label*="Scan"], canvas');

          if (qrCanvas) {
            try {
              // Extract QR code data directly from WhatsApp Web page
              // WhatsApp stores the QR code reference in various places on the page
              const qrCodeData = await whatsappPage.evaluate(() => {
                // Method 1: Try to find QR code ref in localStorage or sessionStorage
                try {
                  const stored = localStorage.getItem('WASecretBundle') || sessionStorage.getItem('WASecretBundle');
                  if (stored) {
                    const data = JSON.parse(stored);
                    if (data && data.ref) {
                      return `https://web.whatsapp.com/desktop/login_code.json?ref=${data.ref}`;
                    }
                  }
                } catch (e) { }

                // Method 2: Try to find in window properties
                try {
                  if (window.WASecretBundle && window.WASecretBundle.ref) {
                    return `https://web.whatsapp.com/desktop/login_code.json?ref=${window.WASecretBundle.ref}`;
                  }
                } catch (e) { }

                // Method 3: Extract from page URL or query parameters
                try {
                  const urlParams = new URLSearchParams(window.location.search);
                  const ref = urlParams.get('ref');
                  if (ref) {
                    return `https://web.whatsapp.com/desktop/login_code.json?ref=${ref}`;
                  }
                } catch (e) { }

                // Method 4: Try to get QR code data from canvas context
                try {
                  const canvas = document.querySelector('canvas[aria-label*="Scan"], canvas');
                  if (canvas) {
                    // Get canvas as data URL (this will be used as fallback)
                    return canvas.toDataURL();
                  }
                } catch (e) { }

                return null;
              });

              // Capture QR code canvas as base64 image for fallback
              const qrCodeImage = await qrCanvas.screenshot({ encoding: 'base64' });
              const qrCodePath = path.join(__dirname, '../../qr-code.png');
              fs.writeFileSync(qrCodePath, qrCodeImage, 'base64');

              // Use captured ref from network requests if available
              let finalQrUrl = null;
              if (qrCodeRef) {
                finalQrUrl = `https://web.whatsapp.com/desktop/login_code.json?ref=${qrCodeRef}`;
              } else if (qrCodeData && qrCodeData.startsWith('https://')) {
                finalQrUrl = qrCodeData;
              }

              // If we got a URL, use it directly
              if (finalQrUrl) {
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📱 SCAN THIS QR CODE WITH YOUR PHONE');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                // Display QR code in terminal
                qrcode.generate(finalQrUrl, { small: true });

                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📋 Steps to scan:');
                console.log('   1. Open WhatsApp on your phone');
                console.log('   2. Go to Settings > Linked Devices');
                console.log('   3. Tap "Link a Device"');
                console.log('   4. Point your camera at the QR code above');
                console.log('   5. The system will automatically detect when logged in');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
              } else {
                // Fallback: Show saved image location
                console.log('\n⚠️  Could not extract QR code URL from WhatsApp Web.');
                console.log('   QR code image saved to:', qrCodePath);
                console.log('   You can view it at: https://chat.filemyrti.com/api/contact/qr-code');
                console.log('   Or download and scan the image file manually.\n');
              }
            } catch (error) {
              console.error('Error extracting QR code:', error);
              const qrCodePath = path.join(__dirname, '../../qr-code.png');
              console.log('   QR code image saved to:', qrCodePath);
              console.log('   Please try scanning the saved image file manually.\n');
            }
          } else {
            console.log('⚠️  Could not find QR code canvas. Please check WhatsApp Web manually.');
          }

          // Check periodically if logged in (non-blocking)
          const checkLoginInterval = setInterval(async () => {
            try {
              const loggedIn = await whatsappPage.$('div[data-testid="chat-list"]');
              if (loggedIn) {
                clearInterval(checkLoginInterval);
                isReady = true;
                console.log('✅ WhatsApp Web logged in successfully!');
              }
            } catch (e) {
              // Ignore errors during check
            }
          }, 5000); // Check every 5 seconds

          // Timeout after 10 minutes
          setTimeout(() => {
            clearInterval(checkLoginInterval);
          }, 600000);

          // Return even if not logged in - will try again on next request
          return { browser: browserInstance, page: whatsappPage };
        } else {
          console.log('✅ WhatsApp Web session active');
          isReady = true;
        }

        return { browser: browserInstance, page: whatsappPage };
      } catch (error) {
        console.error('Error waiting for WhatsApp Web to load:', error);
        isReady = false;
        throw error;
      }
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
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

// GET QR code endpoint - serves the QR code image for scanning
router.get('/qr-code', (req, res) => {
  const qrCodePath = path.join(__dirname, '../../qr-code.png');

  if (fs.existsSync(qrCodePath)) {
    res.sendFile(qrCodePath);
  } else {
    res.status(404).json({ error: 'QR code not found. Please submit a contact form first to generate it.' });
  }
});

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

    // Initialize WhatsApp session in background (non-blocking)
    // If not ready, try to initialize but don't wait for QR scan
    if (!isReady) {
      // Start initialization but don't wait - it will complete in background
      initWhatsAppSession().catch(err => {
        console.error('Background WhatsApp initialization error:', err);
      });

      // If QR code exists, return with info
      const qrCodePath = path.join(__dirname, '../../qr-code.png');
      if (fs.existsSync(qrCodePath)) {
        return res.json({
          success: true,
          message: 'Your query has been submitted successfully. WhatsApp notification will be sent once QR code is scanned.',
          notificationSent: false,
          qrCodeAvailable: true,
          qrCodeUrl: '/api/contact/qr-code',
        });
      }

      // Return success immediately - WhatsApp will be initialized in background
      return res.json({
        success: true,
        message: 'Your query has been submitted successfully. WhatsApp is being set up in the background.',
        notificationSent: false,
      });
    }

    // If WhatsApp is ready, send notification
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
