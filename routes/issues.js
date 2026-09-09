const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireModule } = require('../middleware/auth');
const {
  notifyApprovalRequested,
  notifyApprovalDecision,
  notifyExtensionRequested,
  notifyExtensionDecision
} = require('../utils/documentNotify');
const router = express.Router();

async function getSetting(key, fallback) {
  const [[row]] = await pool.query('SELECT setting_value FROM system_settings WHERE setting_key=?', [key]);
  return row ? row.setting_value : fallback;
}

// LIST (my issues + all issues for coordinators/approvers)
router.get('/issues', requireAuth, async (req, res) => {
  const u = req.session.user;
  let sql = `SELECT di.*, d.doc_code, d.doc_name, d.confidentiality, req.name AS requester_name, ap.name AS approver_name
             FROM document_issues di
             JOIN documents d ON di.document_id=d.id
             JOIN users req ON di.requested_by=req.id
             LEFT JOIN users ap ON di.approver_id=ap.id`;
  const params = [];
  const canSeeAll = u.is_admin || (u.permissions.documents && (u.permissions.documents.edit || u.permissions.documents.approve));
  if (!canSeeAll) {
    sql += ' WHERE di.requested_by=?';
    params.push(u.id);
  }
  sql += ' ORDER BY di.created_at DESC';
  const [issues] = await pool.query(sql, params);
  res.render('issues/list', { title: 'Document Issues', issues });
});

// NEW ISSUE REQUEST (form) - from a document's page, ?document_id=
router.get('/issues/new', requireAuth, async (req, res) => {
  const { document_id } = req.query;
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [document_id]);
  if (!doc) { req.flash('error', 'Document not found.'); return res.redirect('/documents'); }
  const defaultDays = await getSetting('default_issue_days', '7');
  res.render('issues/new', { title: 'Request Document Issue', doc, defaultDays });
});

// CREATE ISSUE REQUEST -> Pending Approval, notify approvers
router.post('/issues', requireAuth, async (req, res) => {
  const { document_id, purpose, requested_days } = req.body;
  try {
    const [result] = await pool.query(
      `INSERT INTO document_issues (document_id, requested_by, purpose, requested_days, status)
       VALUES (?,?,?,?, 'Pending Approval')`,
      [document_id, req.session.user.id, purpose, requested_days || 7]
    );
    await notifyApprovalRequested(result.insertId);
    req.flash('success', 'Issue request submitted for approval.');
    res.redirect(`/issues/${result.insertId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not submit issue request.');
    res.redirect('/documents');
  }
});

// VIEW ONE ISSUE
router.get('/issues/:id', requireAuth, async (req, res) => {
  const [[issue]] = await pool.query(
    `SELECT di.*, d.doc_code, d.doc_name, d.confidentiality, req.name AS requester_name, req.email AS requester_email,
            ap.name AS approver_name
     FROM document_issues di JOIN documents d ON di.document_id=d.id
     JOIN users req ON di.requested_by=req.id LEFT JOIN users ap ON di.approver_id=ap.id
     WHERE di.id=?`, [req.params.id]);
  if (!issue) { req.flash('error', 'Issue record not found.'); return res.redirect('/issues'); }
  const [extensions] = await pool.query('SELECT * FROM issue_extensions WHERE document_issue_id=? ORDER BY created_at DESC', [req.params.id]);
  res.render('issues/view', { title: `Issue #${issue.id}`, issue, extensions });
});

// APPROVE / REJECT (Director or role with can_approve_document_issue)
router.post('/issues/:id/decision', requireAuth, requireModule('documents', 'approve'), async (req, res) => {
  const { decision, remarks, signature } = req.body; // decision = 'approve' | 'reject'
  const issueId = req.params.id;
  try {
    const [[issue]] = await pool.query('SELECT * FROM document_issues WHERE id=?', [issueId]);
    if (!issue) { req.flash('error', 'Issue not found.'); return res.redirect('/issues'); }

    if (decision === 'approve') {
      if (!signature) {
        req.flash('error', 'A signature is required to approve this request.');
        return res.redirect(`/issues/${issueId}`);
      }
      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + Number(issue.requested_days || 7));
      await pool.query(
        `UPDATE document_issues SET status='Issued', approver_id=?, approval_decision_at=NOW(), approval_remarks=?,
         approver_signature=?, issue_date=?, due_date=? WHERE id=?`,
        [req.session.user.id, remarks || null, signature, issueDate.toISOString().slice(0,10), dueDate.toISOString().slice(0,10), issueId]
      );
      await pool.query(`UPDATE documents SET current_status='Issued' WHERE id=?`, [issue.document_id]);
      await notifyApprovalDecision(issueId, true);
      req.flash('success', 'Issue request approved and document marked as Issued.');
    } else {
      await pool.query(
        `UPDATE document_issues SET status='Rejected', approver_id=?, approval_decision_at=NOW(), approval_remarks=?, approver_signature=? WHERE id=?`,
        [req.session.user.id, remarks || null, signature || null, issueId]
      );
      await notifyApprovalDecision(issueId, false);
      req.flash('success', 'Issue request rejected.');
    }
    res.redirect(`/issues/${issueId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not record decision.');
    res.redirect(`/issues/${issueId}`);
  }
});

// MARK RETURNED (Documents Coordinator)
router.post('/issues/:id/return', requireAuth, requireModule('documents', 'edit'), async (req, res) => {
  const issueId = req.params.id;
  try {
    const [[issue]] = await pool.query('SELECT * FROM document_issues WHERE id=?', [issueId]);
    await pool.query(
      `UPDATE document_issues SET status='Returned', return_date=CURDATE() WHERE id=?`, [issueId]
    );
    await pool.query(`UPDATE documents SET current_status='Available' WHERE id=?`, [issue.document_id]);
    req.flash('success', 'Document marked as returned.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not mark as returned.');
  }
  res.redirect(`/issues/${issueId}`);
});

// REQUEST EXTENSION (requester)
router.post('/issues/:id/extend', requireAuth, async (req, res) => {
  const { new_due_date, reason } = req.body;
  const issueId = req.params.id;
  try {
    const [result] = await pool.query(
      `INSERT INTO issue_extensions (document_issue_id, requested_new_due_date, reason) VALUES (?,?,?)`,
      [issueId, new_due_date, reason || null]
    );
    await pool.query(`UPDATE document_issues SET status='Extension Requested' WHERE id=?`, [issueId]);
    await notifyExtensionRequested(issueId, result.insertId);
    req.flash('success', 'Extension request submitted for approval.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not submit extension request.');
  }
  res.redirect(`/issues/${issueId}`);
});

// DECIDE EXTENSION (approver)
router.post('/issues/:id/extend/:extId/decision', requireAuth, requireModule('documents', 'approve'), async (req, res) => {
  const { decision, signature } = req.body; // 'approve' | 'reject'
  const { id: issueId, extId } = req.params;
  try {
    const [[ext]] = await pool.query('SELECT * FROM issue_extensions WHERE id=?', [extId]);
    if (decision === 'approve') {
      if (!signature) {
        req.flash('error', 'A signature is required to approve this extension.');
        return res.redirect(`/issues/${issueId}`);
      }
      await pool.query(
        `UPDATE issue_extensions SET status='Approved', approver_id=?, approver_signature=?, decided_at=NOW() WHERE id=?`,
        [req.session.user.id, signature, extId]
      );
      await pool.query(
        `UPDATE document_issues SET status='Issued', due_date=?, last_reminder_sent=NULL WHERE id=?`,
        [ext.requested_new_due_date, issueId]
      );
      await notifyExtensionDecision(issueId, extId, true);
      req.flash('success', 'Extension approved. Due date updated.');
    } else {
      await pool.query(
        `UPDATE issue_extensions SET status='Rejected', approver_id=?, approver_signature=?, decided_at=NOW() WHERE id=?`,
        [req.session.user.id, signature || null, extId]
      );
      await pool.query(`UPDATE document_issues SET status='Overdue' WHERE id=?`, [issueId]);
      await notifyExtensionDecision(issueId, extId, false);
      req.flash('success', 'Extension rejected.');
    }
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not record extension decision.');
  }
  res.redirect(`/issues/${issueId}`);
});

module.exports = router;
