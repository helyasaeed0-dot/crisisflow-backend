// Returns the Date for 00:00 today in the given IANA timezone (e.g. Asia/Karachi)
function startOfDay(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)])
  );

  // Difference between the timezone's wall clock and UTC
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMs = zonedAsUtc - Math.floor(date.getTime() / 1000) * 1000;

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - offsetMs);
}

module.exports = { startOfDay };