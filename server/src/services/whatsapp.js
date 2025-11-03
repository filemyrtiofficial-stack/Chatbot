import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.config = getConfig();
    this.adminPhoneNumber = this.config.ADMIN_WHATSAPP_NUMBER || '';

    // Use auth_info folder for session storage (no .whatsapp-session needed)
    this.sessionPath = path.join(__dirname, '../../auth_info');

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
      console.log(`✅ Created WhatsApp session directory: ${this.sessionPath}`);
    }
  }

  /**
   * Initialize WhatsApp connection
   * This will show QR code on first run or reconnect if session exists
   */
  async initialize() {
    if (this.isConnecting) {
      console.log('🔄 WhatsApp connection already in progress...');
      return;
    }

    if (this.isConnected && this.sock) {
      console.log('✅ WhatsApp already connected');
      return;
    }

    try {
      this.isConnecting = true;
      console.log('🔄 Initializing WhatsApp connection...');

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

      // Fetch latest Baileys version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`📦 Using Baileys version: ${version.join('.')}`);

      // Create WhatsApp socket
      this.sock = makeWASocket({
        version,
        printQRInTerminal: false, // We'll handle QR manually for better display
        auth: state,
        logger: pino({ level: 'silent' }), // Suppress default logs
        browser: ['FileMyRTI Chatbot', 'Chrome', '1.0.0']
      });

      // Save credentials when updated
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Display QR code if needed
        if (qr) {
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('📱 SCAN THIS QR CODE WITH YOUR PHONE');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          qrcode.generate(qr, { small: true });
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('📋 Steps to scan:');
          console.log('   1. Open WhatsApp on your phone');
          console.log('   2. Go to Settings > Linked Devices');
          console.log('   3. Tap "Link a Device"');
          console.log('   4. Point your camera at the QR code above');
          console.log('   5. The system will automatically detect when logged in');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }

        // Handle connection status
        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);

          if (shouldReconnect) {
            console.log('⚠️  WhatsApp connection closed. Reconnecting...');
            this.isConnected = false;
            this.isConnecting = false;

            // Wait a bit before reconnecting
            setTimeout(() => {
              this.initialize();
            }, 3000);
          } else {
            console.log('❌ WhatsApp connection closed. Logged out. Please scan QR again.');
            this.isConnected = false;
            this.isConnecting = false;

            // Clear session to force new QR
            this.clearSession();
          }
        } else if (connection === 'open') {
          console.log('✅ WhatsApp connected successfully!');
          this.isConnected = true;
          this.isConnecting = false;

          // Display connection info
          const me = this.sock.user;
          if (me) {
            console.log(`👤 Logged in as: ${me.name || me.id}`);
          }
        } else if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        }
      });

    } catch (error) {
      console.error('❌ Error initializing WhatsApp:', error);
      this.isConnected = false;
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Send WhatsApp message to admin
   * @param {string} message - Message to send
   * @returns {Promise<boolean>} - Success status
   */
  async sendWhatsAppMessage(message) {
    try {
      // Ensure connected
      if (!this.isConnected || !this.sock) {
        console.log('⚠️  WhatsApp not connected. Attempting to connect...');
        await this.initialize();

        // Wait for connection with timeout
        let attempts = 0;
        while (!this.isConnected && attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }

        if (!this.isConnected) {
          throw new Error('Failed to establish WhatsApp connection. Please check QR code.');
        }
      }

      if (!this.adminPhoneNumber) {
        throw new Error('ADMIN_WHATSAPP_NUMBER not configured');
      }

      // Format phone number (ensure @s.whatsapp.net suffix)
      let phoneNumber = this.adminPhoneNumber.trim();

      // Remove any non-digit characters except @
      phoneNumber = phoneNumber.replace(/[^\d@]/g, '');

      // Add @s.whatsapp.net if not already present
      if (!phoneNumber.includes('@')) {
        phoneNumber = phoneNumber + '@s.whatsapp.net';
      } else if (phoneNumber.includes('@c.us')) {
        // Convert @c.us to @s.whatsapp.net (Baileys uses @s.whatsapp.net)
        phoneNumber = phoneNumber.replace('@c.us', '@s.whatsapp.net');
      }

      // Send message
      await this.sock.sendMessage(phoneNumber, { text: message });
      console.log(`✅ WhatsApp message sent to admin (${phoneNumber})`);
      return true;

    } catch (error) {
      console.error('❌ Error sending WhatsApp message:', error);

      // Try to reconnect on error
      if (error.message.includes('Connection') || error.message.includes('socket') || error.message.includes('close')) {
        this.isConnected = false;
        console.log('🔄 Attempting to reconnect WhatsApp...');
        setTimeout(() => this.initialize(), 3000);
      }

      return false;
    }
  }

  /**
   * Clear WhatsApp session (forces new QR on next connect)
   */
  clearSession() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
        console.log('🗑️  WhatsApp session cleared. Next connection will require new QR scan.');

        // Recreate directory
        fs.mkdirSync(this.sessionPath, { recursive: true });
      }
    } catch (error) {
      console.error('Error clearing WhatsApp session:', error);
    }
  }

  /**
   * Get connection status
   * @returns {boolean}
   */
  getConnectionStatus() {
    return this.isConnected;
  }
}

// Export singleton instance
export default new WhatsAppService();

