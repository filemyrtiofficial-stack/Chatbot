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
 * Clean up browser lock files (cross-platform)
 */
function cleanupLockFiles(userDataDir) {
  const lockFiles = [
    path.join(userDataDir, 'SingletonLock'),
    path.join(userDataDir, 'Default', 'SingletonLock'),
  ];

  for (const lockFile of lockFiles) {
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        console.log(`✅ Removed lock file: ${lockFile}`);
      }
    } catch (error) {
      // Lock file might be in use, that's okay
      console.log(`⚠️  Could not remove lock file ${lockFile}: ${error.message}`);
    }
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

      // Ensure userDataDir exists
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
        console.log(`✅ Created WhatsApp session directory: ${userDataDir}`);
      }

      // Clean up browser lock files if they exist
      cleanupLockFiles(userDataDir);

      // Find Chrome/Chromium executable (cross-platform)
      const executablePath = findChromeExecutable(config);

      // Determine headless mode
      // In production, always use headless unless explicitly disabled
      // On Windows, headless might cause issues, so be more lenient
      const isHeadless = config.NODE_ENV === 'production'
        ? (config.HEADLESS !== false) // Default to headless in production unless disabled
        : (!process.env.DISPLAY && process.platform !== 'win32'); // On non-Windows, check DISPLAY

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
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            ...(isHeadless ? ['--disable-dev-shm-usage', '--disable-setuid-sandbox'] : []),
          ],
          ignoreDefaultArgs: ['--enable-automation'],
          userDataDir,
        });
      } catch (launchError) {
        // If browser is already running, try to connect to it or force cleanup
        if (launchError.message && (
          launchError.message.includes('already running') ||
          launchError.message.includes('user data directory') ||
          launchError.message.includes('SingletonLock')
        )) {
          console.log('⚠️  Browser lock detected. Attempting cleanup...');

          // Clean up lock files
          cleanupLockFiles(userDataDir);

          // On Windows, try to kill Chrome processes
          if (process.platform === 'win32') {
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);

              // Kill Chrome processes on Windows (force kill)
              await execAsync('taskkill /F /IM chrome.exe /T 2>nul || taskkill /F /IM chromium.exe /T 2>nul || exit 0');

              // Wait for processes to terminate
              await wait(3000);
            } catch (e) {
              console.log('Note: Could not kill Chrome processes:', e.message);
            }
          } else {
            // Unix-like systems
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);

              await execAsync(`pkill -f "chrome.*${userDataDir}" || pkill -f "chromium.*${userDataDir}" || true`);
              await execAsync(`killall -9 chrome || killall -9 chromium || true 2>/dev/null`);

              await wait(2000);
            } catch (e) {
              console.log('Note: Could not kill Chrome processes:', e.message);
            }
          }

          // Clean lock files again after killing processes
          cleanupLockFiles(userDataDir);

          // Wait a bit more
          await wait(1000);

          // Try launching again
          console.log('🔄 Retrying browser launch after cleanup...');
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
                '--disable-blink-features=AutomationControlled',
                ...(isHeadless ? ['--disable-dev-shm-usage', '--disable-setuid-sandbox'] : []),
              ],
              userDataDir,
              ignoreDefaultArgs: ['--enable-automation'],
            });
          } catch (retryError) {
            console.error('❌ Failed to launch browser after cleanup:', retryError.message);
            throw launchError; // Throw original error
          }
        } else {
          console.error('❌ Browser launch error:', launchError.message);
          throw launchError;
        }
      }

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

      // Set up network request AND response interception to capture QR code reference
      let qrCodeRef = null;
      let qrCodeUrl = null;

      // Intercept requests (happens before navigation)
      await whatsappPage.setRequestInterception(true);
      whatsappPage.on('request', (request) => {
        const url = request.url();
        // Log and allow all requests, but capture QR-related URLs
        if (url.includes('login_code') || url.includes('ref=') || url.includes('qrcode')) {
          console.log('📡 Intercepted QR-related request:', url);
          const urlMatch = url.match(/[?&]ref=([^&]+)/);
          if (urlMatch) {
            const ref = decodeURIComponent(urlMatch[1]);
            qrCodeRef = ref;
            qrCodeUrl = `https://web.whatsapp.com/desktop/login_code.json?ref=${ref}`;
            console.log('📡 Captured QR ref from request URL:', ref.substring(0, 30) + '...');
          }
        }
        request.continue();
      });

      // Also intercept responses
      const responseHandler = async (response) => {
        const url = response.url();

        // Capture QR code references from various endpoints
        if (url.includes('login_code') || url.includes('ref=') || url.includes('qrcode')) {
          try {
            console.log('📡 Intercepted QR-related response:', url);
            // Extract ref from URL first
            const urlMatch = url.match(/[?&]ref=([^&]+)/);
            if (urlMatch) {
              const ref = decodeURIComponent(urlMatch[1]);
              qrCodeRef = ref;
              qrCodeUrl = `https://web.whatsapp.com/desktop/login_code.json?ref=${ref}`;
              console.log('📡 Captured QR ref from response URL:', ref.substring(0, 30) + '...');
            }

            // Also try to get from response body
            try {
              const data = await response.json();
              if (data) {
                if (data.ref) {
                  qrCodeRef = data.ref;
                  qrCodeUrl = `https://web.whatsapp.com/desktop/login_code.json?ref=${data.ref}`;
                  console.log('📡 Captured QR ref from response body:', data.ref.substring(0, 30) + '...');
                }
                // Also check for QR code URL directly
                if (data.code && typeof data.code === 'string' && data.code.length > 50) {
                  console.log('📡 Found QR code data in response');
                }
                if (data.qr && typeof data.qr === 'string') {
                  qrCodeUrl = data.qr;
                  console.log('📡 Found QR code URL in response');
                }
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
          if (!qrCodeDisplayed) {
            console.log('⚠️  WhatsApp Web is not logged in. Extracting QR code...');
          }

          // Try to extract and display QR code
          try {
            // Wait for QR code canvas to appear with multiple selector strategies
            let qrCanvas = null;
            let attempts = 0;
            const maxAttempts = 5;

            while (!qrCanvas && attempts < maxAttempts) {
              try {
                // Try different selectors for the QR code canvas
                const selectors = [
                  'canvas[aria-label*="Scan"]',
                  'canvas[aria-label*="QR"]',
                  'canvas',
                  'div[data-ref] canvas',
                  '#app canvas',
                ];

                for (const selector of selectors) {
                  try {
                    await whatsappPage.waitForSelector(selector, { timeout: 3000 });
                    qrCanvas = await whatsappPage.$(selector);
                    if (qrCanvas) {
                      console.log(`✅ QR code canvas found using selector: ${selector}`);
                      break;
                    }
                  } catch (e) {
                    // Try next selector
                  }
                }

                if (!qrCanvas) {
                  attempts++;
                  if (attempts < maxAttempts) {
                    console.log(`⏳ Waiting for QR code canvas (attempt ${attempts + 1}/${maxAttempts})...`);
                    await wait(2000);
                  }
                }
              } catch (e) {
                attempts++;
                if (attempts < maxAttempts) {
                  await wait(2000);
                }
              }
            }

            if (!qrCanvas) {
              console.log('⚠️  QR code canvas not found. Waiting for page to fully load...');
              await wait(5000);

              // Try one more time to find canvas
              try {
                qrCanvas = await whatsappPage.$('canvas');
              } catch (e) {
                console.log('⚠️  Still could not find canvas element.');
              }
            }

            // Wait a bit more for QR code to fully render
            if (qrCanvas) {
              console.log('⏳ Waiting for QR code to fully render...');
              await wait(3000);
            }

            // Extract QR code data directly from canvas
            let qrCodeData = null;

            if (qrCanvas) {
              try {
                // Method 1: Try to extract canvas data directly (fastest)
                const canvasData = await whatsappPage.evaluate(() => {
                  const canvases = Array.from(document.querySelectorAll('canvas'));

                  for (const canvas of canvases) {
                    try {
                      const width = canvas.width || canvas.offsetWidth || canvas.clientWidth;
                      const height = canvas.height || canvas.offsetHeight || canvas.clientHeight;

                      if (width < 100 || height < 100) continue;

                      // Try to get 2d context
                      const ctx = canvas.getContext('2d', { willReadFrequently: true });
                      if (!ctx) continue;

                      // Get image data
                      const imageData = ctx.getImageData(0, 0, width, height);

                      return {
                        width,
                        height,
                        data: Array.from(imageData.data),
                        success: true
                      };
                    } catch (e) {
                      // Canvas might be tainted or use WebGL, try next canvas
                      continue;
                    }
                  }
                  return { success: false };
                });

                if (canvasData && canvasData.success) {
                  // Convert array back to Uint8ClampedArray for jsQR
                  const uint8Array = new Uint8ClampedArray(canvasData.data);

                  // Decode QR code using jsQR
                  const code = jsQR(uint8Array, canvasData.width, canvasData.height);

                  if (code && code.data) {
                    if (!qrCodeDisplayed) {
                      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                      console.log('📱 SCAN THIS QR CODE WITH YOUR PHONE');
                      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                      // Display QR code in terminal
                      qrcode.generate(code.data, { small: true });

                      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                      console.log('📋 Steps to scan:');
                      console.log('   1. Open WhatsApp on your phone');
                      console.log('   2. Go to Settings > Linked Devices');
                      console.log('   3. Tap "Link a Device"');
                      console.log('   4. Point your camera at the QR code above');
                      console.log('   5. The system will automatically detect when logged in');
                      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                      qrCodeDisplayed = true;
                    }

                    qrCodeData = code.data; // Mark as successful
                  }
                }

                // Method 2: If direct extraction failed, try screenshot method
                if (!qrCodeData) {
                  try {
                    console.log('📸 Taking screenshot of canvas to extract QR code...');
                    const screenshotBuffer = await qrCanvas.screenshot();

                    // Use Jimp to read the image and extract pixel data
                    const image = await Jimp.read(screenshotBuffer);
                    const width = image.bitmap.width;
                    const height = image.bitmap.height;

                    // Convert Jimp image data to format jsQR expects
                    // jsQR expects Uint8ClampedArray in RGBA format
                    const imageData = new Uint8ClampedArray(width * height * 4);

                    for (let y = 0; y < height; y++) {
                      for (let x = 0; x < width; x++) {
                        const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
                        const idx = (y * width + x) * 4;
                        imageData[idx] = pixel.r;     // Red
                        imageData[idx + 1] = pixel.g; // Green
                        imageData[idx + 2] = pixel.b; // Blue
                        imageData[idx + 3] = pixel.a; // Alpha
                      }
                    }

                    // Decode QR code using jsQR
                    const code = jsQR(imageData, width, height);

                    if (code && code.data) {
                      if (!qrCodeDisplayed) {
                        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                        console.log('📱 SCAN THIS QR CODE WITH YOUR PHONE');
                        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                        // Display QR code in terminal
                        qrcode.generate(code.data, { small: true });

                        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                        console.log('📋 Steps to scan:');
                        console.log('   1. Open WhatsApp on your phone');
                        console.log('   2. Go to Settings > Linked Devices');
                        console.log('   3. Tap "Link a Device"');
                        console.log('   4. Point your camera at the QR code above');
                        console.log('   5. The system will automatically detect when logged in');
                        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                        qrCodeDisplayed = true;
                      }

                      qrCodeData = code.data; // Mark as successful
                    } else {
                      console.log('⚠️  Could not decode QR code from screenshot. Trying alternative methods...');
                    }
                  } catch (screenshotError) {
                    console.log('⚠️  Error with screenshot method:', screenshotError.message);
                  }
                }
              } catch (error) {
                console.log('⚠️  Error extracting QR code from canvas:', error.message);
              }
            }

            // Fallback: Try to extract QR code reference/URL from network or page
            if (!qrCodeData) {
              console.log('🔍 Trying alternative QR code extraction methods...');

              // Wait a bit more for network requests
              await wait(3000);

              // Try to get QR code reference from network interception
              let finalQrUrl = qrCodeUrl;

              if (!finalQrUrl && qrCodeRef) {
                finalQrUrl = `https://web.whatsapp.com/desktop/login_code.json?ref=${qrCodeRef}`;
              }

              // If still no URL, try extracting from page
              if (!finalQrUrl) {
                const pageData = await whatsappPage.evaluate(() => {
                  // Try to find ref in various places
                  try {
                    // Check localStorage
                    for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (key && (key.includes('ref') || key.includes('WASecret'))) {
                        try {
                          const value = JSON.parse(localStorage.getItem(key));
                          if (value && value.ref) {
                            return value.ref;
                          }
                        } catch (e) {
                          const value = localStorage.getItem(key);
                          if (value && value.length > 20) {
                            const match = value.match(/ref["\s:=]+([a-zA-Z0-9_-]{20,})/);
                            if (match) return match[1];
                          }
                        }
                      }
                    }

                    // Check script tags
                    const scripts = Array.from(document.querySelectorAll('script'));
                    for (const script of scripts) {
                      const content = script.innerHTML || script.textContent || '';
                      const match = content.match(/ref["\s:=]+([a-zA-Z0-9_-]{20,})/i);
                      if (match && match[1]) return match[1];
                    }
                  } catch (e) {
                    return null;
                  }
                  return null;
                });

                if (pageData) {
                  finalQrUrl = `https://web.whatsapp.com/desktop/login_code.json?ref=${pageData}`;
                }
              }

              if (finalQrUrl) {
                if (!qrCodeDisplayed) {
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

                  qrCodeDisplayed = true;
                }
              } else {
                console.log('⚠️  Could not extract QR code.');
                console.log('   The browser window is open - please scan the QR code there.');
                console.log('   WhatsApp will automatically connect once logged in.');
              }
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
