// Shared RAG (Red/Amber/Green) + progress-percentage computation for a job,
// used by Project Status, the job detail page (transformer visualization),
// and the dashboard - so "on track" means the same thing everywhere.
function computeRag(job) {
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

function computeProgressPct(sequenceOrder, totalStages) {
  if (!sequenceOrder || !totalStages) return 0;
  return Math.min(100, Math.round((sequenceOrder / totalStages) * 100));
}

module.exports = { computeRag, computeProgressPct };
