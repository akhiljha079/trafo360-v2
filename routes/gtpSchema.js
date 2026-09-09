// Admin management of the GTP (General Technical Particulars) schema:
// transformer types, field groups, and fields - all front-end editable,
// replacing what used to be a hardcoded constant (utils/gtpFields.js).
const express = require('express');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const router = express.Router();

const adminOnly = requireRole('Admin');
const FIELD_TYPES = ['text', 'textarea', 'number', 'select'];

// ---------------- OVERVIEW ----------------
router.get('/admin/gtp-schema', requireAuth, adminOnly, async (req, res) => {
  const [transformerTypes] = await pool.query('SELECT * FROM transformer_types ORDER BY sequence_order ASC, name ASC');
  const [groups] = await pool.query(
    `SELECT g.*, t.name AS transformer_type_name FROM gtp_field_groups g
     LEFT JOIN transformer_types t ON g.transformer_type_id = t.id
     ORDER BY g.sequence_order ASC, g.id ASC`
  );
  const [fields] = await pool.query('SELECT * FROM gtp_fields ORDER BY group_id ASC, sequence_order ASC, id ASC');
  const [stages] = await pool.query('SELECT stage_code, stage_name FROM stages WHERE is_active=1 ORDER BY sequence_order ASC');

  const groupsWithFields = groups.map(g => ({ ...g, fields: fields.filter(f => f.group_id === g.id) }));

  res.render('admin/gtp-schema', { title: 'GTP Schema', transformerTypes, groups: groupsWithFields, stages, FIELD_TYPES });
});

// ---------------- TRANSFORMER TYPES ----------------
router.post('/admin/gtp-schema/types', requireAuth, adminOnly,
  [body('name').trim().notEmpty().withMessage('Type name is required.').isLength({ max: 100 })],
  validate, async (req, res) => {
    const { name, sequence_order, warranty_months } = req.body;
    try {
      await pool.query('INSERT INTO transformer_types (name, sequence_order, warranty_months) VALUES (?,?,?)', [name, sequence_order || 0, warranty_months || 12]);
      req.flash('success', `Transformer type "${name}" added.`);
    } catch (err) {
      req.log?.error({ err }, 'transformer type creation failed');
      req.flash('error', 'Could not add transformer type. It may already exist.');
    }
    res.redirect('/admin/gtp-schema');
  });

router.post('/admin/gtp-schema/types/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE transformer_types SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'Transformer type enabled/disabled.');
  res.redirect('/admin/gtp-schema');
});

// Warranty period for units of this type - feeds utils/warranty.js when a
// job of this type is dispatched (marked Completed).
router.post('/admin/gtp-schema/types/:id/warranty-months', requireAuth, adminOnly,
  [body('warranty_months').isInt({ min: 1, max: 240 }).withMessage('Warranty period must be a number of months (1-240).')],
  validate, async (req, res) => {
    await pool.query('UPDATE transformer_types SET warranty_months=? WHERE id=?', [req.body.warranty_months, req.params.id]);
    req.flash('success', 'Warranty period updated.');
    res.redirect('/admin/gtp-schema');
  });

// ---------------- FIELD GROUPS ----------------
router.post('/admin/gtp-schema/groups', requireAuth, adminOnly,
  [body('name').trim().notEmpty().withMessage('Group name is required.').isLength({ max: 120 })],
  validate, async (req, res) => {
    const { name, transformer_type_id, sequence_order } = req.body;
    await pool.query(
      'INSERT INTO gtp_field_groups (transformer_type_id, name, sequence_order) VALUES (?,?,?)',
      [transformer_type_id || null, name, sequence_order || 0]
    );
    req.flash('success', `Field group "${name}" added.`);
    res.redirect('/admin/gtp-schema');
  });

router.post('/admin/gtp-schema/groups/:id', requireAuth, adminOnly,
  [body('name').trim().notEmpty().withMessage('Group name is required.').isLength({ max: 120 })],
  validate, async (req, res) => {
    const { name, transformer_type_id, sequence_order } = req.body;
    await pool.query(
      'UPDATE gtp_field_groups SET name=?, transformer_type_id=?, sequence_order=? WHERE id=?',
      [name, transformer_type_id || null, sequence_order || 0, req.params.id]
    );
    req.flash('success', 'Field group updated.');
    res.redirect('/admin/gtp-schema');
  });

router.post('/admin/gtp-schema/groups/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE gtp_field_groups SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'Field group enabled/disabled.');
  res.redirect('/admin/gtp-schema');
});

router.post('/admin/gtp-schema/groups/:id/delete', requireAuth, adminOnly, async (req, res) => {
  // Cascades to its fields (see FK ON DELETE CASCADE) - existing orders keep
  // whatever values they already saved in gtp_json, they just stop showing
  // on forms/work-orders/generated documents once the field definition is gone.
  await pool.query('DELETE FROM gtp_field_groups WHERE id=?', [req.params.id]);
  req.flash('success', 'Field group and its fields deleted.');
  res.redirect('/admin/gtp-schema');
});

router.post('/admin/gtp-schema/groups/:id/reorder', requireAuth, adminOnly, async (req, res) => {
  const { direction } = req.body; // 'up' | 'down'
  const [[group]] = await pool.query('SELECT * FROM gtp_field_groups WHERE id=?', [req.params.id]);
  if (group) {
    const [[neighbour]] = await pool.query(
      `SELECT * FROM gtp_field_groups WHERE sequence_order ${direction === 'up' ? '<' : '>'} ?
       ORDER BY sequence_order ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
      [group.sequence_order]
    );
    if (neighbour) {
      await pool.query('UPDATE gtp_field_groups SET sequence_order=? WHERE id=?', [neighbour.sequence_order, group.id]);
      await pool.query('UPDATE gtp_field_groups SET sequence_order=? WHERE id=?', [group.sequence_order, neighbour.id]);
    }
  }
  res.redirect('/admin/gtp-schema');
});

// ---------------- FIELDS ----------------
router.post('/admin/gtp-schema/fields', requireAuth, adminOnly,
  [
    body('group_id').isInt().withMessage('A field group must be selected.'),
    body('field_key').trim().matches(/^[a-z][a-z0-9_]{1,79}$/).withMessage('Field key must be lowercase letters/numbers/underscores, starting with a letter.'),
    body('label').trim().notEmpty().withMessage('Label is required.').isLength({ max: 150 }),
    body('field_type').isIn(FIELD_TYPES).withMessage('Invalid field type.')
  ],
  validate, async (req, res) => {
    const { group_id, field_key, label, unit, field_type, select_options, sequence_order } = req.body;
    const stageCodes = [].concat(req.body.stage_codes || []).filter(Boolean).join(',');
    try {
      await pool.query(
        `INSERT INTO gtp_fields (group_id, field_key, label, unit, field_type, select_options, stage_codes, sequence_order)
         VALUES (?,?,?,?,?,?,?,?)`,
        [group_id, field_key, label, unit || null, field_type, select_options || null, stageCodes || null, sequence_order || 0]
      );
      req.flash('success', `Field "${label}" added.`);
    } catch (err) {
      req.log?.error({ err }, 'gtp field creation failed');
      req.flash('error', 'Could not add field. The field key may already be in use.');
    }
    res.redirect('/admin/gtp-schema');
  });

router.post('/admin/gtp-schema/fields/:id', requireAuth, adminOnly,
  [
    body('label').trim().notEmpty().withMessage('Label is required.').isLength({ max: 150 }),
    body('field_type').isIn(FIELD_TYPES).withMessage('Invalid field type.')
  ],
  validate, async (req, res) => {
    const { label, unit, field_type, select_options, sequence_order } = req.body;
    const stageCodes = [].concat(req.body.stage_codes || []).filter(Boolean).join(',');
    await pool.query(
      `UPDATE gtp_fields SET label=?, unit=?, field_type=?, select_options=?, stage_codes=?, sequence_order=? WHERE id=?`,
      [label, unit || null, field_type, select_options || null, stageCodes || null, sequence_order || 0, req.params.id]
    );
    req.flash('success', 'Field updated.');
    res.redirect('/admin/gtp-schema');
  });

router.post('/admin/gtp-schema/fields/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE gtp_fields SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'Field enabled/disabled.');
  res.redirect('/admin/gtp-schema');
});

router.post('/admin/gtp-schema/fields/:id/delete', requireAuth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM gtp_fields WHERE id=?', [req.params.id]);
  req.flash('success', 'Field deleted.');
  res.redirect('/admin/gtp-schema');
});

router.post('/admin/gtp-schema/fields/:id/reorder', requireAuth, adminOnly, async (req, res) => {
  const { direction } = req.body;
  const [[field]] = await pool.query('SELECT * FROM gtp_fields WHERE id=?', [req.params.id]);
  if (field) {
    const [[neighbour]] = await pool.query(
      `SELECT * FROM gtp_fields WHERE group_id=? AND sequence_order ${direction === 'up' ? '<' : '>'} ?
       ORDER BY sequence_order ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
      [field.group_id, field.sequence_order]
    );
    if (neighbour) {
      await pool.query('UPDATE gtp_fields SET sequence_order=? WHERE id=?', [neighbour.sequence_order, field.id]);
      await pool.query('UPDATE gtp_fields SET sequence_order=? WHERE id=?', [field.sequence_order, neighbour.id]);
    }
  }
  res.redirect('/admin/gtp-schema');
});

module.exports = router;
