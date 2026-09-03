const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');
const { loginAsAdmin, freshToken } = require('./helpers');

afterAll(async () => { await pool.end(); });

test('dashboard renders with default widgets, then hiding one removes it', async () => {
  const agent = await loginAsAdmin(app);
  const before = await agent.get('/dashboard');
  expect(before.status).toBe(200);
  expect(before.text).toContain('Recently Updated Jobs');

  let token = await freshToken(agent, '/dashboard');
  await agent.post('/dashboard/widgets/recent_jobs/toggle').type('form').send({ _csrf: token });

  const after = await agent.get('/dashboard');
  expect(after.text).not.toContain('Recently Updated Jobs');

  // toggle back on so this test is safe to re-run
  token = await freshToken(agent, '/dashboard');
  await agent.post('/dashboard/widgets/recent_jobs/toggle').type('form').send({ _csrf: token });
});

test('reordering moves a widget earlier and the change persists', async () => {
  const agent = await loginAsAdmin(app);
  await agent.get('/dashboard'); // ensures rows exist via the GET route

  const [[adminUser]] = await pool.query(`SELECT id FROM users WHERE email=?`, [process.env.ADMIN_EMAIL]);
  const [before] = await pool.query(
    'SELECT widget_key, sequence_order FROM user_dashboard_widgets WHERE user_id=? ORDER BY sequence_order ASC',
    [adminUser.id]
  );
  expect(before.length).toBeGreaterThan(1);
  const secondWidgetKey = before[1].widget_key;

  const token = await freshToken(agent, '/dashboard');
  await agent.post(`/dashboard/widgets/${secondWidgetKey}/reorder`).type('form').send({ direction: 'up', _csrf: token });

  const [after] = await pool.query(
    'SELECT widget_key, sequence_order FROM user_dashboard_widgets WHERE user_id=? ORDER BY sequence_order ASC',
    [adminUser.id]
  );
  expect(after[0].widget_key).toBe(secondWidgetKey);
});

test('rejects toggling a widget key that does not exist', async () => {
  const agent = await loginAsAdmin(app);
  const token = await freshToken(agent, '/dashboard');
  const res = await agent.post('/dashboard/widgets/not_a_real_widget/toggle').type('form').send({ _csrf: token });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/dashboard');
});
