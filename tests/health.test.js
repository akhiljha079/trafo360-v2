const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');

afterAll(async () => { await pool.end(); });

test('GET /healthz returns 200 ok', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('unauthenticated request to a protected page redirects to /login', async () => {
  const res = await request(app).get('/dashboard');
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/^\/login/);
});
