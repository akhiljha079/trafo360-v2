// Handles every email/WhatsApp message in the Document Issue Management
// lifecycle: approval request -> approved/rejected -> reminders -> overdue
// grace -> director escalation -> extension request/decision.
const pool = require('../config/db');
const { sendMail } = require('../config/mailer');
const { sendWhatsAppMessage, getStatus: getWhatsAppStatus } = require('./whatsapp');

function wrap(title, bodyHtml) {
  return `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#1F2937">
    <h2 style="color:#1F4E78;margin-bottom:4px;">TRAFO 360 - Document Issue Management</h2>
    <h3 style="color:#2E75B6;margin-top:0;">${title}</h3>
    ${bodyHtml}
    <p style="color:#6B7280;font-size:12px;margin-top:20px;">This is an automated notification from TRAFO 360 (Trafo Power & Electricals).</p>
  </div>`;
}

async function log(issueId, channel, to, subject, body, status = 'Sent', error = null) {
  await pool.query(
    `INSERT INTO email_log (category, channel, document_issue_id, recipient_email, subject, body, status, error_msg)
     VALUES ('Document Issue', ?, ?, ?, ?, ?, ?, ?)`,
    [channel, issueId, to, subject, body, status, error]
  );
}

async function send(issueId, to, subject, html) {
  try {
    await sendMail({ to, subject, html });
    await log(issueId, 'Email', to, subject, html, 'Sent');
  } catch (err) {
    await log(issueId, 'Email', to, subject, html, 'Failed', err.message);
  }
}

// Sends the WhatsApp equivalent to a { whatsapp_number } recipient, but only
// if a WhatsApp Web session is actually connected. Always a safe no-op
// fallback - never blocks or replaces the email above.
async function sendWA(issueId, person, subject, plainText) {
  if (!person || !person.whatsapp_number) return;
  const waStatus = getWhatsAppStatus();
  if (waStatus.status !== 'ready') return;
  const result = await sendWhatsAppMessage(person.whatsapp_number, plainText);
  await log(issueId, 'WhatsApp', person.whatsapp_number, subject, plainText, result.sent ? 'Sent' : 'Failed', result.sent ? null : result.reason);
}

async function getIssueBundle(issueId) {
  const [[issue]] = await pool.query('SELECT * FROM document_issues WHERE id=?', [issueId]);
  if (!issue) return null;
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [issue.document_id]);
  const [[requester]] = await pool.query('SELECT * FROM users WHERE id=?', [issue.requested_by]);
  let approver = null;
  if (issue.approver_id) {
    [[approver]] = await pool.query('SELECT * FROM users WHERE id=?', [issue.approver_id]);
  }
  return { issue, doc, requester, approver };
}

// 1) New issue request submitted -> notify approver(s) (Director / role with can_approve_document_issue)
async function notifyApprovalRequested(issueId) {
  const { issue, doc, requester } = await getIssueBundle(issueId);
  const [approvers] = await pool.query(
    `SELECT u.email, u.whatsapp_number FROM users u JOIN roles r ON u.role_id=r.id
     WHERE r.can_approve_document_issue=1 AND u.is_active=1`
  );
  const subject = `Approval Needed: Document Issue Request - ${doc.doc_code} (${doc.doc_name})`;
  const html = wrap('Document Issue - Approval Required', `
    <p><b>${requester.name}</b> has requested to issue the following document:</p>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 10px;font-weight:bold;">Document:</td><td style="padding:4px 10px;">${doc.doc_code} - ${doc.doc_name}</td></tr>
      <tr><td style="padding:4px 10px;font-weight:bold;">Confidentiality:</td><td style="padding:4px 10px;">${doc.confidentiality}</td></tr>
      <tr><td style="padding:4px 10px;font-weight:bold;">Purpose:</td><td style="padding:4px 10px;">${issue.purpose || 'N/A'}</td></tr>
      <tr><td style="padding:4px 10px;font-weight:bold;">Requested Period:</td><td style="padding:4px 10px;">${issue.requested_days} day(s)</td></tr>
    </table>
    <p>Please log in to the system to Approve or Reject this request.</p>`);
  const waText = `*Document Issue Approval Needed*\n${requester.name} requested to issue:\n${doc.doc_code} - ${doc.doc_name}\nConfidentiality: ${doc.confidentiality}\nPurpose: ${issue.purpose || 'N/A'}\nPeriod: ${issue.requested_days} day(s)\nPlease log in to approve/reject.`;
  for (const a of approvers) {
    await send(issueId, a.email, subject, html);
    await sendWA(issueId, a, subject, waText);
  }
}

// 2) Approver decides (approved -> issued) or rejected -> notify requester
async function notifyApprovalDecision(issueId, approved) {
  const { issue, doc, requester, approver } = await getIssueBundle(issueId);
  const subject = `Document Issue Request ${approved ? 'Approved' : 'Rejected'} - ${doc.doc_code}`;
  const html = wrap(`Your Request Was ${approved ? 'Approved' : 'Rejected'}`, `
    <p>Document: <b>${doc.doc_code} - ${doc.doc_name}</b></p>
    ${approved
      ? `<p>Issue Date: <b>${issue.issue_date}</b><br/>Due Date: <b>${issue.due_date}</b></p>
         <p>Please collect/access the document and return or renew it before the due date.</p>`
      : `<p>Reason/Remarks: ${issue.approval_remarks || 'Not specified'}</p>`}
    <p>Decided by: ${approver ? approver.name : 'N/A'}</p>`);
  await send(issueId, requester.email, subject, html);
  const waText = approved
    ? `*Document Issue Approved*\n${doc.doc_code} - ${doc.doc_name}\nIssue Date: ${issue.issue_date}\nDue Date: ${issue.due_date}\nDecided by: ${approver ? approver.name : 'N/A'}`
    : `*Document Issue Rejected*\n${doc.doc_code} - ${doc.doc_name}\nRemarks: ${issue.approval_remarks || 'Not specified'}\nDecided by: ${approver ? approver.name : 'N/A'}`;
  await sendWA(issueId, requester, subject, waText);
}

// 3) Reminder before due date / on due date
async function notifyReminder(issueId, whenLabel) {
  const { issue, doc, requester } = await getIssueBundle(issueId);
  const subject = `Reminder: Document Due ${whenLabel} - ${doc.doc_code}`;
  const html = wrap(`Document Return Reminder (${whenLabel})`, `
    <p>The document <b>${doc.doc_code} - ${doc.doc_name}</b> issued to you is due
    ${whenLabel.toLowerCase()} (<b>${issue.due_date}</b>).</p>
    <p>Please return it, or request an extension before the due date if you need more time.</p>`);
  const waText = `*Document Return Reminder (${whenLabel})*\n${doc.doc_code} - ${doc.doc_name}\nDue: ${issue.due_date}\nPlease return it or request an extension.`;
  await send(issueId, requester.email, subject, html);
  await sendWA(issueId, requester, subject, waText);

  // Also copy the Documents Coordinator
  const [coordinators] = await pool.query(
    `SELECT u.email, u.whatsapp_number FROM users u JOIN roles r ON u.role_id=r.id WHERE r.can_manage_documents=1 AND u.is_active=1`
  );
  for (const c of coordinators) {
    await send(issueId, c.email, subject, html);
    await sendWA(issueId, c, subject, waText);
  }
}

// 4) Overdue but within grace period - reminder to holder + issuer/coordinator
async function notifyOverdueGrace(issueId, workingDaysOverdue) {
  const { issue, doc, requester } = await getIssueBundle(issueId);
  const subject = `OVERDUE: Document Not Returned (Day ${workingDaysOverdue} of grace) - ${doc.doc_code}`;
  const html = wrap('Document Overdue - Grace Period Running', `
    <p>The document <b>${doc.doc_code} - ${doc.doc_name}</b> was due on <b>${issue.due_date}</b>
    and has not yet been returned or extended.</p>
    <p>This is working day <b>${workingDaysOverdue}</b> of the grace period. If not returned or
    extended within the grace period, this will be automatically escalated to the Director.</p>`);
  const waText = `*OVERDUE Document* (Grace Day ${workingDaysOverdue})\n${doc.doc_code} - ${doc.doc_name}\nDue: ${issue.due_date}\nWill auto-escalate to Director if not returned/extended within the grace period.`;
  await send(issueId, requester.email, subject, html);
  await sendWA(issueId, requester, subject, waText);
  const [coordinators] = await pool.query(
    `SELECT u.email, u.whatsapp_number FROM users u JOIN roles r ON u.role_id=r.id WHERE r.can_manage_documents=1 AND u.is_active=1`
  );
  for (const c of coordinators) {
    await send(issueId, c.email, subject, html);
    await sendWA(issueId, c, subject, waText);
  }
}

// 5) Grace period exceeded -> auto escalate to Director
async function notifyEscalation(issueId) {
  const { issue, doc, requester } = await getIssueBundle(issueId);
  const [directors] = await pool.query(
    `SELECT u.email, u.whatsapp_number FROM users u JOIN roles r ON u.role_id=r.id WHERE r.is_director=1 AND u.is_active=1`
  );
  const subject = `ESCALATION: Document Not Returned Beyond Grace Period - ${doc.doc_code}`;
  const html = wrap('Escalation: Document Overdue Beyond Grace Period', `
    <p>The document <b>${doc.doc_code} - ${doc.doc_name}</b> issued to <b>${requester.name}</b>
    (${requester.email}) was due on <b>${issue.due_date}</b> and has exceeded the permitted grace
    period without being returned or an extension being approved.</p>
    <p>This request has been automatically escalated for your attention.</p>`);
  const waText = `*ESCALATION - Document Overdue*\n${doc.doc_code} - ${doc.doc_name}\nHeld by: ${requester.name} (${requester.email})\nDue: ${issue.due_date}\nGrace period exceeded - please review.`;
  for (const d of directors) {
    await send(issueId, d.email, subject, html);
    await sendWA(issueId, d, subject, waText);
  }
}

// 6) Extension requested -> notify approver(s)
async function notifyExtensionRequested(issueId, extensionId) {
  const { issue, doc, requester } = await getIssueBundle(issueId);
  const [[ext]] = await pool.query('SELECT * FROM issue_extensions WHERE id=?', [extensionId]);
  const [approvers] = await pool.query(
    `SELECT u.email, u.whatsapp_number FROM users u JOIN roles r ON u.role_id=r.id WHERE r.can_approve_document_issue=1 AND u.is_active=1`
  );
  const subject = `Approval Needed: Extension Request - ${doc.doc_code}`;
  const html = wrap('Document Issue - Extension Approval Required', `
    <p><b>${requester.name}</b> has requested an extension for document
    <b>${doc.doc_code} - ${doc.doc_name}</b>.</p>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 10px;font-weight:bold;">Current Due Date:</td><td style="padding:4px 10px;">${issue.due_date}</td></tr>
      <tr><td style="padding:4px 10px;font-weight:bold;">Requested New Due Date:</td><td style="padding:4px 10px;">${ext.requested_new_due_date}</td></tr>
      <tr><td style="padding:4px 10px;font-weight:bold;">Reason:</td><td style="padding:4px 10px;">${ext.reason || 'N/A'}</td></tr>
    </table>`);
  const waText = `*Extension Approval Needed*\n${requester.name} requested an extension for:\n${doc.doc_code} - ${doc.doc_name}\nCurrent Due: ${issue.due_date}\nRequested New Due: ${ext.requested_new_due_date}\nReason: ${ext.reason || 'N/A'}`;
  for (const a of approvers) {
    await send(issueId, a.email, subject, html);
    await sendWA(issueId, a, subject, waText);
  }
}

// 7) Extension decision -> notify requester
async function notifyExtensionDecision(issueId, extensionId, approved) {
  const { issue, doc, requester } = await getIssueBundle(issueId);
  const [[ext]] = await pool.query('SELECT * FROM issue_extensions WHERE id=?', [extensionId]);
  const subject = `Extension Request ${approved ? 'Approved' : 'Rejected'} - ${doc.doc_code}`;
  const html = wrap(`Your Extension Request Was ${approved ? 'Approved' : 'Rejected'}`, `
    <p>Document: <b>${doc.doc_code} - ${doc.doc_name}</b></p>
    ${approved
      ? `<p>New Due Date: <b>${ext.requested_new_due_date}</b></p>`
      : `<p>The document remains due on <b>${issue.due_date}</b>. Please return it promptly.</p>`}
  `);
  const waText = approved
    ? `*Extension Approved*\n${doc.doc_code} - ${doc.doc_name}\nNew Due Date: ${ext.requested_new_due_date}`
    : `*Extension Rejected*\n${doc.doc_code} - ${doc.doc_name}\nStill due: ${issue.due_date}. Please return promptly.`;
  await send(issueId, requester.email, subject, html);
  await sendWA(issueId, requester, subject, waText);
}

module.exports = {
  notifyApprovalRequested,
  notifyApprovalDecision,
  notifyReminder,
  notifyOverdueGrace,
  notifyEscalation,
  notifyExtensionRequested,
  notifyExtensionDecision
};
