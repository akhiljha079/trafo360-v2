const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { loadPermissions } = require('../middleware/auth');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login', next: req.query.next || '' });
});

router.post('/login', async (req, res) => {
  const { email, password, next: nextUrl } = req.body;
  try {
    const [[user]] = await pool.query(
      `SELECT u.*, r.name AS role_name, r.is_admin, r.is_director, r.can_view_confidential,
              r.can_approve_document_issue, r.can_manage_documents, r.can_manage_jobs
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.email=? AND u.is_active=1`,
      [email]
    );
    if (!user) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    const permissions = await loadPermissions(user.role_id);
    req.session.user = {
      id: user.id, name: user.name, email: user.email, role_id: user.role_id,
      role_name: user.role_name, is_admin: !!user.is_admin, is_director: !!user.is_director,
      can_view_confidential: !!user.can_view_confidential,
      can_approve_document_issue: !!user.can_approve_document_issue,
      can_manage_documents: !!user.can_manage_documents,
      can_manage_jobs: !!user.can_manage_jobs,
      permissions
    };
    req.flash('success', `Welcome back, ${user.name}.`);
    // Honor a safe "next" destination (e.g. from a QR-code scan link) - only allow relative paths
    if (nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//')) {
      return res.redirect(nextUrl);
    }
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login failed due to a server error.');
    res.redirect('/login');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
