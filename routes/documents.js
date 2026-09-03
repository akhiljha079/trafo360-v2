const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const upload = require('../middleware/upload');
const { canSeeDocument } = require('../utils/documentAccess');
const router = express.Router();

const CONFIDENTIALITY_LEVELS = ['Public', 'Internal', 'Confidential', 'Highly Confidential'];
const docFieldRules = [
  body('doc_name').trim().notEmpty().withMessage('Document name is required.').isLength({ max: 200 }),
  body('confidentiality').isIn(CONFIDENTIALITY_LEVELS).withMessage('Invalid confidentiality level.')
];

// LIST / CATALOGUE
router.get('/documents', requireAuth, async (req, res) => {
  const { q, category_id, confidentiality, view } = req.query;
  const showArchived = view === 'archived';
  let sql = `SELECT d.*, c.name AS category_name, j.job_no, j.customer_name
             FROM documents d LEFT JOIN document_categories c ON d.category_id=c.id
             LEFT JOIN jobs j ON d.related_job_id=j.id WHERE d.is_active=?`;
  const params = [showArchived ? 0 : 1];
  if (q) { sql += ' AND (d.doc_code LIKE ? OR d.doc_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (category_id) { sql += ' AND d.category_id=?'; params.push(category_id); }
  if (confidentiality) { sql += ' AND d.confidentiality=?'; params.push(confidentiality); }
  sql += ' ORDER BY d.upload_date DESC';
  const [rows] = await pool.query(sql, params);
  const documents = rows.filter(d => canSeeDocument(req.session.user, d));
  const [categories] = await pool.query('SELECT * FROM document_categories ORDER BY name');
  res.render('documents/list', { title: 'Document Library', documents, categories, filters: { q, category_id, confidentiality }, showArchived });
});

// NEW (form)
router.get('/documents/new', requireAuth, requirePermission('can_manage_documents'), async (req, res) => {
  const [categories] = await pool.query('SELECT * FROM document_categories ORDER BY name');
  const [jobs] = await pool.query('SELECT id, job_no, customer_name FROM jobs WHERE is_deleted=0 ORDER BY created_at DESC LIMIT 200');
  res.render('documents/new', { title: 'Add Document', categories, jobs });
});

// CREATE
router.post('/documents', requireAuth, requirePermission('can_manage_documents'), upload.single('file'),
  [body('doc_code').trim().notEmpty().withMessage('Document Code is required.').isLength({ max: 60 }), ...docFieldRules],
  validate, async (req, res) => {
  const { doc_code, doc_name, category_id, confidentiality, related_job_id, storage_location } = req.body;
  try {
    const filePath = req.file ? `/uploads/${req.file.filename}` : null;
    const qrToken = crypto.randomBytes(16).toString('hex'); // used in the printable QR label for physical-file tracking
    const [result] = await pool.query(
      `INSERT INTO documents (doc_code, doc_name, category_id, confidentiality, related_job_id, storage_location, file_path, qr_token, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [doc_code, doc_name, category_id || null, confidentiality, related_job_id || null, storage_location || null, filePath, qrToken, req.session.user.id]
    );
    req.flash('success', `Document ${doc_code} added to the library.`);
    res.redirect(`/documents/${result.insertId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not add document. Document Code may already exist.');
    res.redirect('/documents/new');
  }
});

// EDIT (form)
router.get('/documents/:id/edit', requireAuth, requirePermission('can_manage_documents'), async (req, res) => {
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!doc) { req.flash('error', 'Document not found.'); return res.redirect('/documents'); }
  const [categories] = await pool.query('SELECT * FROM document_categories ORDER BY name');
  const [jobs] = await pool.query('SELECT id, job_no, customer_name FROM jobs WHERE is_deleted=0 ORDER BY created_at DESC LIMIT 200');
  res.render('documents/edit', { title: `Edit ${doc.doc_code}`, doc, categories, jobs });
});

// UPDATE metadata (and optionally replace the uploaded file)
router.post('/documents/:id/edit', requireAuth, requirePermission('can_manage_documents'), upload.single('file'), docFieldRules, validate, async (req, res) => {
  const { doc_name, category_id, confidentiality, related_job_id, storage_location } = req.body;
  try {
    if (req.file) {
      await pool.query(
        `UPDATE documents SET doc_name=?, category_id=?, confidentiality=?, related_job_id=?, storage_location=?, file_path=? WHERE id=?`,
        [doc_name, category_id || null, confidentiality, related_job_id || null, storage_location || null, `/uploads/${req.file.filename}`, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE documents SET doc_name=?, category_id=?, confidentiality=?, related_job_id=?, storage_location=? WHERE id=?`,
        [doc_name, category_id || null, confidentiality, related_job_id || null, storage_location || null, req.params.id]
      );
    }
    req.flash('success', 'Document updated.');
    res.redirect(`/documents/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update document.');
    res.redirect(`/documents/${req.params.id}/edit`);
  }
});

// ARCHIVE (soft delete - default "Delete" action; reversible, keeps QA/audit trail intact)
router.post('/documents/:id/archive', requireAuth, requirePermission('can_manage_documents'), async (req, res) => {
  await pool.query(`UPDATE documents SET is_active=0, current_status='Archived' WHERE id=?`, [req.params.id]);
  req.flash('success', 'Document archived. It can be restored any time from the Archived view.');
  res.redirect('/documents');
});

// RESTORE from archive
router.post('/documents/:id/restore', requireAuth, requirePermission('can_manage_documents'), async (req, res) => {
  await pool.query(`UPDATE documents SET is_active=1, current_status='Available' WHERE id=?`, [req.params.id]);
  req.flash('success', 'Document restored.');
  res.redirect('/documents?view=archived');
});

// PERMANENT DELETE (Admin only - removes the DB row and file entirely; cannot be undone)
router.post('/documents/:id/delete', requireAuth, requirePermission('is_admin'), async (req, res) => {
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (doc && doc.file_path) {
    const abs = path.join(__dirname, '..', doc.file_path.replace('/uploads/', 'uploads/'));
    fs.unlink(abs, () => {}); // best-effort, ignore errors
  }
  await pool.query('DELETE FROM documents WHERE id=?', [req.params.id]);
  req.flash('success', 'Document permanently deleted.');
  res.redirect('/documents');
});

// VIEW
router.get('/documents/:id', requireAuth, async (req, res) => {
  const [[doc]] = await pool.query(
    `SELECT d.*, c.name AS category_name, j.job_no, j.customer_name, u.name AS uploaded_by_name,
            ro.order_no AS related_order_no, rl.lot_name AS related_lot_name, rl.lot_no AS related_lot_no
     FROM documents d LEFT JOIN document_categories c ON d.category_id=c.id
     LEFT JOIN jobs j ON d.related_job_id=j.id LEFT JOIN users u ON d.uploaded_by=u.id
     LEFT JOIN orders ro ON d.related_order_id=ro.id LEFT JOIN lots rl ON d.related_lot_id=rl.id
     WHERE d.id=?`, [req.params.id]);
  if (!doc) { req.flash('error', 'Document not found.'); return res.redirect('/documents'); }
  if (!canSeeDocument(req.session.user, doc)) {
    req.flash('error', 'This document is confidential; you do not have access.');
    return res.redirect('/documents');
  }
  const [issueHistory] = await pool.query(
    `SELECT di.*, u.name AS requester_name FROM document_issues di JOIN users u ON di.requested_by=u.id
     WHERE di.document_id=? ORDER BY di.created_at DESC`, [req.params.id]);
  res.render('documents/view', { title: doc.doc_code, doc, issueHistory });
});

// DOWNLOAD (authenticated & confidentiality-checked - never served as a static file)
router.get('/documents/:id/download', requireAuth, async (req, res) => {
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!doc || !doc.file_path) { req.flash('error', 'File not found.'); return res.redirect('/documents'); }
  if (!canSeeDocument(req.session.user, doc)) {
    req.flash('error', 'This document is confidential; you do not have access.');
    return res.redirect('/documents');
  }
  const abs = path.join(__dirname, '..', doc.file_path.replace('/uploads/', 'uploads/'));
  if (!fs.existsSync(abs)) { req.flash('error', 'File missing on server.'); return res.redirect(`/documents/${doc.id}`); }
  res.download(abs, `${doc.doc_code}${path.extname(abs)}`);
});

// ---------------- QR-CODE PHYSICAL FILE TRACKING ----------------

// QR image (PNG) - encodes a link to the /scan/:token landing route
router.get('/documents/:id/qrcode.png', requireAuth, async (req, res) => {
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!doc || !doc.qr_token) return res.status(404).end();
  const appUrl = (process.env.APP_URL || `http://${req.headers.host}`).replace(/\/$/, '');
  const scanUrl = `${appUrl}/scan/${doc.qr_token}`;
  try {
    const buffer = await QRCode.toBuffer(scanUrl, { width: 300, margin: 1, color: { dark: '#1F4E78', light: '#FFFFFF' } });
    res.type('png').send(buffer);
  } catch (err) {
    console.error('QR generation failed:', err.message);
    res.status(500).end();
  }
});

// Printable QR label - designed to print onto a sticky label and attach to the physical file/folder
router.get('/documents/:id/label', requireAuth, async (req, res) => {
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!doc) { req.flash('error', 'Document not found.'); return res.redirect('/documents'); }
  if (!canSeeDocument(req.session.user, doc)) {
    req.flash('error', 'This document is confidential; you do not have access.');
    return res.redirect('/documents');
  }
  res.render('documents/label', { title: `QR Label - ${doc.doc_code}`, doc, layout: false });
});

// Regenerate QR token (e.g. if a label was compromised/lost) - Documents Coordinator only
router.post('/documents/:id/qrcode/regenerate', requireAuth, requirePermission('can_manage_documents'), async (req, res) => {
  const newToken = crypto.randomBytes(16).toString('hex');
  await pool.query('UPDATE documents SET qr_token=? WHERE id=?', [newToken, req.params.id]);
  req.flash('success', 'QR code regenerated. Reprint and replace the physical label.');
  res.redirect(`/documents/${req.params.id}`);
});

// Scan landing route - what a phone camera opens when it scans a document's QR label.
// Not prefixed with /documents so the printed URL stays short and simple.
router.get('/scan/:token', requireAuth, async (req, res) => {
  const [[doc]] = await pool.query('SELECT id FROM documents WHERE qr_token=?', [req.params.token]);
  if (!doc) {
    req.flash('error', 'This QR code does not match any document in the system.');
    return res.redirect('/documents');
  }
  res.redirect(`/documents/${doc.id}`);
});

module.exports = router;

