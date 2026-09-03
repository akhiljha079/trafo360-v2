// Runs once a day (default 09:00 server time). Handles:
//  - reminder N day(s) before due date
//  - reminder on due date
//  - daily overdue reminders during the grace period (default 2 working days)
//  - automatic escalation email to Director once grace period is exceeded
//  - (extension requests are event-driven, not cron-driven, but this file
//     could also nudge pending extension approvals if desired)
const cron = require('node-cron');
const pool = require('../config/db');
const { workingDaysBetween } = require('../utils/workingDays');
const {
  notifyReminder,
  notifyOverdueGrace,
  notifyEscalation
} = require('../utils/documentNotify');

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function getSetting(key, fallback) {
  const [[row]] = await pool.query('SELECT setting_value FROM system_settings WHERE setting_key=?', [key]);
  return row ? row.setting_value : fallback;
}

async function runDailyDocumentCheck() {
  console.log(`[cron] Running document reminder/escalation check @ ${new Date().toISOString()}`);
  const reminderDaysBefore = Number(await getSetting('reminder_days_before_due', '1'));
  const graceDays = Number(await getSetting('grace_period_working_days', '2'));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [issues] = await pool.query(
    `SELECT * FROM document_issues WHERE status IN ('Issued','Overdue') AND due_date IS NOT NULL`
  );

  for (const issue of issues) {
    const due = new Date(issue.due_date);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    const lastReminder = issue.last_reminder_sent;

    try {
      if (diffDays === reminderDaysBefore && lastReminder !== todayStr()) {
        await notifyReminder(issue.id, `in ${reminderDaysBefore} day(s)`);
        await pool.query('UPDATE document_issues SET last_reminder_sent=? WHERE id=?', [todayStr(), issue.id]);
      } else if (diffDays === 0 && lastReminder !== todayStr()) {
        await notifyReminder(issue.id, 'Today');
        await pool.query('UPDATE document_issues SET last_reminder_sent=? WHERE id=?', [todayStr(), issue.id]);
      } else if (diffDays < 0) {
        // overdue - mark status
        if (issue.status !== 'Overdue' && issue.status !== 'Escalated') {
          await pool.query("UPDATE document_issues SET status='Overdue' WHERE id=?", [issue.id]);
        }
        const overdueWorkingDays = workingDaysBetween(due, today);
        if (overdueWorkingDays <= graceDays) {
          if (lastReminder !== todayStr()) {
            await notifyOverdueGrace(issue.id, overdueWorkingDays);
            await pool.query('UPDATE document_issues SET last_reminder_sent=? WHERE id=?', [todayStr(), issue.id]);
          }
        } else if (issue.status !== 'Escalated') {
          await notifyEscalation(issue.id);
          await pool.query(
            "UPDATE document_issues SET status='Escalated', escalated_at=NOW() WHERE id=?",
            [issue.id]
          );
        }
      }
    } catch (err) {
      console.error(`[cron] Error processing issue #${issue.id}:`, err.message);
    }
  }
  console.log('[cron] Document reminder/escalation check complete.');
}

function startScheduler() {
  // Daily at 09:00 server time. Change the cron expression as needed.
  cron.schedule('0 9 * * *', runDailyDocumentCheck);
  console.log('[cron] Daily document reminder/escalation scheduler started (09:00 server time).');
}

module.exports = { startScheduler, runDailyDocumentCheck };
