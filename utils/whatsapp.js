// =====================================================================
// WhatsApp notifications WITHOUT the paid WhatsApp Business API.
// This uses whatsapp-web.js, which automates a real WhatsApp Web session
// (via a headless Chromium browser) logged into one company phone number,
// exactly as if that phone had WhatsApp Web open in a browser tab 24/7.
//
// IMPORTANT - PLEASE READ BEFORE ENABLING:
//  1. This is UNOFFICIAL automation of WhatsApp's consumer app. It is not
//     endorsed by WhatsApp/Meta, and their Terms of Service technically
//     prohibit this kind of automation. In practice this is very widely
//     used for internal/staff notifications, but there is a real (if low)
//     risk that WhatsApp could flag or temporarily restrict the linked
//     number if it sends a high volume of messages quickly. Recommended:
//       - Use a dedicated company phone number for this, not someone's
//         personal daily-use number.
//       - Keep volume reasonable (this system only sends when a stage
//         changes or a document reminder/escalation fires - not bulk/marketing).
//  2. The linked phone must stay powered on and connected to the internet
//     (WhatsApp Web requires the phone to relay messages).
//  3. Requires a headless Chromium browser on the server. On aaPanel this
//     typically means either letting Puppeteer download its own Chromium
//     (~300MB, needs the server to have outbound internet access) or
//     installing Chromium via `apt install chromium` and pointing
//     PUPPETEER_EXECUTABLE_PATH at it (lighter, recommended - see README).
//  4. This module is fully optional. If it fails to start (no Chromium,
//     no internet, etc.) the rest of the application - email notifications,
//     the workflow, and the document library - is completely unaffected.
// =====================================================================
const QRCode = require('qrcode');
const pool = require('../config/db');

let client = null;
let status = 'disabled'; // disabled | initializing | qr_pending | ready | error
let lastQrDataUrl = null;
let lastError = null;

function getStatus() {
  return { status, qr: lastQrDataUrl, error: lastError };
}

async function initWhatsApp() {
  if (status === 'initializing' || status === 'ready' || status === 'qr_pending') {
    return getStatus(); // already running / starting
  }
  status = 'initializing';
  lastError = null;
  try {
    // Lazy-require so the app boots fine even if this package/Chromium isn't
    // fully set up yet - only touched when WhatsApp is actually enabled.
    const { Client, LocalAuth } = require('whatsapp-web.js');

    const puppeteerOptions = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    client = new Client({
      authStrategy: new LocalAuth({ dataPath: require('path').join(__dirname, '..', '.wwebjs_auth') }),
      puppeteer: puppeteerOptions
    });

    client.on('qr', async (qr) => {
      status = 'qr_pending';
      lastQrDataUrl = await QRCode.toDataURL(qr, { width: 280 });
      console.log('[whatsapp] QR code ready - visit Admin > WhatsApp Notifications to scan it.');
    });

    client.on('ready', () => {
      status = 'ready';
      lastQrDataUrl = null;
      console.log('[whatsapp] WhatsApp Web session connected and ready.');
    });

    client.on('auth_failure', (msg) => {
      status = 'error';
      lastError = 'Authentication failed: ' + msg;
      console.error('[whatsapp] auth_failure:', msg);
    });

    client.on('disconnected', (reason) => {
      status = 'error';
      lastError = 'Disconnected: ' + reason;
      console.warn('[whatsapp] disconnected:', reason);
    });

    await client.initialize();
  } catch (err) {
    status = 'error';
    lastError = err.message;
    console.error('[whatsapp] Failed to initialize (this is optional - email notifications still work):', err.message);
  }
  return getStatus();
}

async function disableWhatsApp() {
  try {
    if (client) await client.destroy();
  } catch (err) {
    console.error('[whatsapp] Error while disconnecting:', err.message);
  }
  client = null;
  status = 'disabled';
  lastQrDataUrl = null;
  return getStatus();
}

function normalizeNumber(raw) {
  // Expect something like "91XXXXXXXXXX" (country code + number, digits only)
  const digits = String(raw || '').replace(/\D/g, '');
  return digits;
}

// Sends a plain-text WhatsApp message. Silently no-ops (returns {sent:false})
// if WhatsApp isn't connected or the user has no whatsapp_number on file -
// callers should always also be sending the email, so this never blocks
// the core notification.
async function sendWhatsAppMessage(rawNumber, message) {
  if (status !== 'ready' || !client) return { sent: false, reason: 'not_connected' };
  const number = normalizeNumber(rawNumber);
  if (!number) return { sent: false, reason: 'no_number' };
  try {
    const chatId = `${number}@c.us`;
    await client.sendMessage(chatId, message);
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

async function isEnabledInSettings() {
  const [[row]] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='whatsapp_enabled'`);
  return row && row.setting_value === '1';
}

module.exports = {
  initWhatsApp, disableWhatsApp, getStatus, sendWhatsAppMessage, isEnabledInSettings
};
