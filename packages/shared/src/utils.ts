export function expandUrls(text: string): string[] {
  const results: string[] = [];
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const match = line.match(/\[(\d+):(\d+)\]/);
    if (match) {
      const a = Number(match[1]),
        b = Number(match[2]);
      if (b < a || b - a > 9999) throw Error('Invalid or excessive URL range');
      for (let n = a; n <= b; n++)
        results.push(line.replace(match[0], String(n).padStart(match[1].length, '0')));
    } else results.push(line);
    if (results.length > 10000) throw Error('Batch exceeds 10,000 URLs');
  }
  for (const value of results) {
    const u = new URL(value);
    if (!['http:', 'https:', 'ftp:', 'ftps:'].includes(u.protocol) || u.username || u.password)
      throw Error('Unsupported source URL');
  }
  return [...new Set(results)];
}
export function bytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '0 B';
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}
