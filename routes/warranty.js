// Warranty module: tracking (auto-created on dispatch - see utils/warranty.js
// and the completion branch of routes/jobs.js /advance) plus full claims
// management (Open -> Investigating -> Resolved/Rejected -> Closed).
const express = require('express');
const crypto = require('crypto');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireModule } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { notifyClaimRaised, notifyClaimDecision } = require('../utils/warrantyNotify');
const router = express.Router();

// ---------------- DASHBOARD ----------------
router.get('/warranty', requireAuth, requireModule('warranty', 'view'), async (req, res) => {
  const { status } = req.query;
  const [[counts]] = await pool.query(`
    SELECT
      SUM(status='Active') AS active, SUM(status='Expiring') AS expiring,
      SUM(status='Expired') AS expired, SUM(status='Void') AS voidCount,
      COUNT(*) AS total
    FROM warranties`);

  let sql = `
    SELECT w.*, j.job_no, j.customer_name, j.transformer_type,
      (SELECT COUNT(*) FROM warranty_claims wc WHERE wc.warranty_id=w.id) AS claim_count,
      (SELECT COUNT(*) FROM warranty_claims wc WHERE wc.warranty_id=w.id AND wc.status IN ('Open','Investigating')) AS open_claim_count
    FROM warranties w JOIN jobs j ON w.job_id=j.id`;
  const params = [];
  if (status && ['Active', 'Expiring', 'Expired', 'Void'].includes(status)) {
    sql += ' WHERE w.status=?';
    params.push(status);
  }
  sql += ' ORDER BY w.end_date ASC';
  const [warranties] = await pool.query(sql, params);

  res.render('warranty/dashboard', { title: 'Warranty', counts, warranties, filterStatus: status || '' });
});

// ---------------- WARRANTY DETAIL ----------------
router.get('/warranty/:id', requireAuth, requireModule('warranty', 'view'), async (req, res) => {
  const [[warranty]] = await pool.query(
    `SELECT w.*, j.job_no, j.customer_name, j.transformer_type, j.rating, j.serial_no, j.order_id
     FROM warranties w JOIN jobs j ON w.job_id=j.id WHERE w.id=?`, [req.params.id]);
  if (!warranty) { req.flash('error', 'Warranty record not found.'); return res.redirect('/warranty'); }
  const [claims] = await pool.query(
    `SELECT wc.*, u.name AS raised_by_name, a.name AS assigned_to_name
     FROM warranty_claims wc LEFT JOIN users u ON wc.raised_by=u.id LEFT JOIN users a ON wc.assigned_to=a.id
     WHERE wc.warranty_id=? ORDER BY wc.created_at DESC`, [req.params.id]);
  res.render('warranty/view', { title: `Warranty - ${warranty.job_no}`, warranty, claims });
});

// ---------------- NEW CLAIM ----------------
router.get('/warranty/:id/claims/new', requireAuth, requireModule('warranty', 'create'), async (req, res) => {
  const [[warranty]] = await pool.query(
    `SELECT w.*, j.job_no, j.customer_name FROM warranties w JOIN jobs j ON w.job_id=j.id WHERE w.id=?`, [req.params.id]);
  if (!warranty) { req.flash('error', 'Warranty record not found.'); return res.redirect('/warranty'); }
  res.render('warranty/claim-new', { title: `New Claim - ${warranty.job_no}`, warranty });
});

router.post('/warranty/:id/claims', requireAuth, requireModule('warranty', 'create'),
  [body('customer_complaint').trim().notEmpty().withMessage('Please describe the complaint.').isLength({ max: 1000 })],
  validate, async (req, res) => {
  const warrantyId = req.params.id;
  const { customer_complaint, raised_date } = req.body;
  try {
    const [[warranty]] = await pool.query(
      `SELECT w.*, j.job_no FROM warranties w JOIN jobs j ON w.job_id=j.id WHERE w.id=?`, [warrantyId]);
    if (!warranty) { req.flash('error', 'Warranty record not found.'); return res.redirect('/warranty'); }
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM warranty_claims WHERE warranty_id=?', [warrantyId]);
    const claimNo = `${warranty.job_no}-C${cnt + 1}`;
    const [result] = await pool.query(
      `INSERT INTO warranty_claims (warranty_id, claim_no, raised_by, customer_complaint, raised_date)
       VALUES (?,?,?,?,?)`,
      [warrantyId, claimNo, req.session.user.id, customer_complaint, raised_date || new Date().toISOString().slice(0, 10)]
    );
    notifyClaimRaised(result.insertId).catch(err => req.log?.error({ err }, 'warranty claim notify failed'));
    req.flash('success', `Claim ${claimNo} raised.`);
    res.redirect(`/warranty/claims/${result.insertId}`);
  } catch (err) {
    req.log?.error({ err }, 'warranty claim creation failed');
    req.flash('error', 'Could not raise claim.');
    res.redirect(`/warranty/${warrantyId}`);
  }
});

// ---------------- CLAIM DETAIL ----------------
router.get('/warranty/claims/:claimId', requireAuth, requireModule('warranty', 'view'), async (req, res) => {
  const [[claim]] = await pool.query(
    `SELECT wc.*, w.job_id, j.job_no, j.customer_name, u.name AS raised_by_name, a.name AS assigned_to_name
     FROM warranty_claims wc JOIN warranties w ON wc.warranty_id=w.id JOIN jobs j ON w.job_id=j.id
     LEFT JOIN users u ON wc.raised_by=u.id LEFT JOIN users a ON wc.assigned_to=a.id
     WHERE wc.id=?`, [req.params.claimId]);
  if (!claim) { req.flash('error', 'Claim not found.'); return res.redirect('/warranty'); }
  const [parts] = await pool.query('SELECT * FROM warranty_claim_parts WHERE claim_id=? ORDER BY id ASC', [req.params.claimId]);
  const [documents] = await pool.query('SELECT * FROM documents WHERE related_warranty_claim_id=? AND is_active=1 ORDER BY upload_date DESC', [req.params.claimId]);
  const [assignable] = await pool.query('SELECT id, name FROM users WHERE is_active=1 ORDER BY name');
  res.render('warranty/claim-view', { title: `Claim ${claim.claim_no}`, claim, parts, documents, assignable });
});

// ---------------- CLAIM STATUS / ASSIGNMENT UPDATE ----------------
// Open -> Investigating just needs 'edit' (acknowledging/assigning); moving
// to a final decision (Resolved/Rejected) needs 'approve'; Closed (archiving
// after a decision already made) needs only 'edit' again.
router.post('/warranty/claims/:claimId/update', requireAuth, async (req, res) => {
  const claimId = req.params.claimId;
  const { new_status, assigned_to, site_visit_date, resolution_notes } = req.body;
  const decisionStatuses = ['Resolved', 'Rejected'];
  const requiredAction = decisionStatuses.includes(new_status) ? 'approve' : 'edit';
  if (!req.session.user.is_admin && !(req.session.user.permissions.warranty && req.session.user.permissions.warranty[requiredAction])) {
    req.flash('error', 'You do not have permission to perform this action.');
    return res.redirect(`/warranty/claims/${claimId}`);
  }
  try {
    const [[claim]] = await pool.query('SELECT * FROM warranty_claims WHERE id=?', [claimId]);
    if (!claim) { req.flash('error', 'Claim not found.'); return res.redirect('/warranty'); }

    const fields = { assigned_to: assigned_to || null, site_visit_date: site_visit_date || null, resolution_notes: resolution_notes || null };
    if (new_status) fields.status = new_status;
    if (decisionStatuses.includes(new_status)) fields.resolved_date = new Date().toISOString().slice(0, 10);
    if (new_status === 'Closed') fields.closed_date = new Date().toISOString().slice(0, 10);

    const setClause = Object.keys(fields).map(k => `${k}=?`).join(', ');
    await pool.query(`UPDATE warranty_claims SET ${setClause} WHERE id=?`, [...Object.values(fields), claimId]);

    if (decisionStatuses.includes(new_status)) {
      notifyClaimDecision(claimId).catch(err => req.log?.error({ err }, 'warranty decision notify failed'));
    }
    req.flash('success', 'Claim updated.');
  } catch (err) {
    req.log?.error({ err }, 'warranty claim update failed');
    req.flash('error', 'Could not update claim.');
  }
  res.redirect(`/warranty/claims/${claimId}`);
});

// ---------------- CLAIM PARTS USED ----------------
router.post('/warranty/claims/:claimId/parts', requireAuth, requireModule('warranty', 'edit'),
  [body('part_name').trim().notEmpty().withMessage('Part name is required.').isLength({ max: 200 })],
  validate, async (req, res) => {
  const { part_name, quantity, notes } = req.body;
  await pool.query(
    'INSERT INTO warranty_claim_parts (claim_id, part_name, quantity, notes) VALUES (?,?,?,?)',
    [req.params.claimId, part_name, Math.max(1, Number(quantity) || 1), notes || null]
  );
  req.flash('success', 'Part added to claim.');
  res.redirect(`/warranty/claims/${req.params.claimId}`);
});

// ---------------- ATTACH DOCUMENT TO A CLAIM ----------------
// NOTE: file upload for this route runs early in server.js, before CSRF
// validation - see the comment in config/csrf.js (same pattern as the other
// 4 upload routes already there).
router.post('/warranty/claims/:claimId/documents', requireAuth, requireModule('warranty', 'edit'), async (req, res) => {
  const claimId = req.params.claimId;
  try {
    if (!req.file) { req.flash('error', 'Please choose a file to upload.'); return res.redirect(`/warranty/claims/${claimId}`); }
    const [[category]] = await pool.query(`SELECT id FROM document_categories WHERE name='Warranty Claim Records'`);
    const [[claim]] = await pool.query('SELECT claim_no FROM warranty_claims WHERE id=?', [claimId]);
    const docCode = `WCL-${claim.claim_no}-${crypto.randomBytes(3).toString('hex')}`;
    const qrToken = crypto.randomBytes(16).toString('hex');
    await pool.query(
      `INSERT INTO documents (doc_code, doc_name, category_id, confidentiality, related_warranty_claim_id, file_path, qr_token, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [docCode, req.file.originalname || docCode, category ? category.id : null, 'Internal', claimId, `/uploads/${req.file.filename}`, qrToken, req.session.user.id]
    );
    req.flash('success', 'Document attached to claim.');
  } catch (err) {
    req.log?.error({ err }, 'warranty claim document upload failed');
    req.flash('error', 'Could not attach document.');
  }
  res.redirect(`/warranty/claims/${claimId}`);
});

module.exports = router;
