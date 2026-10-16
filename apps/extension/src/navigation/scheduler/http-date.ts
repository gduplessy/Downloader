/** Strict HTTP-date forms from RFC 9110 section 5.6.7. Epoch milliseconds cannot
 * represent an inserted leap second; :60 maps to the following UTC boundary. */
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const longDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = '(Sun|Mon|Tue|Wed|Thu|Fri|Sat)';
const month = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const time = '([0-9]{2}):([0-9]{2}):([0-9]{2})';
const imf = new RegExp(`^${short}, ([0-9]{2}) ${month} ([0-9]{4}) ${time} GMT$`);
const rfc850 = new RegExp(
  `^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), ([0-9]{2})-${month}-([0-9]{2}) ${time} GMT$`,
);
const asctime = new RegExp(`^${short} ${month} ([0-9]{2}| [0-9]) ${time} ([0-9]{4})$`);

export function parseHttpDate(value: string, now: number): number | null {
  if (value.length > 128 || /[\r\n]/.test(value) || !Number.isFinite(now)) return null;
  let match = imf.exec(value);
  let obsolete = false;
  let weekday: number, day: number, monthIndex: number, year: number;
  let hour: number, minute: number, second: number;
  if (match || (match = rfc850.exec(value))) {
    obsolete = match[1].length > 3;
    weekday = (obsolete ? longDays : weekdays).indexOf(match[1]);
    day = Number(match[2]);
    monthIndex = months.indexOf(match[3]);
    year = Number(match[4]);
    hour = Number(match[5]);
    minute = Number(match[6]);
    second = Number(match[7]);
  } else if ((match = asctime.exec(value))) {
    weekday = weekdays.indexOf(match[1]);
    monthIndex = months.indexOf(match[2]);
    day = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
    second = Number(match[6]);
    year = Number(match[7]);
  } else return null;
  if (hour > 23 || minute > 59 || second > 60 || (second === 60 && (hour !== 23 || minute !== 59)))
    return null;
  if (obsolete) {
    const limit = new Date(now);
    if (!Number.isFinite(limit.getTime())) return null;
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    year += Math.floor(limit.getUTCFullYear() / 100) * 100;
    // Compare the entire timestamp, not just its year, at the fifty-year boundary.
    if (Date.UTC(year, monthIndex, day, hour, minute, second) > limit.getTime()) year -= 100;
  }
  if (year < 1900 || year > 9999) return null;
  const date = new Date(Date.UTC(year, monthIndex, day, hour, minute, Math.min(second, 59)));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day ||
    date.getUTCDay() !== weekday
  )
    return null;
  return date.getTime() + (second === 60 ? 1000 : 0);
}
