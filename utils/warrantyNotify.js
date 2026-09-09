// Email/WhatsApp notifications for the Warranty module: a new claim raised,
// a claim decided (Resolved/Rejected), and a warranty entering its
// "Expiring" window (see cron/scheduler.js). Mirrors the structure of
// utils/documentNotify.js.
const pool = require('../config/db');
const { sendMail } = require('../config/mailer');
const { sendWhatsAppMessage, getStatus: getWhatsAppStatus } = require('./whatsapp');
const { usersWithModulePermission } = require('./permissionRecipients');

function wrap(title, bodyHtml) {
  return `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#1F2937">
    <h2 style="color:#1F4E78;margin-bottom:4px;">TRAFO 360 - Warranty</h2>
    <h3 style="color:#2E75B6;margin-top:0;">${title}</h3>
    ${bodyHtml}
    <p style="color:#6B7280;font-size:12px;margin-top:20px;">This is an automated notification from TRAFO 360 (Trafo Power & Electricals).</p>
  </div>`;
}

async function log(category, to, subject, body, status = 'Sent', error = null) {
  await pool.query(
    `INSERT INTO email_log (category, channel, recipient_email, subject, body, status, error_msg) VALUES (?, 'Email', ?, ?, ?, ?, ?)`,
    [category, to, subject, body, status, error]
  );
}

async function send(category, to, subject, html) {
  try {
    await sendMail({ to, subject, html });
    await log(category, to, subject, html, 'Sent');
  } catch (err) {
    await log(category, to, subject, html, 'Failed', err.message);
  }
}

async function sendWA(category, person, subject, plainText) {
  if (!person || !person.whatsapp_number) return;
  if (getWhatsAppStatus().status !== 'ready') return;
  const result = await sendWhatsAppMessage(person.whatsapp_number, plainText);
  await pool.query(
    `INSERT INTO email_log (category, channel, recipient_email, subject, body, status, error_msg) VALUES (?, 'WhatsApp', ?, ?, ?, ?, ?)`,
    [category, person.whatsapp_number, subject, plainText, result.sent ? 'Sent' : 'Failed', result.sent ? null : result.reason]
  );
}

async function getClaimBundle(claimId) {
  const [[claim]] = await pool.query(
    `SELECT wc.*, w.job_id, j.job_no, j.customer_name FROM warranty_claims wc
     JOIN warranties w ON wc.warranty_id = w.id JOIN jobs j ON w.job_id = j.id
     WHERE wc.id=?`, [claimId]
  );
  return claim;
}

async function notifyClaimRaised(claimId) {
  const claim = await getClaimBundle(claimId);
  if (!claim) return;
  const approvers = await usersWithModulePermission('warranty', 'approve');
  const subject = `New Warranty Claim ${claim.claim_no} - ${claim.job_no} (${claim.customer_name})`;
  const html = wrap('New Warranty Claim Raised', `
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 10px;font-weight:bold;">Claim:</td><td style="padding:4px 10px;">${claim.claim_no}</td></tr>
      <tr><td style="padding:4px 10px;font-weight:bold;">Unit:</td><td style="padding:4px 10px;">${claim.job_no} - ${claim.customer_name}</td></tr>
      <tr><td style="padding:4px 10px;font-weight:bold;">Complaint:</td><td style="padding:4px 10px;">${claim.customer_complaint}</td></tr>
    </table>
    <p>Please log in to review and assign this claim.</p>`);
  const waText = `*New Warranty Claim*\n${claim.claim_no} - ${claim.job_no} (${claim.customer_name})\nComplaint: ${claim.customer_complaint}`;
  for (const a of approvers) {
    await send('Warranty', a.email, subject, html);
    await sendWA('Warranty', a, subject, waText);
  }
}

async function notifyClaimDecision(claimId) {
  const claim = await getClaimBundle(claimId);
  if (!claim) return;
  const [[raiser]] = claim.raised_by ? await pool.query('SELECT email, whatsapp_number FROM users WHERE id=?', [claim.raised_by]) : [[null]];
  if (!raiser) return;
  const subject = `Warranty Claim ${claim.claim_no} ${claim.status} - ${claim.job_no}`;
  const html = wrap(`Claim ${claim.status}`, `
    <p>Claim <b>${claim.claim_no}</b> for unit <b>${claim.job_no}</b> (${claim.customer_name}) was marked <b>${claim.status}</b>.</p>
    ${claim.resolution_notes ? `<p>Notes: ${claim.resolution_notes}</p>` : ''}`);
  const waText = `*Warranty Claim ${claim.status}*\n${claim.claim_no} - ${claim.job_no}${claim.resolution_notes ? `\nNotes: ${claim.resolution_notes}` : ''}`;
  await send('Warranty', raiser.email, subject, html);
  await sendWA('Warranty', raiser, subject, waText);
}

async function notifyWarrantyExpiring(warrantyId) {
  const [[w]] = await pool.query(
    `SELECT w.*, j.job_no, j.customer_name FROM warranties w JOIN jobs j ON w.job_id = j.id WHERE w.id=?`, [warrantyId]
  );
  if (!w) return;
  const recipients = await usersWithModulePermission('warranty', 'edit');
  const subject = `Warranty Expiring Soon - ${w.job_no} (${w.customer_name})`;
  const html = wrap('Warranty Expiring Soon', `
    <p>The warranty on unit <b>${w.job_no}</b> (${w.customer_name}) expires on <b>${w.end_date}</b>.</p>`);
  const waText = `*Warranty Expiring Soon*\n${w.job_no} (${w.customer_name})\nExpires: ${w.end_date}`;
  for (const r of recipients) {
    await send('Warranty', r.email, subject, html);
    await sendWA('Warranty', r, subject, waText);
  }
}

module.exports = { notifyClaimRaised, notifyClaimDecision, notifyWarrantyExpiring };
