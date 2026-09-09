// Customer Portal: a restricted, read-mostly view for a customer to track
// their own order/unit progress and download documents an admin has
// explicitly marked Customer Visible - completely separate login/session
// from the internal app (see middleware/customerAuth.js). A customer only
// ever sees rows scoped to their own customer_id; every query below filters
// on it, and every :id route re-verifies ownership before returning anything.
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireCustomerAuth } = require('../middleware/customerAuth');
const { computeRag, computeProgressPct } = require('../utils/jobStatus');
const router = express.Router();

// Portal pages carry their own header (_topbar) and are never wrapped in the
// staff app shell (sidebar/navbar) - even if a staff member happens to also
// have a logged-in session in the same browser while looking at this route.
router.use((req, res, next) => { res.locals.isPortalPage = true; next(); });

router.get('/portal/login', (req, res) => {
  if (req.session.customerUser) return res.redirect('/portal');
  res.render('portal/login', { title: 'Customer Portal Login' });
});

router.post('/portal/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [[cu]] = await pool.query(
      `SELECT cu.*, c.name AS customer_name, c.is_active AS customer_is_active
       FROM customer_users cu JOIN customers c ON cu.customer_id = c.id
       WHERE cu.email=? AND cu.is_active=1`, [email]
    );
    if (!cu || !cu.customer_is_active) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/portal/login');
    }
    const ok = await bcrypt.compare(password, cu.password_hash);
    if (!ok) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/portal/login');
    }
    req.session.customerUser = { id: cu.id, name: cu.name, email: cu.email, customer_id: cu.customer_id, customer_name: cu.customer_name };
    req.flash('success', `Welcome, ${cu.name}.`);
    res.redirect('/portal');
  } catch (err) {
    req.log?.error({ err }, 'portal login failed');
    req.flash('error', 'Login failed due to a server error.');
    res.redirect('/portal/login');
  }
});

router.post('/portal/logout', (req, res) => {
  delete req.session.customerUser;
  res.redirect('/portal/login');
});

// ---------------- DASHBOARD ----------------
router.get('/portal', requireCustomerAuth, async (req, res) => {
  const customerId = req.session.customerUser.customer_id;
  const [orders] = await pool.query(`
    SELECT o.*,
      (SELECT COUNT(*) FROM jobs j WHERE j.order_id=o.id AND j.is_deleted=0) AS unit_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.order_id=o.id AND j.is_deleted=0 AND j.status='Completed') AS completed_units
    FROM orders o WHERE o.customer_id=? AND o.is_deleted=0 ORDER BY o.created_at DESC`, [customerId]);
  res.render('portal/dashboard', { title: 'My Orders', orders });
});

// ---------------- ORDER DETAIL ----------------
router.get('/portal/orders/:id', requireCustomerAuth, async (req, res) => {
  const customerId = req.session.customerUser.customer_id;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id=? AND customer_id=? AND is_deleted=0', [req.params.id, customerId]);
  if (!order) { req.flash('error', 'Order not found.'); return res.redirect('/portal'); }

  const [[{ totalStages }]] = await pool.query(`SELECT COUNT(*) AS totalStages FROM stages WHERE is_active=1`);
  const [unitsRaw] = await pool.query(`
    SELECT j.*, s.stage_name, s.phase, s.sequence_order, l.lot_name
    FROM jobs j LEFT JOIN stages s ON j.current_stage_id=s.id LEFT JOIN lots l ON j.lot_id=l.id
    WHERE j.order_id=? AND j.is_deleted=0 ORDER BY j.unit_no ASC`, [req.params.id]);
  const units = unitsRaw.map(j => ({ ...j, progressPct: computeProgressPct(j.sequence_order, totalStages), rag: computeRag(j).rag }));

  // Confidentiality still applies even for a customer-visible document -
  // Confidential/Highly Confidential is an internal-restriction concept and
  // is never exposed externally, even if also (mistakenly) flagged
  // Customer Visible. Defense in depth alongside the ownership check above.
  const [documents] = await pool.query(`
    SELECT d.*, c.name AS category_name FROM documents d LEFT JOIN document_categories c ON d.category_id=c.id
    WHERE d.is_active=1 AND d.customer_visible=1 AND d.confidentiality IN ('Public','Internal') AND (
      d.related_order_id=? OR
      d.related_lot_id IN (SELECT id FROM lots WHERE order_id=?) OR
      d.related_job_id IN (SELECT id FROM jobs WHERE order_id=?)
    ) ORDER BY d.upload_date DESC`, [req.params.id, req.params.id, req.params.id]);

  res.render('portal/order-view', { title: order.order_no, order, units, documents });
});

// ---------------- DOCUMENT DOWNLOAD (ownership + customer_visible checked) ----------------
router.get('/portal/documents/:id/download', requireCustomerAuth, async (req, res) => {
  const customerId = req.session.customerUser.customer_id;
  const [[doc]] = await pool.query(`
    SELECT d.* FROM documents d
    LEFT JOIN orders o ON d.related_order_id=o.id
    LEFT JOIN lots l ON d.related_lot_id=l.id LEFT JOIN orders lo ON l.order_id=lo.id
    LEFT JOIN jobs j ON d.related_job_id=j.id LEFT JOIN orders jo ON j.order_id=jo.id
    WHERE d.id=? AND d.is_active=1 AND d.customer_visible=1 AND d.confidentiality IN ('Public','Internal')
      AND (o.customer_id=? OR lo.customer_id=? OR jo.customer_id=?)`,
    [req.params.id, customerId, customerId, customerId]);
  if (!doc || !doc.file_path) { req.flash('error', 'File not found.'); return res.redirect('/portal'); }
  const abs = path.join(__dirname, '..', doc.file_path.replace('/uploads/', 'uploads/'));
  if (!fs.existsSync(abs)) { req.flash('error', 'File missing on server.'); return res.redirect('/portal'); }
  res.download(abs, `${doc.doc_code}${path.extname(abs)}`);
});

module.exports = router;
