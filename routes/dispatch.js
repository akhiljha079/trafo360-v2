// Dispatch module landing dashboard - a summary/quick-link view over the
// existing Jobs data (routes/jobs.js), scoped to units currently sitting in
// a Dispatch-phase stage. Job records stay unified in the underlying schema;
// this route does not fork them.
const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { computeRag, computeProgressPct } = require('../utils/jobStatus');
const router = express.Router();

router.get('/dispatch', requireAuth, async (req, res) => {
  const [[{ totalStages }]] = await pool.query(`SELECT COUNT(*) AS totalStages FROM stages WHERE is_active=1`);
  const [[{ inDispatch }]] = await pool.query(`
    SELECT COUNT(*) AS inDispatch FROM jobs j JOIN stages s ON j.current_stage_id=s.id
    WHERE j.is_deleted=0 AND j.status='Active' AND s.phase='Dispatch'`);
  const [[{ dispatchedThisMonth }]] = await pool.query(`
    SELECT COUNT(DISTINCT job_id) AS dispatchedThisMonth FROM job_stage_history h
    JOIN stages s ON h.stage_id=s.id
    WHERE s.phase='Dispatch' AND h.event='Completed' AND h.action_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`);

  const [jobsRaw] = await pool.query(`
    SELECT j.*, s.stage_name, s.phase, s.stage_code, s.sequence_order, o.order_no, l.lot_name
    FROM jobs j LEFT JOIN stages s ON j.current_stage_id=s.id
    LEFT JOIN orders o ON j.order_id=o.id LEFT JOIN lots l ON j.lot_id=l.id
    WHERE j.is_deleted=0 AND j.status='Active' AND s.phase='Dispatch'
    ORDER BY j.target_dispatch_date IS NULL, j.target_dispatch_date ASC LIMIT 15`);
  const jobs = jobsRaw.map(j => ({
    ...j,
    progressPct: computeProgressPct(j.sequence_order, totalStages),
    rag: computeRag(j).rag
  }));

  res.render('dispatch/dashboard', {
    title: 'Dispatch Overview',
    inDispatch, dispatchedThisMonth, jobs
  });
});

module.exports = router;
