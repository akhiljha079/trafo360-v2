// Runs once before the whole test suite: applies schema.sql (idempotent -
// CREATE TABLE IF NOT EXISTS), then seed.sql (best-effort - a duplicate-key
// error just means a previous run already seeded this database, which is
// fine for a disposable test DB reused across local `npm test` runs), then
// ensures the admin login from .env.test exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

module.exports = async function globalSetup() {
  if (!process.env.DB_NAME || !process.env.DB_NAME.includes('test')) {
    throw new Error(
      'DB_NAME must point at a disposable test database (name containing "test"). ' +
      'Copy .env.test.example to .env.test and adjust if needed.'
    );
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  await connection.query(schema);

  try {
    const seed = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'seed.sql'), 'utf8');
    await connection.query(seed);
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
  }

  const [[adminRole]] = await connection.query(`SELECT id FROM roles WHERE name='Admin'`);
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
  const [[existing]] = await connection.query('SELECT id FROM users WHERE email=?', [process.env.ADMIN_EMAIL]);
  if (existing) {
    await connection.query('UPDATE users SET password_hash=?, role_id=?, is_active=1 WHERE id=?', [hash, adminRole.id, existing.id]);
  } else {
    await connection.query(
      'INSERT INTO users (name, email, password_hash, role_id) VALUES (?,?,?,?)',
      [process.env.ADMIN_NAME || 'Test Admin', process.env.ADMIN_EMAIL, hash, adminRole.id]
    );
  }

  await connection.end();
};
