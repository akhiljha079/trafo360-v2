// Creates the Warranty record for a job once it's dispatched (marked
// Completed - see routes/jobs.js advance handler), and shared helpers used
// by both that hook and the daily cron expiry check (cron/scheduler.js).
const pool = require('../config/db');

async function getSetting(key, fallback) {
  const [[row]] = await pool.query('SELECT setting_value FROM system_settings WHERE setting_key=?', [key]);
  return row && row.setting_value ? row.setting_value : fallback;
}

async function getWarrantyMonthsForType(transformerType) {
  const [[type]] = await pool.query('SELECT warranty_months FROM transformer_types WHERE name=?', [transformerType]);
  if (type && type.warranty_months) return type.warranty_months;
  return Number(await getSetting('default_warranty_months', '18'));
}

function computeStatus(endDate, expiringDaysBefore) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  if (end < today) return 'Expired';
  const daysLeft = Math.round((end - today) / (1000 * 60 * 60 * 24));
  if (daysLeft <= expiringDaysBefore) return 'Expiring';
  return 'Active';
}

// Idempotent - a job only ever gets one warranty (job_id is UNIQUE), so
// re-advancing/re-completing a job never creates a duplicate.
async function createWarrantyForJob(jobId, startDate = new Date()) {
  const [[job]] = await pool.query('SELECT * FROM jobs WHERE id=?', [jobId]);
  if (!job) return null;
  const months = await getWarrantyMonthsForType(job.transformer_type);
  const start = new Date(startDate);
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);
  const expiringDaysBefore = Number(await getSetting('warranty_expiring_days_before', '60'));
  const status = computeStatus(end, expiringDaysBefore);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const [result] = await pool.query(
    `INSERT IGNORE INTO warranties (job_id, start_date, duration_months, end_date, status) VALUES (?,?,?,?,?)`,
    [jobId, startStr, months, endStr, status]
  );
  return result.insertId || null;
}

module.exports = { getWarrantyMonthsForType, computeStatus, createWarrantyForJob };
