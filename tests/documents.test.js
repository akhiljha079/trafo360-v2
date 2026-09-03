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

test('uploads an allowed file type successfully with a valid CSRF token', async () => {
  // Exercises the actual multipart + file + CSRF interaction end-to-end
  // (multer runs before CSRF validation for this route - see config/csrf.js
  // and the app.post(...) interceptors in server.js) - not just the
  // metadata-only path the other tests use.
  const agent = await loginAsAdmin(app);
  const docCode = `TEST-UPLOAD-${Date.now()}`;
  const token = await freshToken(agent, '/documents/new');
  const res = await agent
    .post('/documents')
    .field('doc_code', docCode)
    .field('doc_name', 'Legitimate PDF')
    .field('confidentiality', 'Internal')
    .field('_csrf', token)
    .attach('file', Buffer.from('%PDF-1.4 test'), 'report.pdf');

  expect(res.status).toBe(302);
  expect(res.headers.location).toMatch(/^\/documents\/\d+$/);
  const [[doc]] = await pool.query('SELECT * FROM documents WHERE doc_code=?', [docCode]);
  expect(doc).toBeTruthy();
  expect(doc.file_path).toMatch(/\.pdf$/);
});

test('rejects an upload with a disallowed file extension, and a missing/wrong CSRF token independently of that', async () => {
  const agent = await loginAsAdmin(app);
  const badExtCode = `TEST-BADEXT-${Date.now()}`;
  let token = await freshToken(agent, '/documents/new');
  await agent
    .post('/documents')
    .field('doc_code', badExtCode)
    .field('doc_name', 'Suspicious file')
    .field('confidentiality', 'Internal')
    .field('_csrf', token)
    .attach('file', Buffer.from('#!/bin/sh\necho hi'), 'payload.sh');
  const [[rejectedByFilter]] = await pool.query('SELECT * FROM documents WHERE doc_code=?', [badExtCode]);
  expect(rejectedByFilter).toBeUndefined();

  const noCsrfCode = `TEST-NOCSRF-${Date.now()}`;
  await agent
    .post('/documents')
    .field('doc_code', noCsrfCode)
    .field('doc_name', 'No token')
    .field('confidentiality', 'Internal')
    .attach('file', Buffer.from('%PDF-1.4 test'), 'report.pdf'); // no _csrf field at all
  const [[rejectedByCsrf]] = await pool.query('SELECT * FROM documents WHERE doc_code=?', [noCsrfCode]);
  expect(rejectedByCsrf).toBeUndefined();
});
