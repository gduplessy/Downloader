import { describe, expect, it } from 'vitest';
import { parseHttpDate } from './http-date';
import { retryAfter } from './waits';
const longDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function obsolete(ms: number) {
  const date = new Date(ms),
    parts = date.toUTCString().split(' ');
  return `${longDays[date.getUTCDay()]}, ${parts[1]}-${parts[2]}-${parts[3].slice(-2)} ${parts[4]} GMT`;
}
describe('RFC9110 HTTP-date compatibility', () => {
  it.each([
    'Sun, 06 Nov 1994 08:49:37 GMT',
    'Sunday, 06-Nov-94 08:49:37 GMT',
    'Sun Nov  6 08:49:37 1994',
    'Sun Nov 06 08:49:37 1994',
  ])('accepts the standard example %s', (value) => {
    const expected = Date.UTC(1994, 10, 6, 8, 49, 37);
    expect(parseHttpDate(value, expected - 1000)).toBe(expected);
    expect(retryAfter(value, expected - 1000)).toBe(expected);
  });
  it('interprets RFC850 relative to the supplied clock across a century', () => {
    const expected = Date.UTC(2100, 0, 1);
    expect(parseHttpDate(obsolete(expected), Date.UTC(2099, 11, 31))).toBe(expected);
    expect(retryAfter(obsolete(expected), Date.UTC(2099, 11, 31))).toBe(expected);
    expect(parseHttpDate('Sunday, 06-Nov-94 08:49:37 GMT', Date.UTC(2026, 0, 1))).toBe(
      Date.UTC(1994, 10, 6, 8, 49, 37),
    );
  });
  it('uses the full timestamp at the fifty-year boundary and validates the resulting weekday', () => {
    const now = Date.UTC(2025, 10, 6, 8, 49, 37),
      boundary = Date.UTC(2075, 10, 6, 8, 49, 37);
    expect(parseHttpDate(obsolete(boundary), now)).toBe(boundary);
    const past = Date.UTC(1975, 10, 6, 8, 49, 38);
    expect(parseHttpDate(obsolete(past), now)).toBe(past);
    expect(parseHttpDate(obsolete(boundary + 1000), now)).toBeNull();
  });
  it.each([
    'Mon, 06 Nov 1994 08:49:37 GMT',
    'Monday, 06-Nov-94 08:49:37 GMT',
    'Mon Nov  6 08:49:37 1994',
    'Wed, 29 Feb 2100 00:00:00 GMT',
    'Thu, 31 Apr 2025 00:00:00 GMT',
    'Sun, 00 Nov 1994 08:49:37 GMT',
    'Sun, 06 Nov 1994 24:00:00 GMT',
    'Sun, 06 Nov 1994 08:60:00 GMT',
    'Sun, 06 Nov 1994 08:49:61 GMT',
    'Sun, 06 Nov 1994 08:49:60 GMT',
    'sun, 06 Nov 1994 08:49:37 GMT',
    'Sunday, 6-Nov-94 08:49:37 GMT',
    'Sunday, 06-Nov-1994 08:49:37 GMT',
    'Sunday, 06-Nov-94 08:49:37 UTC',
    'Sun Nov 6 08:49:37 1994',
    'Sun Nov   6 08:49:37 1994',
    'Sun Nov  6 08:49:37 1994 GMT',
    'Sun, 06 Nov 1994 08:49:37 GMT\r\n',
    'Sun, 06 Nov 1994 08:49:37 GMT\n',
    'Sunday, 06-Nov-94 08:49:37 GMT\n',
    'Sun Nov  6 08:49:37 1994\n',
    'Sun, 06 Nov 1994 08:49:37 GMT\0',
    'x'.repeat(129),
  ])('rejects invalid grammar/calendar %s', (value) =>
    expect(parseHttpDate(value, Date.UTC(1994, 10, 6))).toBeNull(),
  );
  it('accepts Gregorian leap days without normalizing an invalid calendar', () => {
    expect(parseHttpDate('Tue, 29 Feb 2000 00:00:00 GMT', Date.UTC(2000, 1, 28))).toBe(
      Date.UTC(2000, 1, 29),
    );
    expect(parseHttpDate('Tuesday, 29-Feb-00 00:00:00 GMT', Date.UTC(1999, 1, 28))).toBe(
      Date.UTC(2000, 1, 29),
    );
    expect(parseHttpDate('Tue Feb 29 00:00:00 2000', Date.UTC(2000, 1, 28))).toBe(
      Date.UTC(2000, 1, 29),
    );
  });
  it.each([
    'Sat, 31 Dec 2016 23:59:60 GMT',
    'Saturday, 31-Dec-16 23:59:60 GMT',
    'Sat Dec 31 23:59:60 2016',
  ])('maps the grammar leap second conservatively to the following UTC boundary: %s', (value) => {
    expect(parseHttpDate(value, Date.UTC(2016, 11, 31))).toBe(Date.UTC(2017, 0, 1));
    expect(retryAfter(value, Date.UTC(2016, 11, 31))).toBe(Date.UTC(2017, 0, 1));
  });
  it('retains numeric and seven-day deadline limits across all date forms', () => {
    const now = Date.UTC(1994, 10, 6, 8, 49, 37),
      end = now + 604800000;
    expect(retryAfter('0', now)).toBe(now);
    expect(retryAfter('604800', now)).toBe(end);
    expect(retryAfter('604801', now)).toBeNull();
    for (const value of [new Date(end).toUTCString(), obsolete(end)])
      expect(retryAfter(value, now)).toBe(end);
    expect(retryAfter(obsolete(end + 1000), now)).toBeNull();
    expect(retryAfter(obsolete(now - 1000), now)).toBeNull();
    expect(retryAfter('9'.repeat(128), now)).toBeNull();
    expect(parseHttpDate('Sun, 06 Nov 1994 08:49:37 GMT', NaN)).toBeNull();
  });
});
