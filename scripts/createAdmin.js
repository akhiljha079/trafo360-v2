// Creates the first Admin user using ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD from .env
// Usage: npm run create-admin
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function run() {
  const name = process.env.ADMIN_NAME || 'System Administrator';
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before running this script.');
    process.exit(1);
  }

  const [[adminRole]] = await pool.query(`SELECT id FROM roles WHERE name='Admin'`);
  if (!adminRole) {
    console.error('Admin role not found. Run "npm run seed" first.');
    process.exit(1);
  }

  const [[existing]] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
  const hash = await bcrypt.hash(password, 10);

  if (existing) {
    await pool.query('UPDATE users SET password_hash=?, role_id=?, is_active=1 WHERE id=?', [hash, adminRole.id, existing.id]);
    console.log(`Existing user ${email} updated to Admin with the new password.`);
  } else {
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role_id) VALUES (?,?,?,?)',
      [name, email, hash, adminRole.id]
    );
    console.log(`Admin user created: ${email}`);
  }
  process.exit(0);
}

run().catch(err => {
  console.error('Create admin failed:', err.message);
  process.exit(1);
});
