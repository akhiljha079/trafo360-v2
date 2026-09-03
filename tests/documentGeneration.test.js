const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');
const { closeBrowser } = require('../utils/pdfGenerator');
const { loginAsAdmin, freshToken } = require('./helpers');

afterAll(async () => {
  await closeBrowser();
  await pool.end();
});

async function createOrderWithLot(agent, orderNo) {
  let token = await freshToken(agent, '/orders/new');
  const createRes = await agent
    .post('/orders')
    .type('form')
    .send({ order_no: orderNo, customer_name: 'PDF Test Customer', transformer_type: 'Power Transformer', rating: '10 MVA', _csrf: token });
  const orderId = createRes.headers.location.split('/').pop();

  token = await freshToken(agent, createRes.headers.location);
  const lotRes = await agent.post(`/orders/${orderId}/lots`).type('form').send({ lot_no: '1', quantity: '1', _csrf: token });
  const lotId = lotRes.headers.location.split('/').pop();
  return { orderId, lotId };
}

test('generates an order-level document (QAP) and links it into the Document Library', async () => {
  const agent = await loginAsAdmin(app);
  const { orderId } = await createOrderWithLot(agent, `TEST-PDF-ORD-${Date.now()}`);

  const token = await freshToken(agent, `/orders/${orderId}`);
  const genRes = await agent
    .post(`/orders/${orderId}/generate-document`)
    .type('form')
    .send({ doc_type: 'qap', _csrf: token });

  expect(genRes.status).toBe(302);
  expect(genRes.headers.location).toMatch(/^\/documents\/\d+$/);

  const docId = genRes.headers.location.split('/').pop();
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [docId]);
  expect(doc).toBeTruthy();
  expect(doc.doc_code).toMatch(/^QAP-/);
  expect(doc.related_order_id).toBe(Number(orderId));
  expect(doc.file_path).toMatch(/\.pdf$/);

  const [[genRecord]] = await pool.query('SELECT * FROM generated_documents WHERE document_id=?', [docId]);
  expect(genRecord).toBeTruthy();
  expect(genRecord.doc_type).toBe('qap');
}, 30000);

test('generates a job-level document (Nameplate) for a unit created via a lot', async () => {
  const agent = await loginAsAdmin(app);
  const { orderId, lotId } = await createOrderWithLot(agent, `TEST-PDF-JOB-${Date.now()}`);
  const [[unit]] = await pool.query('SELECT * FROM jobs WHERE lot_id=? ORDER BY unit_no ASC LIMIT 1', [lotId]);

  const token = await freshToken(agent, `/jobs/${unit.id}`);
  const genRes = await agent
    .post(`/jobs/${unit.id}/generate-document`)
    .type('form')
    .send({ doc_type: 'nameplate', _csrf: token });

  expect(genRes.status).toBe(302);
  expect(genRes.headers.location).toMatch(/^\/documents\/\d+$/);
  const docId = genRes.headers.location.split('/').pop();
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE id=?', [docId]);
  expect(doc.related_job_id).toBe(unit.id);
}, 30000);

test('rejects generating a document type that does not exist', async () => {
  const agent = await loginAsAdmin(app);
  const { orderId } = await createOrderWithLot(agent, `TEST-PDF-BAD-${Date.now()}`);
  const token = await freshToken(agent, `/orders/${orderId}`);
  const res = await agent
    .post(`/orders/${orderId}/generate-document`)
    .type('form')
    .send({ doc_type: 'not_a_real_type', _csrf: token });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe(`/orders/${orderId}`);
}, 30000);
