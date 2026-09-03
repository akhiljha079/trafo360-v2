const express = require('express');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { notifyStageEvent } = require('../utils/notify');
const { getSchema, getActiveTransformerTypes, fieldsForStage } = require('../utils/gtpSchema');
const { DOCUMENT_TYPES } = require('../utils/documentTypes');
const { generateDocument } = require('../utils/documentGenerator');
const router = express.Router();

const orderFieldRules = [
  body('customer_name').trim().notEmpty().withMessage('Customer name is required.').isLength({ max: 150 }),
  body('transformer_type').trim().notEmpty().withMessage('Transformer type is required.'),
  body('total_quantity').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Total quantity must be a positive number.')
];
const lotFieldRules = [
  body('lot_no').isInt({ min: 1 }).withMessage('Lot No. must be a positive number.'),
  body('quantity').isInt({ min: 1, max: 1000 }).withMessage('Quantity must be between 1 and 1000 units.')
];

function parseGtp(body, schema) {
  const gtp = {};
  schema.forEach(g => g.fields.forEach(f => {
    if (body[`gtp_${f.key}`] !== undefined) gtp[f.key] = body[`gtp_${f.key}`];
  }));
  return gtp;
}

// ---------------- ORDERS LIST ----------------
router.get('/orders', requireAuth, async (req, res) => {
  const [orders] = await pool.query(`
    SELECT o.*,
      (SELECT COUNT(*) FROM lots l WHERE l.order_id=o.id) AS lot_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.order_id=o.id AND j.is_deleted=0) AS unit_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.order_id=o.id AND j.is_deleted=0 AND j.status='Completed') AS completed_units
    FROM orders o WHERE o.is_deleted=0 ORDER BY o.created_at DESC`);
  res.render('orders/list', { title: 'Orders', orders });
});

// ---------------- NEW ORDER (with GTP form) ----------------
router.get('/orders/new', requireAuth, requirePermission('can_manage_jobs'), async (req, res) => {
  const transformerTypes = await getActiveTransformerTypes();
  const selectedType = req.query.transformer_type || (transformerTypes[0] && transformerTypes[0].name) || '';
  const gtpGroups = await getSchema(selectedType);
  res.render('orders/form', { title: 'New Order', order: null, transformerTypes, selectedType, gtpGroups, gtpData: {} });
});

router.post('/orders', requireAuth, requirePermission('can_manage_jobs'),
  [body('order_no').trim().notEmpty().withMessage('Order No. is required.').isLength({ max: 60 }), ...orderFieldRules],
  validate, async (req, res) => {
  const { order_no, customer_name, po_no, transformer_type, rating, total_quantity } = req.body;
  try {
    const schema = await getSchema(transformer_type);
    const gtp = parseGtp(req.body, schema);
    const [result] = await pool.query(
      `INSERT INTO orders (order_no, customer_name, po_no, transformer_type, rating, total_quantity, gtp_json, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [order_no, customer_name, po_no || null, transformer_type, rating || null, total_quantity || 1, JSON.stringify(gtp), req.session.user.id]
    );
    req.flash('success', `Order ${order_no} created. Now add lots to start manufacturing units.`);
    res.redirect(`/orders/${result.insertId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not create order. Order No. may already exist.');
    res.redirect('/orders/new');
  }
});

// ---------------- EDIT ORDER (with GTP form) ----------------
router.get('/orders/:id/edit', requireAuth, requirePermission('can_manage_jobs'), async (req, res) => {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!order) { req.flash('error', 'Order not found.'); return res.redirect('/orders'); }
  let gtpData = {};
  try { gtpData = JSON.parse(order.gtp_json || '{}'); } catch (e) { /* ignore malformed */ }
  const transformerTypes = await getActiveTransformerTypes();
  const selectedType = req.query.transformer_type || order.transformer_type;
  const gtpGroups = await getSchema(selectedType);
  res.render('orders/form', { title: `Edit ${order.order_no}`, order, transformerTypes, selectedType, gtpGroups, gtpData });
});

router.post('/orders/:id/edit', requireAuth, requirePermission('can_manage_jobs'), orderFieldRules, validate, async (req, res) => {
  const { customer_name, po_no, transformer_type, rating, total_quantity } = req.body;
  try {
    const schema = await getSchema(transformer_type);
    const gtp = parseGtp(req.body, schema);
    await pool.query(
      `UPDATE orders SET customer_name=?, po_no=?, transformer_type=?, rating=?, total_quantity=?, gtp_json=? WHERE id=?`,
      [customer_name, po_no || null, transformer_type, rating || null, total_quantity || 1, JSON.stringify(gtp), req.params.id]
    );
    req.flash('success', 'Order and GTP parameters updated.');
    res.redirect(`/orders/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update order.');
    res.redirect(`/orders/${req.params.id}/edit`);
  }
});

// ---------------- DELETE (soft) ORDER ----------------
router.post('/orders/:id/delete', requireAuth, requirePermission('can_manage_jobs'), async (req, res) => {
  await pool.query('UPDATE orders SET is_deleted=1 WHERE id=?', [req.params.id]);
  req.flash('success', 'Order deleted (archived - underlying units and history are preserved for audit purposes).');
  res.redirect('/orders');
});

router.post('/orders/:id/status', requireAuth, requirePermission('can_manage_jobs'), async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
  req.flash('success', `Order status set to ${status}.`);
  res.redirect(`/orders/${req.params.id}`);
});

// ---------------- ORDER DETAIL (GTP summary + lots) ----------------
router.get('/orders/:id', requireAuth, async (req, res) => {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!order) { req.flash('error', 'Order not found.'); return res.redirect('/orders'); }
  let gtpData = {};
  try { gtpData = JSON.parse(order.gtp_json || '{}'); } catch (e) { /* ignore */ }
  const gtpGroups = await getSchema(order.transformer_type);

  const [lots] = await pool.query(`
    SELECT l.*,
      (SELECT COUNT(*) FROM jobs j WHERE j.lot_id=l.id AND j.is_deleted=0) AS unit_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.lot_id=l.id AND j.is_deleted=0 AND j.status='Completed') AS completed_units
    FROM lots l WHERE l.order_id=? ORDER BY l.lot_no ASC`, [req.params.id]);

  const nextLotNo = lots.length ? Math.max(...lots.map(l => l.lot_no)) + 1 : 1;
  const allocatedQty = lots.reduce((sum, l) => sum + l.quantity, 0);

  // Manufacturing-phase stages, for the "generate work order" quick links
  const [mfgStages] = await pool.query(`SELECT * FROM stages WHERE phase='Manufacturing' AND is_active=1 ORDER BY sequence_order ASC`);

  const [documents] = await pool.query(
    `SELECT * FROM documents WHERE related_order_id=? AND is_active=1 ORDER BY upload_date DESC`, [req.params.id]
  );

  const [genDocTypes] = await pool.query(
    `SELECT doc_type, name FROM document_templates WHERE is_active=1 AND doc_type IN (?) ORDER BY name`,
    [Object.keys(DOCUMENT_TYPES).filter(k => DOCUMENT_TYPES[k].scope === 'order')]
  );

  res.render('orders/view', { title: order.order_no, order, gtpData, gtpGroups, lots, nextLotNo, allocatedQty, mfgStages, documents, genDocTypes });
});

// GENERATE an order-level technical document (QAP, Technical Offer, BOM, MTC Index)
router.post('/orders/:id/generate-document', requireAuth, requirePermission('can_manage_jobs'), async (req, res) => {
  const { doc_type } = req.body;
  const orderId = req.params.id;
  try {
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id=? AND is_deleted=0', [orderId]);
    if (!order) { req.flash('error', 'Order not found.'); return res.redirect('/orders'); }
    const documentId = await generateDocument(doc_type, { order }, req.session.user.id);
    req.flash('success', 'Document generated and added to the Document Library.');
    res.redirect(`/documents/${documentId}`);
  } catch (err) {
    req.log?.error({ err }, 'document generation failed');
    req.flash('error', `Could not generate document: ${err.message}`);
    res.redirect(`/orders/${orderId}`);
  }
});

// ---------------- ADD LOT (auto-creates the unit/job records) ----------------
router.post('/orders/:id/lots', requireAuth, requirePermission('can_manage_jobs'), lotFieldRules, validate, async (req, res) => {
  const orderId = req.params.id;
  const { lot_no, lot_name, quantity, planned_start_date, planned_completion_date } = req.body;
  const qty = Math.max(1, Number(quantity) || 1);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id=?', [orderId]);
    if (!order) throw new Error('Order not found');

    // Units start manufacturing at the first MANUFACTURING-phase stage, not
    // the first stage overall - by the time an order has lots, Sales/GTP
    // approval has already happened once at the order level.
    const [[firstStage]] = await conn.query(
      `SELECT * FROM stages WHERE is_active=1 AND phase='Manufacturing' ORDER BY sequence_order ASC LIMIT 1`
    );
    const [[fallbackStage]] = await conn.query('SELECT * FROM stages WHERE is_active=1 ORDER BY sequence_order ASC LIMIT 1');
    const startStage = firstStage || fallbackStage;

    const [lotResult] = await conn.query(
      `INSERT INTO lots (order_id, lot_no, lot_name, quantity, planned_start_date, planned_completion_date)
       VALUES (?,?,?,?,?,?)`,
      [orderId, lot_no, lot_name || `Lot ${lot_no}`, qty, planned_start_date || null, planned_completion_date || null]
    );
    const lotId = lotResult.insertId;

    for (let i = 1; i <= qty; i++) {
      const unitNo = i;
      const jobNo = `${order.order_no}-L${lot_no}-U${String(unitNo).padStart(2, '0')}`;
      const [jobResult] = await conn.query(
        `INSERT INTO jobs (order_id, lot_id, unit_no, job_no, po_no, customer_name, transformer_type, rating, current_stage_id, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [orderId, lotId, unitNo, jobNo, order.po_no, order.customer_name, order.transformer_type, order.rating,
         startStage ? startStage.id : null, req.session.user.id]
      );
      if (startStage) {
        await conn.query(
          `INSERT INTO job_stage_history (job_id, stage_id, event, updated_by) VALUES (?,?, 'Started', ?)`,
          [jobResult.insertId, startStage.id, req.session.user.id]
        );
      }
    }

    await conn.commit();
    req.flash('success', `Lot ${lot_no} created with ${qty} unit(s).`);
    res.redirect(`/orders/${orderId}/lots/${lotId}`);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Could not create lot: ' + err.message);
    res.redirect(`/orders/${orderId}`);
  } finally {
    conn.release();
  }
});

router.post('/orders/:id/lots/:lotId/status', requireAuth, requirePermission('can_manage_jobs'), async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE lots SET status=? WHERE id=?', [status, req.params.lotId]);
  req.flash('success', `Lot status set to ${status}.`);
  res.redirect(`/orders/${req.params.id}/lots/${req.params.lotId}`);
});

// ---------------- LOT PROGRESS MATRIX (the "how many tanks/painted/etc" view) ----------------
router.get('/orders/:id/lots/:lotId', requireAuth, async (req, res) => {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id=?', [req.params.id]);
  const [[lot]] = await pool.query('SELECT * FROM lots WHERE id=?', [req.params.lotId]);
  if (!order || !lot) { req.flash('error', 'Lot not found.'); return res.redirect('/orders'); }

  const [units] = await pool.query(`
    SELECT j.*, s.stage_code, s.stage_name, s.phase
    FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id
    WHERE j.lot_id=? AND j.is_deleted=0 ORDER BY j.unit_no ASC`, [req.params.lotId]);

  const [allStages] = await pool.query('SELECT * FROM stages WHERE is_active=1 ORDER BY sequence_order ASC');

  // For each stage, count how many units in this lot have COMPLETED it, and
  // how many are currently sitting IN it right now.
  const [completedCounts] = await pool.query(`
    SELECT h.stage_id, COUNT(DISTINCT h.job_id) AS cnt
    FROM job_stage_history h JOIN jobs j ON h.job_id = j.id
    WHERE j.lot_id=? AND j.is_deleted=0 AND h.event='Completed'
    GROUP BY h.stage_id`, [req.params.lotId]);
  const completedMap = {};
  completedCounts.forEach(r => { completedMap[r.stage_id] = r.cnt; });

  const currentMap = {};
  units.forEach(u => { if (u.current_stage_id) currentMap[u.current_stage_id] = (currentMap[u.current_stage_id] || 0) + 1; });

  const matrix = allStages.map(s => ({
    stage: s,
    completed: completedMap[s.id] || 0,
    inProgress: currentMap[s.id] || 0,
    total: units.length,
    pct: units.length ? Math.round(((completedMap[s.id] || 0) / units.length) * 100) : 0
  }));

  const [genDocTypes] = await pool.query(
    `SELECT doc_type, name FROM document_templates WHERE is_active=1 AND doc_type IN (?) ORDER BY name`,
    [Object.keys(DOCUMENT_TYPES).filter(k => DOCUMENT_TYPES[k].scope === 'lot')]
  );

  res.render('orders/lot-view', { title: `${order.order_no} - ${lot.lot_name}`, order, lot, units, matrix, genDocTypes });
});

// GENERATE a lot-level technical document (Packing List)
router.post('/orders/:id/lots/:lotId/generate-document', requireAuth, requirePermission('can_manage_jobs'), async (req, res) => {
  const { doc_type } = req.body;
  const { id: orderId, lotId } = req.params;
  try {
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id=? AND is_deleted=0', [orderId]);
    const [[lot]] = await pool.query('SELECT * FROM lots WHERE id=? AND order_id=?', [lotId, orderId]);
    if (!order || !lot) { req.flash('error', 'Lot not found.'); return res.redirect('/orders'); }
    const documentId = await generateDocument(doc_type, { order, lot }, req.session.user.id);
    req.flash('success', 'Document generated and added to the Document Library.');
    res.redirect(`/documents/${documentId}`);
  } catch (err) {
    req.log?.error({ err }, 'document generation failed');
    req.flash('error', `Could not generate document: ${err.message}`);
    res.redirect(`/orders/${orderId}/lots/${lotId}`);
  }
});

// ---------------- SYSTEM-GENERATED DEPARTMENT WORK ORDER (printable) ----------------
router.get('/orders/:id/work-order/:stageCode', requireAuth, async (req, res) => {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!order) { req.flash('error', 'Order not found.'); return res.redirect('/orders'); }
  const [[stage]] = await pool.query('SELECT * FROM stages WHERE stage_code=?', [req.params.stageCode]);
  if (!stage) { req.flash('error', 'Stage not found.'); return res.redirect(`/orders/${order.id}`); }

  let gtpData = {};
  try { gtpData = JSON.parse(order.gtp_json || '{}'); } catch (e) { /* ignore */ }
  const schema = await getSchema(order.transformer_type);
  const fields = fieldsForStage(req.params.stageCode, gtpData, schema);

  const lotId = req.query.lot_id || null;
  let lot = null, units = [];
  if (lotId) {
    [[lot]] = await pool.query('SELECT * FROM lots WHERE id=?', [lotId]);
    [units] = await pool.query('SELECT job_no, unit_no, serial_no FROM jobs WHERE lot_id=? AND is_deleted=0 ORDER BY unit_no ASC', [lotId]);
  }

  res.render('orders/work-order', { title: `Work Order - ${stage.stage_name}`, order, stage, fields, lot, units, layout: false });
});

module.exports = router;
