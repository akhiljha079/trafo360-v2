const express = require('express');
const pool = require('../config/db');
const { requireAuth, hasModulePermission } = require('../middleware/auth');
const router = express.Router();

function canViewAnalytics(user) {
  return hasModulePermission(user, 'reports', 'view');
}

router.get('/analytics', requireAuth, async (req, res) => {
  if (!canViewAnalytics(req.session.user)) {
    req.flash('error', 'You do not have permission to view analytics.');
    return res.redirect('/dashboard');
  }

  // 1) Active jobs by phase + status
  const [jobsByPhaseStatus] = await pool.query(`
    SELECT s.phase, j.status, COUNT(*) AS cnt
    FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id
    WHERE j.is_deleted=0
    GROUP BY s.phase, j.status`);

  // 2) Average time spent per stage (hours), based on paired Started/Completed events.
  //    Approximation: matches each Completed event to the nearest preceding Started
  //    event for the same job+stage. Good enough for trend spotting; a stage visited
  //    multiple times on the same job will average across all visits.
  const [avgStageDuration] = await pool.query(`
    SELECT s.stage_code, s.stage_name, s.phase, s.sequence_order,
           ROUND(AVG(TIMESTAMPDIFF(HOUR, started.action_at, completed.action_at)), 1) AS avg_hours,
           COUNT(*) AS sample_count
    FROM job_stage_history completed
    JOIN job_stage_history started
      ON started.job_id = completed.job_id AND started.stage_id = completed.stage_id
     AND started.event = 'Started' AND started.action_at <= completed.action_at
    JOIN stages s ON s.id = completed.stage_id
    WHERE completed.event = 'Completed'
    GROUP BY s.id
    ORDER BY s.sequence_order ASC`);

  // 3) Jobs created per month (last 12 months of data present)
  const [jobsByMonth] = await pool.query(`
    SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS cnt
    FROM jobs WHERE is_deleted=0 GROUP BY ym ORDER BY ym ASC LIMIT 24`);

  // 4) Document issue counts by status
  const [issuesByStatus] = await pool.query(`
    SELECT status, COUNT(*) AS cnt FROM document_issues GROUP BY status`);

  // 5) Overdue/escalated documents trend by month (by due date)
  const [overdueTrend] = await pool.query(`
    SELECT DATE_FORMAT(due_date, '%Y-%m') AS ym, COUNT(*) AS cnt
    FROM document_issues WHERE status IN ('Overdue','Escalated') AND due_date IS NOT NULL
    GROUP BY ym ORDER BY ym ASC LIMIT 24`);

  // 6) Stage-completion workload by owning role/department
  const [workloadByRole] = await pool.query(`
    SELECT r.name AS role_name, COUNT(*) AS cnt
    FROM job_stage_history h
    JOIN stages s ON h.stage_id = s.id
    JOIN roles r ON s.owner_role_id = r.id
    WHERE h.event = 'Completed'
    GROUP BY r.id ORDER BY cnt DESC`);

  // 7) Documents by confidentiality level
  const [docsByConfidentiality] = await pool.query(`
    SELECT confidentiality, COUNT(*) AS cnt FROM documents WHERE is_active=1 GROUP BY confidentiality`);

  res.render('analytics', {
    title: 'Analytics',
    data: {
      jobsByPhaseStatus, avgStageDuration, jobsByMonth,
      issuesByStatus, overdueTrend, workloadByRole, docsByConfidentiality
    }
  });
});

module.exports = router;
