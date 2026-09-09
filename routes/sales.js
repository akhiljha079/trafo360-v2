// Sales module landing dashboard - a summary/quick-link view over the
// existing Orders & GTP data (routes/orders.js), scoped to the Sales phase
// of the Sales -> Manufacturing -> Dispatch workflow. Order/lot/job records
// stay unified in the underlying schema; this route does not fork them.
const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/sales', requireAuth, async (req, res) => {
  const [[{ activeOrders }]] = await pool.query(`SELECT COUNT(*) AS activeOrders FROM orders WHERE is_deleted=0 AND status='Active'`);
  const [[{ awaitingLots }]] = await pool.query(`
    SELECT COUNT(*) AS awaitingLots FROM orders o
    WHERE o.is_deleted=0 AND o.status='Active' AND NOT EXISTS (SELECT 1 FROM lots l WHERE l.order_id=o.id)`);
  const [[{ totalUnits }]] = await pool.query(`
    SELECT COUNT(*) AS totalUnits FROM jobs j JOIN orders o ON j.order_id=o.id WHERE j.is_deleted=0 AND o.is_deleted=0`);
  const [ordersByStatus] = await pool.query(`
    SELECT status, COUNT(*) AS cnt FROM orders WHERE is_deleted=0 GROUP BY status`);

  const [recentOrders] = await pool.query(`
    SELECT o.*,
      (SELECT COUNT(*) FROM lots l WHERE l.order_id=o.id) AS lot_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.order_id=o.id AND j.is_deleted=0) AS unit_count
    FROM orders o WHERE o.is_deleted=0 ORDER BY o.created_at DESC LIMIT 10`);

  res.render('sales/dashboard', {
    title: 'Sales Overview',
    activeOrders, awaitingLots, totalUnits, ordersByStatus, recentOrders
  });
});

module.exports = router;
