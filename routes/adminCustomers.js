// Admin management of Customer Portal accounts: the customers table (real
// customer entities orders/jobs link to) and customer_users (their portal
// logins) - kept in its own file rather than growing routes/admin.js
// further. Admin-only, same as Admin > Users.
const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const router = express.Router();

const adminOnly = requireRole('Admin');

router.get('/admin/customers', requireAuth, adminOnly, async (req, res) => {
  const [customers] = await pool.query(`
    SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.is_deleted=0) AS order_count
    FROM customers c ORDER BY c.name`);
  const [portalUsers] = await pool.query('SELECT * FROM customer_users ORDER BY name');
  const customersWithUsers = customers.map(c => ({ ...c, users: portalUsers.filter(u => u.customer_id === c.id) }));
  res.render('admin/customers', { title: 'Customer Portal', customers: customersWithUsers });
});

router.post('/admin/customers', requireAuth, adminOnly,
  [body('name').trim().notEmpty().withMessage('Customer name is required.').isLength({ max: 150 })],
  validate, async (req, res) => {
  const { name, contact_email, contact_phone } = req.body;
  try {
    await pool.query('INSERT INTO customers (name, contact_email, contact_phone) VALUES (?,?,?)', [name, contact_email || null, contact_phone || null]);
    req.flash('success', `Customer "${name}" added. Link it to an order from Orders → Edit / GTP, and create a portal login below.`);
  } catch (err) {
    req.log?.error({ err }, 'customer creation failed');
    req.flash('error', 'Could not add customer.');
  }
  res.redirect('/admin/customers');
});

router.post('/admin/customers/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE customers SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'Customer status updated. Disabling a customer blocks all of its portal logins immediately.');
  res.redirect('/admin/customers');
});

router.post('/admin/customers/:id/users', requireAuth, adminOnly, [
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 120 }),
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
], validate, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO customer_users (customer_id, name, email, password_hash) VALUES (?,?,?,?)',
      [req.params.id, name, email, hash]
    );
    req.flash('success', `Portal login created for ${name}.`);
  } catch (err) {
    req.log?.error({ err }, 'customer portal user creation failed');
    req.flash('error', 'Could not create portal login. Email may already be in use.');
  }
  res.redirect('/admin/customers');
});

router.post('/admin/customers/:id/users/:userId/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE customer_users SET is_active = NOT is_active WHERE id=? AND customer_id=?', [req.params.userId, req.params.id]);
  req.flash('success', 'Portal login status updated.');
  res.redirect('/admin/customers');
});

router.post('/admin/customers/:id/users/:userId/reset-password', requireAuth, adminOnly, [
  body('new_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
], validate, async (req, res) => {
  const hash = await bcrypt.hash(req.body.new_password, 10);
  await pool.query('UPDATE customer_users SET password_hash=?, must_change_password=1 WHERE id=? AND customer_id=?', [hash, req.params.userId, req.params.id]);
  req.flash('success', 'Portal login password reset.');
  res.redirect('/admin/customers');
});

module.exports = router;
