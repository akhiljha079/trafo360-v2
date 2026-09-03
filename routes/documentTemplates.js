// Admin management of document_templates - the settings behind the
// technical-document generation engine (numbering prefix, which GTP-tagged
// stages feed each document, intro text, enable/disable). Full branding/
// section customization is a further phase; this covers the practical knobs.
const express = require('express');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { DOCUMENT_TYPES } = require('../utils/documentTypes');
const router = express.Router();

const adminOnly = requireRole('Admin');

router.get('/admin/document-templates', requireAuth, adminOnly, async (req, res) => {
  const [templates] = await pool.query('SELECT * FROM document_templates ORDER BY name ASC');
  const [stages] = await pool.query('SELECT stage_code, stage_name FROM stages WHERE is_active=1 ORDER BY sequence_order ASC');
  res.render('admin/document-templates', { title: 'Document Templates', templates, stages, DOCUMENT_TYPES });
});

router.post('/admin/document-templates/:id', requireAuth, adminOnly,
  [
    body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 150 }),
    body('numbering_prefix').trim().notEmpty().withMessage('Numbering prefix is required.').isLength({ max: 20 })
  ],
  validate, async (req, res) => {
    const { name, numbering_prefix, intro_text } = req.body;
    const stageCodes = [].concat(req.body.source_stage_codes || []).filter(Boolean).join(',');
    await pool.query(
      `UPDATE document_templates SET name=?, numbering_prefix=?, source_stage_codes=?, intro_text=? WHERE id=?`,
      [name, numbering_prefix.toUpperCase(), stageCodes || null, intro_text || null, req.params.id]
    );
    req.flash('success', 'Document template updated.');
    res.redirect('/admin/document-templates');
  });

router.post('/admin/document-templates/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE document_templates SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'Document template enabled/disabled.');
  res.redirect('/admin/document-templates');
});

module.exports = router;
