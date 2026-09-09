// Accounting module: a thin, filtered view over the existing Documents
// infrastructure (upload, storage, confidentiality) scoped to
// category_type='accounting' - invoices, payment receipts, e-way bills, etc.
// Deliberately simple: document collection only, no ledger/tax logic.
// Editing/archiving/downloading an existing accounting document reuses the
// existing /documents/:id/* routes, which are category-aware (see
// requireDocumentModule() in middleware/auth.js) - this file only needs
// list + new + create.
const express = require('express');
const crypto = require('crypto');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireModule } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { canSeeDocument } = require('../utils/documentAccess');
const { processDocumentOcrAsync } = require('../utils/ocr');
const router = express.Router();

const CONFIDENTIALITY_LEVELS = ['Public', 'Internal', 'Confidential', 'Highly Confidential'];

router.get('/accounting', requireAuth, requireModule('accounting', 'view'), async (req, res) => {
  const { q, category_id } = req.query;
  let sql = `SELECT d.*, c.name AS category_name, o.order_no, j.job_no
             FROM documents d JOIN document_categories c ON d.category_id=c.id
             LEFT JOIN orders o ON d.related_order_id=o.id LEFT JOIN jobs j ON d.related_job_id=j.id
             WHERE d.is_active=1 AND c.category_type='accounting'`;
  const params = [];
  if (q) { sql += ' AND (d.doc_code LIKE ? OR d.doc_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (category_id) { sql += ' AND d.category_id=?'; params.push(category_id); }
  sql += ' ORDER BY d.upload_date DESC';
  const [rows] = await pool.query(sql, params);
  const documents = rows.map(d => ({ ...d, category_type: 'accounting' })).filter(d => canSeeDocument(req.session.user, d));
  const [categories] = await pool.query(`SELECT * FROM document_categories WHERE category_type='accounting' ORDER BY name`);
  res.render('accounting/list', { title: 'Accounting Documents', documents, categories, filters: { q, category_id } });
});

router.get('/accounting/new', requireAuth, requireModule('accounting', 'create'), async (req, res) => {
  const [categories] = await pool.query(`SELECT * FROM document_categories WHERE category_type='accounting' ORDER BY name`);
  const [orders] = await pool.query(`SELECT id, order_no, customer_name FROM orders WHERE is_deleted=0 ORDER BY created_at DESC LIMIT 200`);
  const [jobs] = await pool.query(`SELECT id, job_no, customer_name FROM jobs WHERE is_deleted=0 ORDER BY created_at DESC LIMIT 200`);
  res.render('accounting/new', { title: 'Add Accounting Document', categories, orders, jobs });
});

// NOTE: file upload for this route runs early in server.js, before CSRF
// validation - see the comment in config/csrf.js (same pattern as the other
// upload routes already there).
router.post('/accounting', requireAuth, requireModule('accounting', 'create'),
  [
    body('doc_name').trim().notEmpty().withMessage('Document name is required.').isLength({ max: 200 }),
    body('category_id').notEmpty().withMessage('Please choose a category.'),
    body('confidentiality').isIn(CONFIDENTIALITY_LEVELS).withMessage('Invalid confidentiality level.')
  ],
  validate, async (req, res) => {
  const { doc_name, category_id, confidentiality, related_order_id, related_job_id, customer_visible } = req.body;
  try {
    const [[category]] = await pool.query(`SELECT id FROM document_categories WHERE id=? AND category_type='accounting'`, [category_id]);
    if (!category) { req.flash('error', 'Please choose a valid Accounting category.'); return res.redirect('/accounting/new'); }
    const docCode = `ACC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex')}`;
    const filePath = req.file ? `/uploads/${req.file.filename}` : null;
    const qrToken = crypto.randomBytes(16).toString('hex');
    const [result] = await pool.query(
      `INSERT INTO documents (doc_code, doc_name, category_id, confidentiality, related_order_id, related_job_id, customer_visible, file_path, qr_token, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [docCode, doc_name, category_id, confidentiality, related_order_id || null, related_job_id || null, customer_visible ? 1 : 0, filePath, qrToken, req.session.user.id]
    );
    if (req.file) processDocumentOcrAsync(pool, result.insertId, req.file.path);
    req.flash('success', `${doc_name} added to Accounting Documents.`);
    res.redirect(`/documents/${result.insertId}`);
  } catch (err) {
    req.log?.error({ err }, 'accounting document creation failed');
    req.flash('error', 'Could not add document.');
    res.redirect('/accounting/new');
  }
});

module.exports = router;
