// Working-day utilities for the document grace-period / escalation logic.
// WORKING_DAYS in .env, e.g. "1,2,3,4,5,6" (0=Sun..6=Sat) -> Mon-Sat working, Sunday off.
require('dotenv').config();

function getWorkingDaySet() {
  const raw = process.env.WORKING_DAYS || '1,2,3,4,5,6';
  return new Set(raw.split(',').map(n => Number(n.trim())));
}

function isWorkingDay(date) {
  const set = getWorkingDaySet();
  return set.has(date.getDay());
}

// Count working days strictly between two dates (exclusive of fromDate, inclusive of toDate)
function workingDaysBetween(fromDate, toDate) {
  let count = 0;
  const cur = new Date(fromDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  if (end <= cur) return 0;
  const next = new Date(cur);
  next.setDate(next.getDate() + 1);
  while (next <= end) {
    if (isWorkingDay(next)) count++;
    next.setDate(next.getDate() + 1);
  }
  return count;
}

// Add N working days to a date (used to compute due dates if needed)
function addWorkingDays(startDate, days) {
  const result = new Date(startDate);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (isWorkingDay(result)) added++;
  }
  return result;
}

module.exports = { isWorkingDay, workingDaysBetween, addWorkingDays };
