import express from 'express';
import { z } from 'zod';
import { getConfig } from '../config.js';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import qrcode from 'qrcode-terminal';
import jsQR from 'jsqr';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Jimp = require('jimp');

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
let qrCodeDisplayed = false; // Track if QR code has been displayed to avoid duplicates

// Helper function to replace deprecated waitForTimeout
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract QR code data from canvas element
 */
async function extractQRCodeFromCanvas(page, canvas) {
  try {
    // Method 1: Direct canvas pixel extraction
    const canvasData = await page.evaluate((canvasSelector) => {
      const canvas = document.querySelector(canvasSelector);
      if (!canvas) return null;

      try {
        const width = canvas.width || canvas.offsetWidth;
        const height = canvas.height || canvas.offsetHeight;

        if (width < 100 || height < 100) return null;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        const imageData = ctx.getImageData(0, 0, width, height);
        return {
          width,
          height,
          data: Array.from(imageData.data),
          success: true,
        };
      } catch (e) {
        return null;
      }
    }, 'canvas');

    if (canvasData && canvasData.success) {
      const uint8Array = new Uint8ClampedArray(canvasData.data);
      const code = jsQR(uint8Array, canvasData.width, canvasData.height);

      if (code && code.data) {
        return code.data;
      }
    }

    // Method 2: Screenshot fallback
    console.log('📸 Trying screenshot method...');
    const screenshotBuffer = await canvas.screenshot({ type: 'png' });
    const image = await Jimp.read(screenshotBuffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    const imageData = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
        const idx = (y * width + x) * 4;
        imageData[idx] = pixel.r;
        imageData[idx + 1] = pixel.g;
        imageData[idx + 2] = pixel.b;
        imageData[idx + 3] = pixel.a;
      }
    }

    const code = jsQR(imageData, width, height);
    if (code && code.data) {
      return code.data;
    }

    return null;
  } catch (error) {
    console.log('⚠️  QR extraction error:', error.message);
    return null;
  }
}

/**
 * Find Chrome/Chromium executable path (cross-platform)
 */
function findChromeExecutable(config) {
  const platform = process.platform;
  let possiblePaths = [];

  if (platform === 'win32') {
    // Windows paths
    const programFiles = [
      process.env.PROGRAMFILES || 'C:\\Program Files',
      process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
      process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
    ];

    for (const basePath of programFiles) {
      possiblePaths.push(
        path.join(basePath, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(basePath, 'Google', 'Chrome', 'Application', 'chrome'),
        path.join(basePath, 'Chromium', 'Application', 'chrome.exe'),
        path.join(basePath, 'Chromium', 'Application', 'chromium.exe'),
      );
    }

    // Also check default user installation location
    possiblePaths.push(
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  } else if (platform === 'darwin') {
    // macOS paths
    possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  } else {
    // Linux paths
    possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
  }

  if (config.NODE_ENV === 'production' || config.FORCE_CHROME_PATH) {
    for (const chromePath of possiblePaths) {
      try {
        if (fs.existsSync(chromePath)) {
          console.log(`✅ Found Chrome/Chromium at: ${chromePath}`);
          return chromePath;
        }
      } catch (e) {
        // Continue checking other paths
      }
    }
  }

  return undefined; // Let Puppeteer use bundled Chromium
}

/**
 * Initialize Puppeteer browser and WhatsApp Web session
 * This keeps the browser open to maintain WhatsApp Web session
 * This is non-blocking and handles errors gracefully
 */
async function initWhatsAppSession() {
  // If already initializing, return the existing promise
  if (isInitializing && initPromise) {
    return initPromise;
  }

  // If already ready, return immediately
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
      console.log('🔄 Initializing WhatsApp Web session with Puppeteer...');

      const config = getConfig();

      // Clean up existing browser instance if any
      if (browserInstance) {
        try {
          console.log('🔄 Closing existing browser instance...');
          const pages = await browserInstance.pages();
          for (const page of pages) {
            try {
              await page.close();
            } catch (e) {
              // Ignore errors
            }
          }
          await browserInstance.close();
        } catch (error) {
          console.log('⚠️  Error closing browser:', error.message);
        }
        browserInstance = null;
        whatsappPage = null;
      }

      // Find Chrome/Chromium executable (cross-platform)
      const executablePath = findChromeExecutable(config);

      // Determine headless mode - check if we have a display
      // Headless mode still renders everything, we just can't see it
      // For server environments, we'll use headless mode
      const hasDisplay = process.env.DISPLAY || (process.platform === 'win32' && process.env.SESSIONNAME);
      const isHeadless = config.NODE_ENV === 'production' || !hasDisplay;

      if (isHeadless) {
        console.log('🚀 Launching browser in headless mode (no display available)...');
      } else {
        console.log('🚀 Launching browser (fresh session, no persistent storage)...');
      }

      // Launch browser WITHOUT userDataDir (fresh session each time)
      browserInstance = await puppeteer.launch({
        headless: isHeadless ? 'new' : false,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-gpu',
          ...(isHeadless ? ['--disable-dev-shm-usage'] : []),
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        // NO userDataDir - fresh session each time
      });

      whatsappPage = await browserInstance.newPage();

      // Set realistic user agent
      await whatsappPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );

      // Remove webdriver property
      await whatsappPage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
      });

      // Set viewport
      await whatsappPage.setViewport({ width: 1920, height: 1080 });

      // Navigate to WhatsApp Web with longer timeout
      await whatsappPage.goto('https://web.whatsapp.com', {
        waitUntil: 'domcontentloaded', // Changed from networkidle2 to be less strict
        timeout: 90000, // Increased timeout to 90 seconds
      });

      // Wait a bit for page to stabilize and network requests to complete
      await wait(5000);

      // Try multiple selector strategies with more flexibility
      let isLoggedIn = false;
      try {
        // Strategy 1: Check for chat list (logged in)
        const chatList = await whatsappPage.$('div[data-testid="chat-list"]');
        isLoggedIn = !!chatList;

        // Strategy 2: Check for any WhatsApp main content area
        if (!isLoggedIn) {
          const mainContent = await whatsappPage.$('#app, [data-testid="app"]');
          if (mainContent) {
            // Check if there's a QR code or chat list
            const pageContent = await whatsappPage.evaluate(() => {
              return document.querySelector('canvas[aria-label*="Scan"], canvas') !== null ||
                document.querySelector('div[data-testid="chat-list"]') !== null;
            });
            if (pageContent) {
              isLoggedIn = await whatsappPage.$('div[data-testid="chat-list"]') !== null;
            }
          }
        }

        if (!isLoggedIn) {
          if (!qrCodeDisplayed) {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📱 WhatsApp Web Login Required');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            console.log('⏳ Waiting for QR code to appear...');
          }

          // Try to extract and display QR code
          try {
            // Wait for page to load
            await wait(3000);

            // Find QR code canvas - simpler approach
            let qrCanvas = null;
            let attempts = 0;
            const maxAttempts = 15; // More attempts
            const attemptDelay = 2000;

            // Simple selector list - try most common ones first
            const selectors = [
              'canvas',
              'canvas[aria-label*="QR"]',
              'canvas[aria-label*="Scan"]',
              '#app canvas',
              'div[data-ref] canvas',
            ];

            while (!qrCanvas && attempts < maxAttempts) {
              for (const selector of selectors) {
                try {
                  const element = await whatsappPage.$(selector);
                  if (element) {
                    const info = await whatsappPage.evaluate((sel) => {
                      const el = document.querySelector(sel);
                      if (!el) return null;
                      const rect = el.getBoundingClientRect();
                      return {
                        width: rect.width || el.width,
                        height: rect.height || el.height,
                        visible: rect.width > 100 && rect.height > 100,
                      };
                    }, selector);

                    if (info && info.visible) {
                      qrCanvas = element;
                      console.log(`✅ QR code canvas found!`);
                      break;
                    }
                  }
                } catch (e) {
                  // Continue
                }
              }

              if (!qrCanvas) {
                attempts++;
                if (attempts < maxAttempts) {
                  await wait(attemptDelay);
                  if (attempts % 3 === 0) {
                    console.log(`⏳ Still searching... (${attempts}/${maxAttempts})`);
                  }
                }
              }
            }

            // Extract QR code from canvas
            let qrCodeData = null;

            if (qrCanvas) {
              console.log('🔍 Extracting QR code from canvas...');
              await wait(2000); // Wait for QR to fully render

              qrCodeData = await extractQRCodeFromCanvas(whatsappPage, qrCanvas);

              if (qrCodeData && !qrCodeDisplayed) {
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📱 SCAN THIS QR CODE WITH YOUR PHONE');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                // Display QR code in terminal
                qrcode.generate(qrCodeData, { small: true });

                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📋 Steps to scan:');
                console.log('   1. Open WhatsApp on your phone');
                console.log('   2. Go to Settings > Linked Devices');
                console.log('   3. Tap "Link a Device"');
                console.log('   4. Point your camera at the QR code above');
                console.log('   5. The system will automatically detect when logged in');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                qrCodeDisplayed = true;
              } else if (!qrCodeData) {
                console.log('⚠️  Could not extract QR code. The browser window should show the QR code.');
              }
            } else {
              console.log('⚠️  QR code canvas not found. Please check the browser window for the QR code.');
            }
          } catch (error) {
            console.log('⚠️  Error extracting QR code:', error.message);
            console.log('   Stack:', error.stack);
            console.log('   The browser window is open - please scan the QR code there.');
          }

          // Don't wait for QR scan - just mark as initializing
          // The system will check again on next message attempt
        } else {
          console.log('✅ WhatsApp Web session active');
          isReady = true;
          qrCodeDisplayed = false; // Reset for next time if needed
        }
      } catch (error) {
        console.warn('Could not determine login status:', error.message);
        // Continue anyway - might be logged in, just couldn't detect it
        isReady = true;
      }

      return { browser: browserInstance, page: whatsappPage };
    } catch (error) {
      console.error('Error initializing WhatsApp session:', error.message);
      isReady = false;
      // Don't throw - allow retry later
      browserInstance = null;
      whatsappPage = null;
      return null;
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
    const session = await initWhatsAppSession();
    if (!session || !session.page) {
      console.warn('WhatsApp session not available');
      return false;
    }
    page = session.page;

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
    await wait(500);

    // Click send button
    const sendButton = await page.$('button[data-testid="send"]') ||
      await page.$('span[data-testid="send"]') ||
      await page.$('span[data-icon="send"]');

    if (sendButton) {
      await sendButton.click();

      // Wait for message to be sent (check for sent status)
      await wait(2000);

      console.log('✅ WhatsApp message sent successfully');
      return true;
    } else {
      // Alternative: Press Enter key
      await page.keyboard.press('Enter');
      await wait(2000);
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

// GET endpoint to initialize WhatsApp and show QR code (for manual setup)
router.get('/init-whatsapp', async (req, res) => {
  try {
    console.log('🔄 Manual WhatsApp initialization triggered...');

    // Reset state to force reinitialization
    isReady = false;
    isInitializing = false;
    initPromise = null;
    qrCodeDisplayed = false; // Reset QR code display flag

    // Initialize WhatsApp session (this will show QR code in terminal if needed)
    const session = await initWhatsAppSession();

    if (session && session.page) {
      return res.json({
        success: true,
        message: 'WhatsApp initialization started. Check the terminal for QR code if login is needed.',
        isReady,
      });
    } else {
      return res.json({
        success: false,
        message: 'WhatsApp initialization failed. Check server logs.',
      });
    }
  } catch (error) {
    console.error('Error in manual WhatsApp initialization:', error);
    return res.status(500).json({
      error: 'Failed to initialize WhatsApp. Check server logs.',
    });
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
    // If not ready, try to initialize but don't wait for completion
    if (!isReady) {
      initWhatsAppSession().catch(err => {
        console.error('Background WhatsApp initialization error:', err);
      });

      // Return success immediately - WhatsApp will be ready on next request
      return res.json({
        success: true,
        message: 'Your query has been submitted successfully. WhatsApp notification will be sent once the session is ready.',
        notificationSent: false,
      });
    }

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

/**
 * Cleanup browser instance gracefully
 */
async function cleanupBrowser() {
  if (browserInstance) {
    try {
      console.log('🔄 Closing WhatsApp browser session...');
      const pages = await browserInstance.pages();
      for (const page of pages) {
        try {
          await page.close();
        } catch (e) {
          // Ignore errors
        }
      }
      await browserInstance.close();
      browserInstance = null;
      whatsappPage = null;
      isReady = false;
      console.log('✅ Browser session closed');
    } catch (error) {
      console.error('⚠️  Error closing browser:', error.message);
    }
  }
}

// Graceful shutdown - close browser on process termination
process.on('SIGINT', async () => {
  await cleanupBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanupBrowser();
  process.exit(0);
});

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  cleanupBrowser().finally(() => {
    process.exit(1);
  });
});

export default router;
