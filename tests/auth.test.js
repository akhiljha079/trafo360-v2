const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');
const { extractCsrfToken, loginAsAdmin } = require('./helpers');

afterAll(async () => { await pool.end(); });

test('rejects login with wrong password', async () => {
  const agent = request.agent(app);
  const loginPage = await agent.get('/login');
  const token = extractCsrfToken(loginPage.text);

  const res = await agent
    .post('/login')
    .type('form')
    .send({ email: process.env.ADMIN_EMAIL, password: 'definitely-wrong', _csrf: token });

  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/login');
});

test('rejects a POST without a valid CSRF token', async () => {
  const agent = request.agent(app);
  await agent.get('/login'); // establishes the session + csrf cookie, token intentionally not sent below

  const res = await agent
    .post('/login')
    .type('form')
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

  // CSRF failure is caught by the global error handler, which flashes and redirects.
  expect(res.status).toBe(302);
});

test('logs in with the seeded admin credentials and reaches the dashboard', async () => {
  const agent = await loginAsAdmin(app);
  const res = await agent.get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.text).toMatch(/Dashboard/i);
});

test('logout ends the session', async () => {
  const agent = await loginAsAdmin(app);
  const token = await require('./helpers').freshToken(agent);
  await agent.post('/logout').type('form').send({ _csrf: token });

  const res = await agent.get('/dashboard');
  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/^\/login/);
});
