const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');
const { loginAsAdmin, freshToken } = require('./helpers');

afterAll(async () => { await pool.end(); });

test('full document issue -> approval flow requires a signature', async () => {
  const agent = await loginAsAdmin(app);
  const docCode = `TEST-DOC-${Date.now()}`;

  let token = await freshToken(agent, '/documents/new');
  const createRes = await agent
    .post('/documents')
    .type('form')
    .send({ doc_code: docCode, doc_name: 'Test QA Manual', confidentiality: 'Internal', _csrf: token });
  expect(createRes.status).toBe(302);
  const docId = createRes.headers.location.split('/').pop();

  token = await freshToken(agent, `/documents/${docId}`);
  const issueReqRes = await agent
    .post('/issues')
    .type('form')
    .send({ document_id: docId, purpose: 'Automated test', requested_days: '7', _csrf: token });
  expect(issueReqRes.status).toBe(302);
  const issueId = issueReqRes.headers.location.split('/').pop();

  const [[issueBefore]] = await pool.query('SELECT status FROM document_issues WHERE id=?', [issueId]);
  expect(issueBefore.status).toBe('Pending Approval');

  // Approval without a signature must be rejected server-side (not just client-side).
  token = await freshToken(agent, `/issues/${issueId}`);
  await agent.post(`/issues/${issueId}/decision`).type('form').send({ decision: 'approve', _csrf: token });
  const [[stillPending]] = await pool.query('SELECT status FROM document_issues WHERE id=?', [issueId]);
  expect(stillPending.status).toBe('Pending Approval');

  // Approval with a signature succeeds and marks the document Issued.
  token = await freshToken(agent, `/issues/${issueId}`);
  await agent
    .post(`/issues/${issueId}/decision`)
    .type('form')
    .send({ decision: 'approve', signature: 'data:image/png;base64,iVBORw0KGgo=', _csrf: token });

  const [[issueAfter]] = await pool.query('SELECT status FROM document_issues WHERE id=?', [issueId]);
  expect(issueAfter.status).toBe('Issued');
  const [[doc]] = await pool.query('SELECT current_status, qr_token FROM documents WHERE id=?', [docId]);
  expect(doc.current_status).toBe('Issued');
  expect(doc.qr_token).toBeTruthy();
});

test('rejects an upload with a disallowed file extension', async () => {
  const agent = await loginAsAdmin(app);
  const token = await freshToken(agent, '/documents/new');
  const res = await agent
    .post('/documents')
    .field('doc_code', `TEST-BAD-${Date.now()}`)
    .field('doc_name', 'Suspicious file')
    .field('confidentiality', 'Internal')
    .field('_csrf', token)
    .attach('file', Buffer.from('#!/bin/sh\necho hi'), 'payload.sh');
  // multer's fileFilter rejects it -> falls through to the global error handler (redirect, not a crash)
  expect(res.status).toBe(302);
});
