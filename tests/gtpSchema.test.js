const request = require('supertest');
const app = require('../server');
const pool = require('../config/db');
const { loginAsAdmin, freshToken } = require('./helpers');

afterAll(async () => { await pool.end(); });

test('admin can add a GTP field group + field, and it appears on the order form', async () => {
  const agent = await loginAsAdmin(app);
  const groupName = `Test Group ${Date.now()}`;

  let token = await freshToken(agent, '/admin/gtp-schema');
  await agent
    .post('/admin/gtp-schema/groups')
    .type('form')
    .send({ name: groupName, transformer_type_id: '', sequence_order: '99', _csrf: token });

  const [[group]] = await pool.query('SELECT * FROM gtp_field_groups WHERE name=?', [groupName]);
  expect(group).toBeTruthy();

  const fieldKey = `test_field_${Date.now()}`;
  token = await freshToken(agent, '/admin/gtp-schema');
  await agent
    .post('/admin/gtp-schema/fields')
    .type('form')
    .send({
      group_id: group.id,
      field_key: fieldKey,
      label: 'Test Field',
      unit: 'kg',
      field_type: 'text',
      stage_codes: 'M1',
      sequence_order: '1',
      _csrf: token
    });

  const [[field]] = await pool.query('SELECT * FROM gtp_fields WHERE field_key=?', [fieldKey]);
  expect(field).toBeTruthy();
  expect(field.group_id).toBe(group.id);

  const formPage = await agent.get('/orders/new');
  expect(formPage.status).toBe(200);
  expect(formPage.text).toContain(`gtp_${fieldKey}`);
  expect(formPage.text).toContain('Test Field');
});

test('rejects a field key with invalid characters', async () => {
  const agent = await loginAsAdmin(app);
  const [[anyGroup]] = await pool.query('SELECT id FROM gtp_field_groups LIMIT 1');
  const token = await freshToken(agent, '/admin/gtp-schema');
  await agent
    .post('/admin/gtp-schema/fields')
    .type('form')
    .send({ group_id: anyGroup.id, field_key: 'Not Valid!', label: 'Bad Key', field_type: 'text', _csrf: token });

  const [[field]] = await pool.query('SELECT * FROM gtp_fields WHERE label=?', ['Bad Key']);
  expect(field).toBeUndefined();
});
