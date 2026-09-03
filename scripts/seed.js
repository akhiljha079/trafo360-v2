// Runs schema.sql then seed.sql against the configured database.
// Usage: npm run seed
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  console.log('Applying schema.sql ...');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await connection.query(schema);

  console.log('Applying seed.sql ...');
  const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
  await connection.query(seed);

  console.log('Database schema and seed data applied successfully.');
  console.log('Next: run "npm run create-admin" to create your first Admin login.');
  await connection.end();
}

run().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
