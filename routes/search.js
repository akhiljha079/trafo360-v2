// Global search across jobs, orders, and documents - reached from the
// header search box on every page.
const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { canSeeDocument } = require('../utils/documentAccess');
const router = express.Router();

const RESULT_LIMIT = 15;

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  let jobs = [], orders = [], documents = [];

  if (q) {
    const like = `%${q}%`;
    [jobs] = await pool.query(
      `SELECT id, job_no, customer_name, status FROM jobs
       WHERE is_deleted=0 AND (job_no LIKE ? OR customer_name LIKE ? OR po_no LIKE ? OR serial_no LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
      [like, like, like, like, RESULT_LIMIT]
    );
    [orders] = await pool.query(
      `SELECT id, order_no, customer_name, status FROM orders
       WHERE is_deleted=0 AND (order_no LIKE ? OR customer_name LIKE ? OR po_no LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
      [like, like, like, RESULT_LIMIT]
    );
    const [docRows] = await pool.query(
      `SELECT id, doc_code, doc_name, confidentiality, uploaded_by, current_status FROM documents
       WHERE is_active=1 AND (doc_code LIKE ? OR doc_name LIKE ?)
       ORDER BY upload_date DESC LIMIT ?`,
      [like, like, RESULT_LIMIT * 2] // over-fetch since some get filtered by confidentiality below
    );
    documents = docRows.filter(d => canSeeDocument(req.session.user, d)).slice(0, RESULT_LIMIT);
  }

  res.render('search', { title: `Search${q ? ': ' + q : ''}`, q, jobs, orders, documents });
});

module.exports = router;
