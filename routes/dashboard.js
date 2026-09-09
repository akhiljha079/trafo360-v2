const express = require('express');
const pool = require('../config/db');
const { requireAuth, hasModulePermission } = require('../middleware/auth');
const { computeRag, computeProgressPct } = require('../utils/jobStatus');
const { WIDGET_REGISTRY, resolveWidgets } = require('../utils/dashboardWidgets');
const router = express.Router();

// Ensures every registry widget has a row for this user (default order/
// visibility) so reordering has something concrete to swap between.
async function ensureWidgetRows(userId) {
  for (let i = 0; i < WIDGET_REGISTRY.length; i++) {
    await pool.query(
      `INSERT IGNORE INTO user_dashboard_widgets (user_id, widget_key, is_visible, sequence_order) VALUES (?,?,1,?)`,
      [userId, WIDGET_REGISTRY[i].key, i * 10]
    );
  }
}

// One cheap count per module, for the dashboard's module-tile home row.
// Only queried for modules the viewer can actually see (matches the
// sidebar's own permission gating) so an unauthorized user never even
// triggers the query, let alone sees the tile.
async function moduleTileStats(user) {
  const tiles = [];
  if (user.is_admin || hasModulePermission(user, 'sales', 'view')) {
    const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM orders WHERE is_deleted=0 AND status='Active'`);
    tiles.push({ key: 'sales', icon: 'bi-graph-up-arrow', label: 'Active Orders', stat: cnt, href: '/sales' });
  }
  if (user.is_admin || hasModulePermission(user, 'manufacturing', 'view')) {
    const [[{ cnt }]] = await pool.query(`
      SELECT COUNT(*) AS cnt FROM jobs j JOIN stages s ON j.current_stage_id=s.id
      WHERE j.is_deleted=0 AND j.status='Active' AND s.phase='Manufacturing'`);
    tiles.push({ key: 'manufacturing', icon: 'bi-gear-wide-connected', label: 'Units in Manufacturing', stat: cnt, href: '/manufacturing' });
  }
  if (user.is_admin || hasModulePermission(user, 'dispatch', 'view')) {
    const [[{ cnt }]] = await pool.query(`
      SELECT COUNT(*) AS cnt FROM jobs j JOIN stages s ON j.current_stage_id=s.id
      WHERE j.is_deleted=0 AND j.status='Active' AND s.phase='Dispatch'`);
    tiles.push({ key: 'dispatch', icon: 'bi-truck', label: 'Units in Dispatch', stat: cnt, href: '/dispatch' });
  }
  if (user.is_admin || hasModulePermission(user, 'documents', 'view')) {
    const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM document_issues WHERE status IN ('Issued','Overdue','Escalated')`);
    tiles.push({ key: 'documents', icon: 'bi-folder2-open', label: 'Documents Issued/Overdue', stat: cnt, href: '/documents' });
  }
  if (user.is_admin || hasModulePermission(user, 'warranty', 'view')) {
    const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM warranty_claims WHERE status IN ('Open','Investigating')`);
    tiles.push({ key: 'warranty', icon: 'bi-shield-check', label: 'Open Warranty Claims', stat: cnt, href: '/warranty' });
  }
  if (user.is_admin || hasModulePermission(user, 'accounting', 'view')) {
    const [[{ cnt }]] = await pool.query(`
      SELECT COUNT(*) AS cnt FROM documents d JOIN document_categories c ON d.category_id=c.id
      WHERE d.is_active=1 AND c.category_type='accounting'`);
    tiles.push({ key: 'accounting', icon: 'bi-receipt', label: 'Accounting Documents', stat: cnt, href: '/accounting' });
  }
  return tiles;
}

router.get('/dashboard', requireAuth, async (req, res) => {
  const moduleTiles = await moduleTileStats(req.session.user);
  const [[{ activeJobs }]] = await pool.query(`SELECT COUNT(*) AS activeJobs FROM jobs WHERE status='Active' AND is_deleted=0`);
  const [[{ completedJobs }]] = await pool.query(`SELECT COUNT(*) AS completedJobs FROM jobs WHERE status='Completed' AND is_deleted=0`);
  const [jobsByPhase] = await pool.query(`
    SELECT s.phase, COUNT(*) AS cnt FROM jobs j JOIN stages s ON j.current_stage_id = s.id
    WHERE j.status='Active' AND j.is_deleted=0 GROUP BY s.phase`);
  const [[{ totalStages }]] = await pool.query(`SELECT COUNT(*) AS totalStages FROM stages WHERE is_active=1`);
  const [recentJobsRaw] = await pool.query(`
    SELECT j.*, s.stage_name, s.phase, s.sequence_order FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id
    WHERE j.is_deleted=0
    ORDER BY j.updated_at DESC LIMIT 8`);
  const recentJobs = recentJobsRaw.map(job => ({
    ...job,
    progressPct: computeProgressPct(job.sequence_order, totalStages),
    rag: computeRag(job).rag
  }));
  const [[{ issuedDocs }]] = await pool.query(`SELECT COUNT(*) AS issuedDocs FROM document_issues WHERE status IN ('Issued','Overdue')`);
  const [[{ overdueDocs }]] = await pool.query(`SELECT COUNT(*) AS overdueDocs FROM document_issues WHERE status IN ('Overdue','Escalated')`);
  const [[{ pendingApprovals }]] = await pool.query(`SELECT COUNT(*) AS pendingApprovals FROM document_issues WHERE status='Pending Approval'`);
  const [myIssues] = await pool.query(
    `SELECT di.*, d.doc_code, d.doc_name FROM document_issues di JOIN documents d ON di.document_id=d.id
     WHERE di.requested_by=? AND di.status IN ('Issued','Overdue','Escalated') ORDER BY di.due_date ASC LIMIT 5`,
    [req.session.user.id]
  );

  let pendingApprovalList = [];
  if (hasModulePermission(req.session.user, 'documents', 'approve')) {
    [pendingApprovalList] = await pool.query(
      `SELECT di.*, d.doc_code, d.doc_name, u.name AS requester_name
       FROM document_issues di JOIN documents d ON di.document_id=d.id JOIN users u ON di.requested_by=u.id
       WHERE di.status='Pending Approval' ORDER BY di.created_at ASC LIMIT 10`
    );
  }

  const [savedWidgetRows] = await pool.query(
    'SELECT * FROM user_dashboard_widgets WHERE user_id=?', [req.session.user.id]
  );
  const allWidgetPrefs = resolveWidgets(req.session.user, savedWidgetRows);
  const widgets = allWidgetPrefs.filter(w => w.isVisible);

  res.render('dashboard', {
    title: 'Dashboard',
    moduleTiles,
    activeJobs, completedJobs, jobsByPhase, recentJobs,
    issuedDocs, overdueDocs, pendingApprovals, myIssues, pendingApprovalList,
    widgets, allWidgetPrefs
  });
});

// ---------------- DASHBOARD WIDGET CUSTOMIZATION (per-user) ----------------
router.post('/dashboard/widgets/:key/toggle', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const key = req.params.key;
  if (!WIDGET_REGISTRY.some(w => w.key === key)) { return res.redirect('/dashboard'); }
  await ensureWidgetRows(userId);
  await pool.query(
    `UPDATE user_dashboard_widgets SET is_visible = NOT is_visible WHERE user_id=? AND widget_key=?`,
    [userId, key]
  );
  res.redirect('/dashboard');
});

router.post('/dashboard/widgets/:key/reorder', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const key = req.params.key;
  const { direction } = req.body; // 'up' | 'down'
  if (!WIDGET_REGISTRY.some(w => w.key === key)) { return res.redirect('/dashboard'); }
  await ensureWidgetRows(userId);

  const [[widget]] = await pool.query(
    'SELECT * FROM user_dashboard_widgets WHERE user_id=? AND widget_key=?', [userId, key]
  );
  const [[neighbour]] = await pool.query(
    `SELECT * FROM user_dashboard_widgets WHERE user_id=? AND sequence_order ${direction === 'up' ? '<' : '>'} ?
     ORDER BY sequence_order ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
    [userId, widget.sequence_order]
  );
  if (neighbour) {
    await pool.query('UPDATE user_dashboard_widgets SET sequence_order=? WHERE id=?', [neighbour.sequence_order, widget.id]);
    await pool.query('UPDATE user_dashboard_widgets SET sequence_order=? WHERE id=?', [widget.sequence_order, neighbour.id]);
  }
  res.redirect('/dashboard');
});

module.exports = router;
