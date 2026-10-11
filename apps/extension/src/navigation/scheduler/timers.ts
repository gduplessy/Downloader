export function countdownDuration(signals: readonly { text: string; visible: boolean }[]): number | null {
  const durations = signals.filter(s => s.visible).map(({text}) => {
    const clock = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
    if (clock) {const parts = clock.slice(1).filter(Boolean).map(Number); if(parts.slice(1).some(n => n > 59))return 0;return parts.reduce((total,part)=>total*60+part,0)*1000;}
    const seconds = [...text.matchAll(/\b([1-9]\d*)\b/g)].map(m=>Number(m[1]));
    return Math.max(0,...seconds)*1000;
  }).filter(n => Number.isSafeInteger(n) && n > 0 && n <= 604800000);
  return durations.length ? Math.max(...durations) : null;
}
