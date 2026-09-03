// Sends "job moved to next stage" emails based on notification_rules
// configured by Admin/Director in Admin > Notification Rules.
const pool = require('../config/db');
const { sendMail } = require('../config/mailer');
const { sendWhatsAppMessage, getStatus: getWhatsAppStatus } = require('./whatsapp');

async function resolveRecipients(ruleRows) {
  const users = new Map(); // email -> { email, whatsapp_number }
  for (const r of ruleRows) {
    if (r.recipient_user_id) {
      const [rows] = await pool.query('SELECT email, whatsapp_number FROM users WHERE id=? AND is_active=1', [r.recipient_user_id]);
      rows.forEach(u => users.set(u.email, u));
    }
    if (r.recipient_role_id) {
      const [rows] = await pool.query('SELECT email, whatsapp_number FROM users WHERE role_id=? AND is_active=1', [r.recipient_role_id]);
      rows.forEach(u => users.set(u.email, u));
    }
  }
  return [...users.values()];
}

// event: 'on_start' | 'on_complete'
async function notifyStageEvent(jobId, stageId, event, remarks = '') {
  const [[job]] = await pool.query('SELECT * FROM jobs WHERE id=?', [jobId]);
  const [[stage]] = await pool.query('SELECT * FROM stages WHERE id=?', [stageId]);
  if (!job || !stage) return;

  const [rules] = await pool.query(
    'SELECT * FROM notification_rules WHERE stage_id=? AND event=? AND is_active=1',
    [stageId, event]
  );
  if (!rules.length) return; // no one configured to be notified for this stage/event

  const recipients = await resolveRecipients(rules);
  if (!recipients.length) return;

  const actionLabel = event === 'on_start' ? 'has entered' : 'has completed';
  const subject = `[${job.job_no}] ${job.customer_name} - ${stage.stage_name} (${stage.phase}) ${event === 'on_start' ? 'Started' : 'Completed'}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#1F2937">
      <h2 style="color:#1F4E78;margin-bottom:4px;">TRAFO 360 - Workflow Update</h2>
      <p>Job <b>${job.job_no}</b> for customer <b>${job.customer_name}</b>
      (${job.transformer_type}, ${job.rating || 'N/A'}, Serial: ${job.serial_no || 'N/A'})
      ${actionLabel} the stage:</p>
      <table style="border-collapse:collapse;margin:10px 0;">
        <tr><td style="padding:4px 10px;font-weight:bold;">Phase:</td><td style="padding:4px 10px;">${stage.phase}</td></tr>
        <tr><td style="padding:4px 10px;font-weight:bold;">Stage:</td><td style="padding:4px 10px;">${stage.stage_code} - ${stage.stage_name}</td></tr>
        <tr><td style="padding:4px 10px;font-weight:bold;">Status:</td><td style="padding:4px 10px;">${event === 'on_start' ? 'Started' : 'Completed'}</td></tr>
        ${remarks ? `<tr><td style="padding:4px 10px;font-weight:bold;">Remarks:</td><td style="padding:4px 10px;">${remarks}</td></tr>` : ''}
      </table>
      <p style="color:#6B7280;font-size:12px;">This is an automated notification from TRAFO 360 (Trafo Power & Electricals).</p>
    </div>`;
  const whatsappText = `*TRAFO 360 - Workflow Update*\nJob *${job.job_no}* (${job.customer_name}) ${actionLabel} stage:\n${stage.stage_code} - ${stage.stage_name} (${stage.phase})\nStatus: ${event === 'on_start' ? 'Started' : 'Completed'}${remarks ? `\nRemarks: ${remarks}` : ''}`;

  const waStatus = getWhatsAppStatus();
  for (const to of recipients) {
    try {
      await sendMail({ to: to.email, subject, html });
      await pool.query(
        `INSERT INTO email_log (category, channel, job_id, recipient_email, subject, body, status) VALUES ('Workflow Stage','Email', ?, ?, ?, ?, 'Sent')`,
        [jobId, to.email, subject, html]
      );
    } catch (err) {
      await pool.query(
        `INSERT INTO email_log (category, channel, job_id, recipient_email, subject, body, status, error_msg) VALUES ('Workflow Stage','Email', ?, ?, ?, ?, 'Failed', ?)`,
        [jobId, to.email, subject, html, err.message]
      );
    }

    if (waStatus.status === 'ready' && to.whatsapp_number) {
      const result = await sendWhatsAppMessage(to.whatsapp_number, whatsappText);
      await pool.query(
        `INSERT INTO email_log (category, channel, job_id, recipient_email, subject, body, status, error_msg) VALUES ('Workflow Stage','WhatsApp', ?, ?, ?, ?, ?, ?)`,
        [jobId, to.whatsapp_number, subject, whatsappText, result.sent ? 'Sent' : 'Failed', result.sent ? null : result.reason]
      );
    }
  }
}

module.exports = { notifyStageEvent };
