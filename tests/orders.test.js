const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');
const { loginAsAdmin, freshToken } = require('./helpers');

afterAll(async () => { await pool.end(); });

test('creates an order and adding a lot auto-creates one job per unit', async () => {
  const agent = await loginAsAdmin(app);
  const orderNo = `TEST-ORD-${Date.now()}`;

  let token = await freshToken(agent, '/orders/new');
  const createRes = await agent
    .post('/orders')
    .type('form')
    .send({
      order_no: orderNo,
      customer_name: 'Test Utility Board',
      transformer_type: 'Power Transformer',
      rating: '25 MVA',
      total_quantity: '3',
      _csrf: token
    });
  expect(createRes.status).toBe(302);
  const orderUrl = createRes.headers.location;
  const orderId = orderUrl.split('/').pop();

  token = await freshToken(agent, orderUrl);
  const lotRes = await agent
    .post(`/orders/${orderId}/lots`)
    .type('form')
    .send({ lot_no: '1', lot_name: 'Lot 1', quantity: '3', _csrf: token });
  expect(lotRes.status).toBe(302);

  const [units] = await pool.query(
    `SELECT j.* FROM jobs j JOIN lots l ON j.lot_id = l.id WHERE l.order_id=? ORDER BY j.unit_no ASC`,
    [orderId]
  );
  expect(units.length).toBe(3);
  expect(units[0].job_no).toBe(`${orderNo}-L1-U01`);
  // Units start manufacturing directly (Sales/GTP already happened at order level).
  expect(units.every(u => u.current_stage_id !== null)).toBe(true);
});

test('rejects a lot with quantity above the sanity cap', async () => {
  const agent = await loginAsAdmin(app);
  const orderNo = `TEST-ORD-CAP-${Date.now()}`;
  let token = await freshToken(agent, '/orders/new');
  const createRes = await agent
    .post('/orders')
    .type('form')
    .send({ order_no: orderNo, customer_name: 'Cap Test', transformer_type: 'Power Transformer', _csrf: token });
  const orderId = createRes.headers.location.split('/').pop();

  token = await freshToken(agent, createRes.headers.location);
  const lotRes = await agent
    .post(`/orders/${orderId}/lots`)
    .type('form')
    .send({ lot_no: '1', quantity: '5000', _csrf: token });
  expect(lotRes.status).toBe(302);

  const [[lot]] = await pool.query('SELECT * FROM lots WHERE order_id=?', [orderId]);
  expect(lot).toBeUndefined();
});
