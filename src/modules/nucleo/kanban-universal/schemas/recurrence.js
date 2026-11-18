const DAYS_IN_WEEK = 7;
const LAST_DAY = 0;
export function nextOccurrence(value, recurrence) {
  const date = new Date(`${value}T12:00:00Z`);
  if (recurrence === 'mensal') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const end = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, LAST_DAY),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, end));
  } else {
    date.setUTCDate(date.getUTCDate() + (recurrence === 'semanal' ? DAYS_IN_WEEK : 1));
  }
  return date.toISOString().split('T')[0];
}
