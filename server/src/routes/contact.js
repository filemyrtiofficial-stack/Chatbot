import express from 'express';
import { z } from 'zod';
import { getConfig } from '../config.js';
import whatsappService from '../services/whatsapp.js';

const router = express.Router();

const contactFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phoneNumber: z.string().min(1, 'Phone number is required'),
  query: z.string().optional().default(''),
});

// GET endpoint to initialize WhatsApp and show QR code (for manual setup)
router.get('/init-whatsapp', async (req, res) => {
  try {
    console.log('🔄 Manual WhatsApp initialization triggered...');

    // Initialize WhatsApp service
    await whatsappService.initialize();

    if (whatsappService.getConnectionStatus()) {
      return res.json({
        success: true,
        message: 'WhatsApp is already connected.',
        isReady: true,
      });
    } else {
      return res.json({
        success: true,
        message: 'WhatsApp initialization started. Check the terminal for QR code if login is needed.',
        isReady: false,
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

    const { name, phoneNumber, query } = parsed.data;
    const config = getConfig();
    const adminPhone = config.ADMIN_WHATSAPP_NUMBER;

    // Log received data for debugging
    console.log('📝 Contact form submission received:');
    console.log(`   Name: ${name}`);
    console.log(`   Phone: ${phoneNumber}`);
    console.log(`   Query: ${query ? query.substring(0, 50) + '...' : '(empty)'}`);

    if (!adminPhone) {
      console.warn('ADMIN_WHATSAPP_NUMBER not configured. Skipping WhatsApp notification.');
      return res.json({
        success: true,
        message: 'Your query has been submitted successfully',
        notificationSent: false,
      });
    }

    // Create notification message with better formatting
    const timestamp = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const queryText = query && query.trim() ? query.trim() : 'No query provided';

    const message = `🔔 *New Contact Form Submission*

👤 *Name:* ${name}

📞 *Phone:* ${phoneNumber}

💬 *Query:*
${queryText}

⏰ *Time:* ${timestamp}`;

    // Initialize WhatsApp if not connected (non-blocking)
    if (!whatsappService.getConnectionStatus()) {
      whatsappService.initialize().catch(err => {
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
    const notificationSent = await whatsappService.sendWhatsAppMessage(message);

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

export default router;
