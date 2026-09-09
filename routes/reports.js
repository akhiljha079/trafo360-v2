// Reports module: filterable, exportable (CSV + PDF) tabular reports per
// module, built on the same aggregate-SQL-query style as routes/analytics.js
// (which stays in place for the chart-based view). Gated by the 'reports'
// module - the Phase 1 RBAC backfill already seeds sensible defaults for who
// gets reports.view (Admin/Director/anyone with manage rights previously).
const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireModule } = require('../middleware/auth');
const { renderPdf } = require('../utils/pdfGenerator');
const router = express.Router();

function defaultRange(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

const REPORTS = {
  sales: {
    label: 'Sales', icon: 'bi-graph-up-arrow',
    columns: [
      { key: 'order_no', label: 'Order No.' }, { key: 'customer_name', label: 'Customer' },
      { key: 'transformer_type', label: 'Type' }, { key: 'total_quantity', label: 'Qty' },
      { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Created' }
    ],
    query: (from, to) => pool.query(
      `SELECT order_no, customer_name, transformer_type, total_quantity, status, created_at
       FROM orders WHERE is_deleted=0 AND created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY created_at DESC`, [from, to])
  },
  manufacturing: {
    label: 'Manufacturing Throughput', icon: 'bi-gear-wide-connected',
    columns: [
      { key: 'job_no', label: 'Job No.' }, { key: 'customer_name', label: 'Customer' },
      { key: 'stage_name', label: 'Stage Completed' }, { key: 'action_at', label: 'Completed At' }
    ],
    query: (from, to) => pool.query(
      `SELECT j.job_no, j.customer_name, s.stage_name, h.action_at
       FROM job_stage_history h JOIN jobs j ON h.job_id=j.id JOIN stages s ON h.stage_id=s.id
       WHERE s.phase='Manufacturing' AND h.event='Completed' AND h.action_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY h.action_at DESC`, [from, to])
  },
  dispatch: {
    label: 'Dispatch', icon: 'bi-truck',
    columns: [
      { key: 'job_no', label: 'Job No.' }, { key: 'customer_name', label: 'Customer' },
      { key: 'transformer_type', label: 'Type' }, { key: 'start_date', label: 'Dispatched On' }
    ],
    query: (from, to) => pool.query(
      `SELECT j.job_no, j.customer_name, j.transformer_type, w.start_date
       FROM warranties w JOIN jobs j ON w.job_id=j.id
       WHERE w.start_date BETWEEN ? AND ? ORDER BY w.start_date DESC`, [from, to])
  },
  warranty: {
    label: 'Warranty Claims', icon: 'bi-shield-check',
    columns: [
      { key: 'claim_no', label: 'Claim No.' }, { key: 'job_no', label: 'Job No.' },
      { key: 'customer_name', label: 'Customer' }, { key: 'status', label: 'Status' },
      { key: 'raised_date', label: 'Raised' }, { key: 'resolved_date', label: 'Resolved' }
    ],
    query: (from, to) => pool.query(
      `SELECT wc.claim_no, j.job_no, j.customer_name, wc.status, wc.raised_date, wc.resolved_date
       FROM warranty_claims wc JOIN warranties w ON wc.warranty_id=w.id JOIN jobs j ON w.job_id=j.id
       WHERE wc.raised_date BETWEEN ? AND ? ORDER BY wc.raised_date DESC`, [from, to])
  },
  documents: {
    label: 'Document Issues', icon: 'bi-folder2-open',
    columns: [
      { key: 'doc_code', label: 'Doc Code' }, { key: 'requester_name', label: 'Requested By' },
      { key: 'status', label: 'Status' }, { key: 'issue_date', label: 'Issued' },
      { key: 'due_date', label: 'Due' }, { key: 'return_date', label: 'Returned' }
    ],
    query: (from, to) => pool.query(
      `SELECT d.doc_code, u.name AS requester_name, di.status, di.issue_date, di.due_date, di.return_date
       FROM document_issues di JOIN documents d ON di.document_id=d.id JOIN users u ON di.requested_by=u.id
       WHERE di.created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY) ORDER BY di.created_at DESC`, [from, to])
  },
  accounting: {
    label: 'Accounting Documents', icon: 'bi-receipt',
    columns: [
      { key: 'doc_code', label: 'Doc Code' }, { key: 'doc_name', label: 'Name' },
      { key: 'category_name', label: 'Category' }, { key: 'order_no', label: 'Order' },
      { key: 'upload_date', label: 'Uploaded' }
    ],
    query: (from, to) => pool.query(
      `SELECT d.doc_code, d.doc_name, c.name AS category_name, o.order_no, d.upload_date
       FROM documents d JOIN document_categories c ON d.category_id=c.id
       LEFT JOIN orders o ON d.related_order_id=o.id
       WHERE d.is_active=1 AND c.category_type='accounting' AND d.upload_date BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY d.upload_date DESC`, [from, to])
  }
};

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/reports', requireAuth, requireModule('reports', 'view'), (req, res) => {
  res.render('reports/dashboard', { title: 'Reports', reports: REPORTS });
});

router.get('/reports/:type', requireAuth, requireModule('reports', 'view'), async (req, res) => {
  const report = REPORTS[req.params.type];
  if (!report) { req.flash('error', 'Unknown report type.'); return res.redirect('/reports'); }
  const { from, to } = defaultRange(req);
  const [rows] = await report.query(from, to);
  res.render('reports/view', { title: report.label, reportType: req.params.type, report, rows, from, to });
});

router.get('/reports/:type/export.csv', requireAuth, requireModule('reports', 'view'), async (req, res) => {
  const report = REPORTS[req.params.type];
  if (!report) return res.status(404).end();
  const { from, to } = defaultRange(req);
  const [rows] = await report.query(from, to);
  const header = report.columns.map(c => csvEscape(c.label)).join(',');
  const lines = rows.map(r => report.columns.map(c => csvEscape(r[c.key])).join(','));
  res.type('text/csv').attachment(`${req.params.type}-report-${from}-to-${to}.csv`).send([header, ...lines].join('\n'));
});

router.get('/reports/:type/export.pdf', requireAuth, requireModule('reports', 'view'), async (req, res) => {
  const report = REPORTS[req.params.type];
  if (!report) return res.status(404).end();
  const { from, to } = defaultRange(req);
  const [rows] = await report.query(from, to);
  const [[settingsRow]] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='company_name'`);
  try {
    const pdfBuffer = await renderPdf('report-template.ejs', {
      companyName: (settingsRow && settingsRow.setting_value) || 'Trafo Power & Electricals Pvt Ltd',
      reportLabel: report.label, columns: report.columns, rows, from, to,
      generatedDate: new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' })
    });
    res.type('application/pdf').attachment(`${req.params.type}-report-${from}-to-${to}.pdf`).send(pdfBuffer);
  } catch (err) {
    req.log?.error({ err }, 'report PDF generation failed');
    req.flash('error', `Could not generate PDF: ${err.message}`);
    res.redirect(`/reports/${req.params.type}`);
  }
});

module.exports = router;
