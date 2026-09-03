// Shared helpers for the supertest suite. Every state-changing request must
// carry the CSRF token + cookie pair the server issued it (see config/csrf.js
// and public/js/csrf.js for the same pattern used by real browsers).
const request = require('supertest');

function extractCsrfToken(html) {
  const match = html.match(/<meta name="csrf-token" content="([^"]*)">/);
  return match ? match[1] : null;
}

// Returns a supertest agent (persists cookies across requests) already
// logged in as the seeded admin user, plus a fresh CSRF token to use on the
// next POST (csrf-csrf issues a new token per GET, so callers making
// multiple POSTs should call `freshToken(agent)` again before each one).
async function loginAsAdmin(app) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/login');
  const token = extractCsrfToken(loginPage.text);
  await agent
    .post('/login')
    .type('form')
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, _csrf: token });
  return agent;
}

async function freshToken(agent, path = '/dashboard') {
  const res = await agent.get(path);
  return extractCsrfToken(res.text);
}

module.exports = { extractCsrfToken, loginAsAdmin, freshToken };
