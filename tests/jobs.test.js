const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');
const { loginAsAdmin, freshToken } = require('./helpers');

afterAll(async () => { await pool.end(); });

test('creates a standalone job and advances it through its first stage', async () => {
  const agent = await loginAsAdmin(app);
  const jobNo = `TEST-JOB-${Date.now()}`;

  let token = await freshToken(agent, '/jobs/new');
  const createRes = await agent
    .post('/jobs')
    .type('form')
    .send({
      job_no: jobNo,
      customer_name: 'Test Customer Pvt Ltd',
      transformer_type: 'Power Transformer',
      rating: '10 MVA',
      _csrf: token
    });
  expect(createRes.status).toBe(302);
  const jobUrl = createRes.headers.location;
  expect(jobUrl).toMatch(/^\/jobs\/\d+$/);

  const viewRes = await agent.get(jobUrl);
  expect(viewRes.status).toBe(200);
  expect(viewRes.text).toContain(jobNo);

  const jobId = jobUrl.split('/').pop();
  token = await freshToken(agent, jobUrl);
  const advanceRes = await agent
    .post(`/jobs/${jobId}/advance`)
    .type('form')
    .send({ remarks: 'Automated test advance', _csrf: token });
  expect(advanceRes.status).toBe(302);

  const [[job]] = await pool.query('SELECT * FROM jobs WHERE job_no=?', [jobNo]);
  expect(job).toBeTruthy();
  const [history] = await pool.query('SELECT * FROM job_stage_history WHERE job_id=? ORDER BY id ASC', [job.id]);
  expect(history.length).toBeGreaterThanOrEqual(2); // Started first stage, then Completed it on advance
});

test('rejects creating a job with no customer name', async () => {
  const agent = await loginAsAdmin(app);
  const token = await freshToken(agent, '/jobs/new');
  const res = await agent
    .post('/jobs')
    .type('form')
    .send({ job_no: `TEST-INVALID-${Date.now()}`, transformer_type: 'Power Transformer', _csrf: token });
  expect(res.status).toBe(302);

  const [[job]] = await pool.query('SELECT * FROM jobs WHERE customer_name IS NULL AND job_no LIKE "TEST-INVALID-%"');
  expect(job).toBeUndefined();
});
