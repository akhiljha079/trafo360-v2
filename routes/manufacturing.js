// Manufacturing module landing dashboard - a summary/quick-link view over
// the existing Jobs/Lots data (routes/jobs.js, routes/orders.js), scoped to
// units currently sitting in a Manufacturing-phase stage. Job records stay
// unified in the underlying schema; this route does not fork them.
const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { computeRag, computeProgressPct } = require('../utils/jobStatus');
const router = express.Router();

router.get('/manufacturing', requireAuth, async (req, res) => {
  const [[{ totalStages }]] = await pool.query(`SELECT COUNT(*) AS totalStages FROM stages WHERE is_active=1`);
  const [[{ activeLots }]] = await pool.query(`SELECT COUNT(*) AS activeLots FROM lots WHERE status='Active'`);
  const [[{ inManufacturing }]] = await pool.query(`
    SELECT COUNT(*) AS inManufacturing FROM jobs j JOIN stages s ON j.current_stage_id=s.id
    WHERE j.is_deleted=0 AND j.status='Active' AND s.phase='Manufacturing'`);

  const [jobsRaw] = await pool.query(`
    SELECT j.*, s.stage_name, s.phase, s.stage_code, s.sequence_order, o.order_no, l.lot_name
    FROM jobs j LEFT JOIN stages s ON j.current_stage_id=s.id
    LEFT JOIN orders o ON j.order_id=o.id LEFT JOIN lots l ON j.lot_id=l.id
    WHERE j.is_deleted=0 AND j.status='Active' AND s.phase='Manufacturing'
    ORDER BY j.updated_at DESC LIMIT 15`);
  const jobs = jobsRaw.map(j => ({
    ...j,
    progressPct: computeProgressPct(j.sequence_order, totalStages),
    rag: computeRag(j).rag
  }));

  const [byStage] = await pool.query(`
    SELECT s.stage_name, s.sequence_order, COUNT(*) AS cnt
    FROM jobs j JOIN stages s ON j.current_stage_id=s.id
    WHERE j.is_deleted=0 AND j.status='Active' AND s.phase='Manufacturing'
    GROUP BY s.id ORDER BY s.sequence_order ASC`);

  res.render('manufacturing/dashboard', {
    title: 'Manufacturing Overview',
    activeLots, inManufacturing, jobs, byStage
  });
});

module.exports = router;
