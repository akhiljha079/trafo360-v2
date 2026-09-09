const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { sendMail } = require('../config/mailer');
const whatsapp = require('../utils/whatsapp');
const router = express.Router();

const adminOnly = requireRole('Admin');

// ---------------- USERS ----------------
router.get('/admin/users', requireAuth, adminOnly, async (req, res) => {
  const [users] = await pool.query(`SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON u.role_id=r.id ORDER BY u.name`);
  const [roles] = await pool.query('SELECT * FROM roles ORDER BY name');
  res.render('admin/users', { title: 'Manage Users', users, roles });
});

router.post('/admin/users', requireAuth, adminOnly, [
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 120 }),
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  body('role_id').isInt().withMessage('A role must be selected.')
], validate, async (req, res) => {
  const { name, email, password, role_id, department, phone, whatsapp_number } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id, department, phone, whatsapp_number) VALUES (?,?,?,?,?,?,?)`,
      [name, email, hash, role_id, department || null, phone || null, whatsapp_number || null]
    );
    req.flash('success', `User ${name} created.`);
  } catch (err) {
    req.log?.error({ err }, 'user creation failed');
    req.flash('error', 'Could not create user. Email may already be in use.');
  }
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE users SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'User status updated.');
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/role', requireAuth, adminOnly, [
  body('role_id').isInt().withMessage('A role must be selected.')
], validate, async (req, res) => {
  const { role_id } = req.body;
  await pool.query('UPDATE users SET role_id=? WHERE id=?', [role_id, req.params.id]);
  req.flash('success', 'User role updated.');
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/reset-password', requireAuth, adminOnly, [
  body('new_password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
], validate, async (req, res) => {
  const { new_password } = req.body;
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?', [hash, req.params.id]);
  req.flash('success', 'Password reset.');
  res.redirect('/admin/users');
});

// ---------------- ROLES / PRIVILEGES ----------------
// Per-module (Sales/Manufacturing/Dispatch/Documents/Warranty/Accounting/
// Reports) View/Create/Edit/Delete/Approve grid, plus the 3 cross-cutting
// flags (Admin, Director, View Confidential) that were never module-scoped
// to begin with. See middleware/auth.js requireModule() / db/schema.sql.
router.get('/admin/roles', requireAuth, adminOnly, async (req, res) => {
  const [roles] = await pool.query('SELECT * FROM roles ORDER BY name');
  const [modules] = await pool.query('SELECT * FROM modules WHERE is_active=1 ORDER BY sequence_order ASC');
  const [permRows] = await pool.query('SELECT * FROM role_permissions');
  const permMap = {};
  permRows.forEach(p => {
    permMap[p.role_id] = permMap[p.role_id] || {};
    permMap[p.role_id][p.module_id] = p;
  });
  res.render('admin/roles', { title: 'Manage Roles & Privileges', roles, modules, permMap });
});

router.post('/admin/roles', requireAuth, adminOnly, async (req, res) => {
  const { name, description } = req.body;
  try {
    await pool.query('INSERT INTO roles (name, description) VALUES (?,?)', [name, description || null]);
    req.flash('success', `Role "${name}" created. Set its module permissions below, then have anyone with this role log out and back in for the change to take effect.`);
  } catch (err) {
    req.flash('error', 'Could not create role (name may already exist).');
  }
  res.redirect('/admin/roles');
});

router.post('/admin/roles/:id', requireAuth, adminOnly, async (req, res) => {
  const roleId = req.params.id;
  const { is_admin, is_director, can_view_confidential, perm } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE roles SET is_admin=?, is_director=?, can_view_confidential=? WHERE id=?`,
      [is_admin ? 1 : 0, is_director ? 1 : 0, can_view_confidential ? 1 : 0, roleId]
    );
    const [modules] = await conn.query('SELECT id FROM modules WHERE is_active=1');
    for (const m of modules) {
      const p = (perm && perm[m.id]) || {};
      await conn.query(
        `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete, can_approve)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE can_view=VALUES(can_view), can_create=VALUES(can_create), can_edit=VALUES(can_edit), can_delete=VALUES(can_delete), can_approve=VALUES(can_approve)`,
        [roleId, m.id, p.view ? 1 : 0, p.create ? 1 : 0, p.edit ? 1 : 0, p.delete ? 1 : 0, p.approve ? 1 : 0]
      );
    }
    await conn.commit();
    req.flash('success', 'Role privileges updated. Anyone with this role needs to log out and back in for the change to take effect.');
  } catch (err) {
    await conn.rollback();
    req.log?.error({ err }, 'role permission update failed');
    req.flash('error', 'Could not update role privileges.');
  } finally {
    conn.release();
  }
  res.redirect('/admin/roles');
});

// ---------------- WORKFLOW STAGES (fully customizable) ----------------
router.get('/admin/stages', requireAuth, adminOnly, async (req, res) => {
  const [stages] = await pool.query('SELECT * FROM stages ORDER BY sequence_order ASC');
  const [roles] = await pool.query('SELECT * FROM roles ORDER BY name');
  res.render('admin/stages', { title: 'Manage Workflow Stages', stages, roles });
});

router.post('/admin/stages', requireAuth, adminOnly, async (req, res) => {
  const { stage_code, stage_name, phase, sequence_order, owner_role_id, description } = req.body;
  try {
    await pool.query(
      `INSERT INTO stages (stage_code, stage_name, phase, sequence_order, owner_role_id, description) VALUES (?,?,?,?,?,?)`,
      [stage_code, stage_name, phase, sequence_order, owner_role_id || null, description || null]
    );
    req.flash('success', `Stage "${stage_name}" added.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not add stage. Stage Code may already exist.');
  }
  res.redirect('/admin/stages');
});

router.post('/admin/stages/:id', requireAuth, adminOnly, async (req, res) => {
  const { stage_name, phase, sequence_order, owner_role_id, description } = req.body;
  await pool.query(
    `UPDATE stages SET stage_name=?, phase=?, sequence_order=?, owner_role_id=?, description=? WHERE id=?`,
    [stage_name, phase, sequence_order, owner_role_id || null, description || null, req.params.id]
  );
  req.flash('success', 'Stage updated.');
  res.redirect('/admin/stages');
});

router.post('/admin/stages/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE stages SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  req.flash('success', 'Stage enabled/disabled.');
  res.redirect('/admin/stages');
});

router.post('/admin/stages/:id/reorder', requireAuth, adminOnly, async (req, res) => {
  const { direction } = req.body; // 'up' | 'down'
  const [[stage]] = await pool.query('SELECT * FROM stages WHERE id=?', [req.params.id]);
  const [neighbours] = await pool.query(
    `SELECT * FROM stages WHERE sequence_order ${direction === 'up' ? '<' : '>'} ?
     ORDER BY sequence_order ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
    [stage.sequence_order]
  );
  if (neighbours.length) {
    const other = neighbours[0];
    await pool.query('UPDATE stages SET sequence_order=? WHERE id=?', [other.sequence_order, stage.id]);
    await pool.query('UPDATE stages SET sequence_order=? WHERE id=?', [stage.sequence_order, other.id]);
  }
  res.redirect('/admin/stages');
});

// ---------------- NOTIFICATION RULES (who gets what email) ----------------
router.get('/admin/notification-rules', requireAuth, adminOnly, async (req, res) => {
  const [stages] = await pool.query('SELECT * FROM stages ORDER BY sequence_order ASC');
  const [rules] = await pool.query(
    `SELECT nr.*, s.stage_name, s.phase, r.name AS role_name, u.name AS user_name
     FROM notification_rules nr JOIN stages s ON nr.stage_id=s.id
     LEFT JOIN roles r ON nr.recipient_role_id=r.id LEFT JOIN users u ON nr.recipient_user_id=u.id
     ORDER BY s.sequence_order ASC, nr.event ASC`
  );
  const [roles] = await pool.query('SELECT * FROM roles ORDER BY name');
  const [users] = await pool.query('SELECT id, name, email FROM users WHERE is_active=1 ORDER BY name');
  res.render('admin/notification-rules', { title: 'Notification Rules', stages, rules, roles, users });
});

router.post('/admin/notification-rules', requireAuth, adminOnly, async (req, res) => {
  const { stage_id, event, recipient_type, recipient_role_id, recipient_user_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO notification_rules (stage_id, event, recipient_role_id, recipient_user_id) VALUES (?,?,?,?)`,
      [stage_id, event, recipient_type === 'role' ? recipient_role_id : null, recipient_type === 'user' ? recipient_user_id : null]
    );
    req.flash('success', 'Notification rule added.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not add notification rule.');
  }
  res.redirect('/admin/notification-rules');
});

router.post('/admin/notification-rules/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE notification_rules SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  res.redirect('/admin/notification-rules');
});

router.post('/admin/notification-rules/:id/delete', requireAuth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM notification_rules WHERE id=?', [req.params.id]);
  req.flash('success', 'Notification rule removed.');
  res.redirect('/admin/notification-rules');
});

// ---------------- SMTP SETTINGS ----------------
router.get('/admin/smtp', requireAuth, adminOnly, async (req, res) => {
  const [[smtp]] = await pool.query('SELECT * FROM smtp_settings ORDER BY id DESC LIMIT 1');
  res.render('admin/smtp-settings', { title: 'SMTP Settings', smtp });
});

router.post('/admin/smtp', requireAuth, adminOnly, async (req, res) => {
  const { host, port, secure, username, password, from_email, from_name } = req.body;
  try {
    await pool.query('DELETE FROM smtp_settings');
    await pool.query(
      `INSERT INTO smtp_settings (host, port, secure, username, password, from_email, from_name) VALUES (?,?,?,?,?,?,?)`,
      [host, port, secure ? 1 : 0, username, password, from_email, from_name]
    );
    req.flash('success', 'SMTP settings saved.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not save SMTP settings.');
  }
  res.redirect('/admin/smtp');
});

// Sends a real test email through whatever SMTP config is currently saved
// (getSmtpConfig() inside sendMail() falls back to .env if nothing's saved
// yet), so Admin can confirm credentials work before relying on them.
router.post('/admin/smtp/test', requireAuth, adminOnly, [
  body('test_email').trim().isEmail().withMessage('Enter a valid email address to send the test to.')
], validate, async (req, res) => {
  const { test_email } = req.body;
  try {
    await sendMail({
      to: test_email,
      subject: 'TRAFO 360 - Test Email',
      html: `<p>This is a test email from <strong>TRAFO 360</strong> (Trafo Power &amp; Electricals - Workflow &amp; DMS), sent by ${req.session.user.name} to confirm the SMTP settings are working.</p><p>If you received this, outgoing mail is configured correctly.</p>`,
      text: `This is a test email from TRAFO 360, sent by ${req.session.user.name} to confirm the SMTP settings are working. If you received this, outgoing mail is configured correctly.`
    });
    req.flash('success', `Test email sent to ${test_email}. Check the inbox (and spam folder) to confirm delivery.`);
  } catch (err) {
    req.log?.error({ err }, 'SMTP test email failed');
    req.flash('error', `Test email failed: ${err.message}`);
  }
  res.redirect('/admin/smtp');
});

// ---------------- STAGE DOCUMENT REQUIREMENTS (department upload gates) ----------------
router.get('/admin/stage-requirements', requireAuth, adminOnly, async (req, res) => {
  const [stages] = await pool.query('SELECT * FROM stages ORDER BY sequence_order ASC');
  const [requirements] = await pool.query(
    `SELECT sdr.*, s.stage_name, s.phase, s.sequence_order
     FROM stage_document_requirements sdr JOIN stages s ON sdr.stage_id=s.id
     ORDER BY s.sequence_order ASC, sdr.id ASC`
  );
  res.render('admin/stage-requirements', { title: 'Stage Document Requirements', stages, requirements });
});

router.post('/admin/stage-requirements', requireAuth, adminOnly, async (req, res) => {
  const { stage_id, requirement_name, is_mandatory } = req.body;
  try {
    await pool.query(
      `INSERT INTO stage_document_requirements (stage_id, requirement_name, is_mandatory) VALUES (?,?,?)`,
      [stage_id, requirement_name, is_mandatory ? 1 : 0]
    );
    req.flash('success', 'Document requirement added.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not add requirement.');
  }
  res.redirect('/admin/stage-requirements');
});

router.post('/admin/stage-requirements/:id/toggle', requireAuth, adminOnly, async (req, res) => {
  await pool.query('UPDATE stage_document_requirements SET is_active = NOT is_active WHERE id=?', [req.params.id]);
  res.redirect('/admin/stage-requirements');
});

router.post('/admin/stage-requirements/:id/delete', requireAuth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM stage_document_requirements WHERE id=?', [req.params.id]);
  req.flash('success', 'Requirement removed.');
  res.redirect('/admin/stage-requirements');
});

// ---------------- WHATSAPP WEB NOTIFICATIONS (unofficial, no paid API) ----------------
router.get('/admin/whatsapp', requireAuth, adminOnly, async (req, res) => {
  const status = whatsapp.getStatus();
  const enabled = await whatsapp.isEnabledInSettings();
  res.render('admin/whatsapp', { title: 'WhatsApp Notifications', status, enabled });
});

router.post('/admin/whatsapp/enable', requireAuth, adminOnly, async (req, res) => {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('whatsapp_enabled','1')
     ON DUPLICATE KEY UPDATE setting_value='1'`
  );
  whatsapp.initWhatsApp().catch(err => console.error('[whatsapp] init error:', err.message));
  req.flash('success', 'WhatsApp is starting up. Refresh this page in a few seconds for the QR code to scan.');
  res.redirect('/admin/whatsapp');
});

router.post('/admin/whatsapp/disable', requireAuth, adminOnly, async (req, res) => {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('whatsapp_enabled','0')
     ON DUPLICATE KEY UPDATE setting_value='0'`
  );
  await whatsapp.disableWhatsApp();
  req.flash('success', 'WhatsApp notifications disabled.');
  res.redirect('/admin/whatsapp');
});

// Sends a real test WhatsApp message via the connected session - only works
// once status is 'ready' (QR scanned); sendWhatsAppMessage() itself no-ops
// safely with a reason otherwise, which we surface as a flash message.
router.post('/admin/whatsapp/test', requireAuth, adminOnly, [
  body('test_number').trim().notEmpty().withMessage('Enter a WhatsApp number to send the test to (with country code, digits only, e.g. 91XXXXXXXXXX).')
], validate, async (req, res) => {
  const { test_number } = req.body;
  const result = await whatsapp.sendWhatsAppMessage(
    test_number,
    `This is a test message from TRAFO 360 (Trafo Power & Electricals - Workflow & DMS), sent by ${req.session.user.name} to confirm WhatsApp notifications are working.`
  );
  if (result.sent) {
    req.flash('success', `Test WhatsApp message sent to ${test_number}.`);
  } else if (result.reason === 'not_connected') {
    req.flash('error', 'WhatsApp is not connected yet - scan the QR code first, then try the test again.');
  } else if (result.reason === 'no_number') {
    req.flash('error', 'Enter a valid WhatsApp number (country code + number, digits only).');
  } else {
    req.flash('error', `Test message failed: ${result.reason}`);
  }
  res.redirect('/admin/whatsapp');
});

// ---------------- SYSTEM SETTINGS (issue days, grace period, branding) ----------------
router.get('/admin/settings', requireAuth, adminOnly, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM system_settings');
  const settings = {};
  rows.forEach(r => settings[r.setting_key] = r.setting_value);
  res.render('admin/settings', { title: 'System Settings', settings });
});

// NOTE: file upload (the logo) for this route runs early in server.js,
// before CSRF validation - see the comment in config/csrf.js.
router.post('/admin/settings', requireAuth, adminOnly, async (req, res) => {
  const entries = Object.entries(req.body).filter(([key]) => key !== '_csrf');
  if (req.file) entries.push(['company_logo_path', `/branding/${req.file.filename}`]);
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
       ON DUPLICATE KEY UPDATE setting_value=?`,
      [key, value, value]
    );
  }
  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
});

// ---------------- DOCUMENT CATEGORIES ----------------
router.post('/admin/document-categories', requireAuth, adminOnly, async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('INSERT INTO document_categories (name) VALUES (?)', [name]);
    req.flash('success', 'Category added.');
  } catch (err) {
    req.flash('error', 'Could not add category (may already exist).');
  }
  res.redirect('/documents/new');
});

module.exports = router;