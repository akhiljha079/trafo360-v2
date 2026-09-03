const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { computeRag, computeProgressPct } = require('../utils/jobStatus');
const router = express.Router();

router.get('/project-status', requireAuth, async (req, res) => {
  const [totalStagesRow] = await pool.query(`SELECT COUNT(*) AS cnt FROM stages WHERE is_active=1`);
  const totalStages = totalStagesRow[0].cnt || 1;

  const [jobs] = await pool.query(`
    SELECT j.*, s.stage_code, s.stage_name, s.phase, s.sequence_order
    FROM jobs j LEFT JOIN stages s ON j.current_stage_id = s.id
    WHERE j.is_deleted=0
    ORDER BY
      CASE j.status WHEN 'Active' THEN 0 WHEN 'On Hold' THEN 1 WHEN 'Completed' THEN 2 ELSE 3 END,
      j.target_dispatch_date IS NULL, j.target_dispatch_date ASC`);

  // Days-in-current-stage: time since the most recent 'Started' event for
  // each job's current stage.
  const [stageStarts] = await pool.query(`
    SELECT h1.job_id, h1.stage_id, h1.action_at
    FROM job_stage_history h1
    INNER JOIN (
      SELECT job_id, stage_id, MAX(action_at) AS max_at
      FROM job_stage_history WHERE event='Started' GROUP BY job_id, stage_id
    ) h2 ON h1.job_id=h2.job_id AND h1.stage_id=h2.stage_id AND h1.action_at=h2.max_at
    WHERE h1.event='Started'`);
  const stageStartMap = {};
  stageStarts.forEach(r => { stageStartMap[`${r.job_id}-${r.stage_id}`] = r.action_at; });

  const rows = jobs.map(job => {
    const progressPct = computeProgressPct(job.sequence_order, totalStages);
    const startedAt = stageStartMap[`${job.id}-${job.current_stage_id}`];
    const daysInStage = startedAt
      ? Math.round((new Date() - new Date(startedAt)) / (1000 * 60 * 60 * 24))
      : null;
    const stalled = daysInStage !== null && daysInStage >= 10 && job.status === 'Active';
    const { rag, label } = computeRag(job);
    return { ...job, progressPct, daysInStage, stalled, rag, ragLabel: label };
  });

  // Summary counts for the header cards
  const summary = { green: 0, amber: 0, red: 0, gray: 0, stalled: 0 };
  rows.forEach(r => { summary[r.rag]++; if (r.stalled) summary.stalled++; });

  res.render('project-status', { title: 'Project Status', rows, summary });
});

module.exports = router;
