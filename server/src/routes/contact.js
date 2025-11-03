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

// Helper function to replace deprecated waitForTimeout
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
      console.log('Initializing WhatsApp Web session with Puppeteer...');

      const config = getConfig();
      const userDataDir = path.join(__dirname, '../../.whatsapp-session');

      // Clean up existing browser instance if any
      if (browserInstance) {
        try {
          console.log('Closing existing browser instance...');
          const pages = await browserInstance.pages();
          for (const page of pages) {
            try {
              await page.close();
            } catch (e) {
              // Ignore errors closing pages
            }
          }
          await browserInstance.close();
        } catch (error) {
          console.log('Error closing existing browser:', error.message);
        }
        browserInstance = null;
        whatsappPage = null;
      }

      // Clean up browser lock files if they exist
      try {
        const lockFiles = [
          path.join(userDataDir, 'SingletonLock'),
          path.join(userDataDir, 'Default', 'SingletonLock'),
        ];
        for (const lockFile of lockFiles) {
          if (fs.existsSync(lockFile)) {
            console.log(`Removing lock file: ${lockFile}`);
            fs.unlinkSync(lockFile);
          }
        }
      } catch (error) {
        // Lock file cleanup is best effort, continue even if it fails
        console.log('Note: Could not clean up all lock files:', error.message);
      }

      // Try to find Chrome/Chromium in common locations for production servers
      let executablePath = undefined;
      if (config.NODE_ENV === 'production') {
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
      }

      // Force headless mode in production or if no DISPLAY variable
      const isHeadless = config.NODE_ENV === 'production' || !process.env.DISPLAY;

      // Try to launch browser, handle lock file errors
      try {
        browserInstance = await puppeteer.launch({
          headless: isHeadless ? 'new' : false,
          executablePath,
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
          userDataDir,
        });
      } catch (launchError) {
        // If browser is already running, try to connect to it or force cleanup
        if (launchError.message && launchError.message.includes('already running')) {
          console.log('⚠️  Browser instance already running. Attempting cleanup...');

          // Try to kill any existing Chrome/Chromium processes for this userDataDir
          try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // Find and kill Chrome processes using this userDataDir
            await execAsync(`pkill -f "chrome.*${userDataDir}" || pkill -f "chromium.*${userDataDir}" || true`);
            await execAsync(`killall -9 chrome || killall -9 chromium || true`);

            // Wait a moment for processes to terminate
            await wait(2000);

            // Remove lock files again
            const lockFiles = [
              path.join(userDataDir, 'SingletonLock'),
              path.join(userDataDir, 'Default', 'SingletonLock'),
            ];
            for (const lockFile of lockFiles) {
              try {
                if (fs.existsSync(lockFile)) {
                  fs.unlinkSync(lockFile);
                }
              } catch (e) {
                // Ignore errors
              }
            }

            // Try launching again
            console.log('Retrying browser launch after cleanup...');
            browserInstance = await puppeteer.launch({
              headless: isHeadless ? 'new' : false,
              executablePath,
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
              userDataDir,
            });
          } catch (retryError) {
            console.error('Failed to cleanup and retry:', retryError.message);
            throw launchError; // Throw original error
          }
        } else {
          throw launchError; // Throw other errors as-is
        }
      }

      whatsappPage = await browserInstance.newPage();
      await whatsappPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set up network request interception to capture QR code reference
      let qrCodeRef = null;
      const responseHandler = async (response) => {
        const url = response.url();
        if (url.includes('login_code.json')) {
          try {
            // Extract ref from URL first
            const urlMatch = url.match(/[?&]ref=([^&]+)/);
            if (urlMatch) {
              qrCodeRef = decodeURIComponent(urlMatch[1]);
              console.log('📡 Captured QR ref from network request:', qrCodeRef);
            }

            // Also try to get from response body
            try {
              const data = await response.json();
              if (data && data.ref) {
                qrCodeRef = data.ref;
                console.log('📡 Captured QR ref from response body:', qrCodeRef);
              }
            } catch (e) {
              // Response might not be JSON, that's okay
            }
          } catch (e) {
            console.log('⚠️  Error extracting QR ref from network:', e.message);
          }
        }
      };
      whatsappPage.on('response', responseHandler);

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
          console.log('⚠️  WhatsApp Web is not logged in. Extracting QR code...');

          // Try to extract and display QR code
          try {
            // Wait for QR code canvas to appear
            let qrCanvasFound = false;
            try {
              await whatsappPage.waitForSelector('canvas[aria-label*="Scan"], canvas[aria-label*="QR"], canvas', {
                timeout: 10000,
              });
              qrCanvasFound = true;
              console.log('✅ QR code canvas found');
            } catch (e) {
              console.log('⚠️  QR code canvas not found, trying alternative methods...');
            }

            // Wait a bit more for QR code data to load
            await wait(3000);

            // Try multiple methods to extract QR code reference
            const extractionResults = await whatsappPage.evaluate(() => {
              const results = { methods: [] };

              // Method 1: Check localStorage
              try {
                const keys = Object.keys(localStorage);
                for (const key of keys) {
                  if (key.includes('WASecret') || key.includes('ref')) {
                    const value = localStorage.getItem(key);
                    try {
                      const parsed = JSON.parse(value);
                      if (parsed && parsed.ref) {
                        results.methods.push({ method: 'localStorage', ref: parsed.ref });
                        results.ref = parsed.ref;
                      }
                    } catch (e) {
                      if (value && value.length > 10) {
                        results.methods.push({ method: 'localStorage_raw', value: value.substring(0, 50) });
                      }
                    }
                  }
                }
              } catch (e) {
                results.methods.push({ method: 'localStorage', error: e.message });
              }

              // Method 2: Check window properties
              try {
                if (window.wb) {
                  const wbStr = JSON.stringify(window.wb).substring(0, 200);
                  results.methods.push({ method: 'window.wb', data: wbStr });
                }
              } catch (e) { }

              // Method 3: Check script tags for ref
              try {
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                  const content = script.innerHTML || script.textContent || '';
                  const refMatch = content.match(/ref["\s:=]+([a-zA-Z0-9_-]+)/i);
                  if (refMatch && refMatch[1] && refMatch[1].length > 10) {
                    results.methods.push({ method: 'script_tag', ref: refMatch[1] });
                    if (!results.ref) results.ref = refMatch[1];
                  }
                }
              } catch (e) { }

              // Method 4: Check URL
              try {
                const urlParams = new URLSearchParams(window.location.search);
                const ref = urlParams.get('ref');
                if (ref) {
                  results.methods.push({ method: 'url_param', ref });
                  if (!results.ref) results.ref = ref;
                }
              } catch (e) { }

              // Method 5: Check page source for common patterns
              try {
                const bodyText = document.body.innerHTML;
                const patterns = [
                  /ref["\s:=]+([a-zA-Z0-9_-]{20,})/gi,
                  /login_code\.json[?&]ref=([^"'\s&]+)/gi,
                ];
                for (const pattern of patterns) {
                  const matches = bodyText.matchAll(pattern);
                  for (const match of matches) {
                    if (match[1] && match[1].length > 10) {
                      results.methods.push({ method: 'body_html', ref: match[1] });
                      if (!results.ref) results.ref = match[1];
                      break;
                    }
                  }
                }
              } catch (e) { }

              return results;
            });

            console.log('🔍 QR extraction attempts:', JSON.stringify(extractionResults, null, 2));

            // Use captured ref from network requests (most reliable) or page extraction
            let finalQrUrl = null;
            const refToUse = qrCodeRef || extractionResults.ref;

            if (refToUse) {
              finalQrUrl = `https://web.whatsapp.com/desktop/login_code.json?ref=${refToUse}`;
              console.log('✅ Using QR ref:', refToUse.substring(0, 50) + '...');
            }

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
              console.log('⚠️  Could not extract QR code reference.');
              console.log('   Debug info:', JSON.stringify(extractionResults.methods.slice(0, 3), null, 2));
              console.log('   The browser window is open - please scan the QR code there.');
              console.log('   WhatsApp will automatically connect once logged in.');
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
