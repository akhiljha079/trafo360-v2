// Dynamic mailer: reads SMTP settings from DB (Admin > SMTP Settings) first,
// falls back to .env values if the DB table is empty. This lets Director /
// Admin change SMTP credentials from the UI without redeploying.
const nodemailer = require('nodemailer');
const pool = require('./db');

async function getSmtpConfig() {
  try {
    const [rows] = await pool.query('SELECT * FROM smtp_settings ORDER BY id DESC LIMIT 1');
    if (rows.length) {
      const s = rows[0];
      return {
        host: s.host,
        port: s.port,
        secure: !!s.secure,
        auth: { user: s.username, pass: s.password },
        fromEmail: s.from_email,
        fromName: s.from_name
      };
    }
  } catch (e) {
    console.error('SMTP settings lookup failed, using .env fallback:', e.message);
  }
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    fromEmail: process.env.SMTP_FROM_EMAIL,
    fromName: process.env.SMTP_FROM_NAME
  };
}

async function sendMail({ to, subject, html, text }) {
  const cfg = await getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth
  });

  const info = await transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to,
    subject,
    html,
    text: text || undefined
  });
  return info;
}

module.exports = { sendMail, getSmtpConfig };
