const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Computes a RAG (Red/Amber/Green) status for a job based on its target
// dispatch date and current job status. Also flags jobs "stalled" in their
// current stage beyond a reasonable threshold, independent of the target date.
function computeRag(job, daysInStage) {
  if (job.status === 'Completed') return { rag: 'green', label: 'Completed' };
  if (job.status === 'Cancelled') return { rag: 'gray', label: 'Cancelled' };
  if (job.status === 'On Hold') return { rag: 'gray', label: 'On Hold' };

  if (!job.target_dispatch_date) {
    return { rag: 'gray', label: 'No Target Set' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(job.target_dispatch_date);
  target.setHours(0, 0, 0, 0);
  const daysToTarget = Math.round((target - today) / (1000 * 60 * 60 * 24));

  if (daysToTarget < 0) return { rag: 'red', label: `Delayed ${Math.abs(daysToTarget)}d` };
  if (daysToTarget <= 7) return { rag: 'amber', label: `Due in ${daysToTarget}d` };
  return { rag: 'green', label: 'On Track' };
}

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
    const progressPct = job.sequence_order
      ? Math.min(100, Math.round((job.sequence_order / totalStages) * 100))
      : 0;
    const startedAt = stageStartMap[`${job.id}-${job.current_stage_id}`];
    const daysInStage = startedAt
      ? Math.round((new Date() - new Date(startedAt)) / (1000 * 60 * 60 * 24))
      : null;
    const stalled = daysInStage !== null && daysInStage >= 10 && job.status === 'Active';
    const { rag, label } = computeRag(job, daysInStage);
    return { ...job, progressPct, daysInStage, stalled, rag, ragLabel: label };
  });

  // Summary counts for the header cards
  const summary = { green: 0, amber: 0, red: 0, gray: 0, stalled: 0 };
  rows.forEach(r => { summary[r.rag]++; if (r.stalled) summary.stalled++; });

  res.render('project-status', { title: 'Project Status', rows, summary });
});

module.exports = router;
