export type Candidate = {
  text: string;
  href?: string;
  visible: boolean;
  disabled: boolean;
  download: boolean;
  id?: string;
};
export function navigationAvailable(activePages: readonly string[], page: string): boolean {
  try {
    const requested = new URL(page);
    return (
      /^https?:$/.test(requested.protocol) &&
      activePages.length < 3 &&
      activePages.every((active) => new URL(active).host !== requested.host)
    );
  } catch {
    return false;
  }
}
export type Decision = {
  blocker?: Blocker;
  kind: 'wait' | 'user' | 'click';
  index?: number;
  reason: string;
};
export type Blocker = 'browser_challenge' | 'captcha' | 'authentication' | 'expired' | 'countdown';
export function classifyBlocker(signals: {
  text: string;
  password: boolean;
  captcha: boolean;
  browserChallenge: boolean;
  countdown: boolean;
}): Blocker | undefined {
  if (/link expired|link abgelaufen/i.test(signals.text)) return 'expired';
  if (signals.password) return 'authentication';
  if (signals.browserChallenge) return 'browser_challenge';
  if (signals.captcha) return 'captcha';
  if (signals.countdown) return 'countdown';
  return undefined;
}
export function shouldSolve(
  blocker: Blocker | undefined,
  enabled: boolean,
  direct: boolean,
  attempted: boolean,
  privateSession: boolean,
): boolean {
  return blocker === 'browser_challenge' && enabled && direct && !attempted && !privateSession;
}
const negative =
  /premium|torrent|magnet:|subscribe|subscription|purchase|buy\b|pay\b|advert|sponsor/i;
const action =
  /^(?:start\s+download|download(?:\s+(?:now|file|free))?|free\s+download|(?:get|create|generate)\s+(?:download\s+)?link|continue(?:\s+to\s+download)?|slow\s+download)$/i;
export function decide(candidates: Candidate[], challenge: boolean, countdown: boolean): Decision {
  if (challenge)
    return {
      kind: 'user',
      reason:
        'Complete the login or CAPTCHA in the browser, then choose Continue in the extension.',
    };
  if (countdown) return { kind: 'wait', reason: 'Waiting for the site countdown.' };
  const eligible = candidates
    .map((c, index) => ({ c, index }))
    .filter(
      ({ c }) =>
        c.visible &&
        !negative.test(c.text + ' ' + (c.href ?? '')) &&
        (c.download ||
          action.test(
            c.text
              .replace(/\s+/g, ' ')
              .replace(/\s+your file is ready$/i, '')
              .trim(),
          ) ||
          /^(?:downloadbtn|download-button|free-download)$/i.test(c.id ?? '')) &&
        (!c.href || /^https?:\/\//i.test(c.href)),
    );
  if (eligible.some(({ c }) => c.disabled))
    return {
      kind: 'wait',
      reason: 'Waiting for the download control to become available.',
    };
  if (eligible.length === 1)
    return {
      kind: 'click',
      index: eligible[0].index,
      reason: 'Following the free download control.',
    };
  return {
    kind: 'user',
    reason:
      eligible.length > 1
        ? 'Multiple download controls found. Choose the intended one in the browser.'
        : 'Choose the download control in the browser. Automatic navigation stopped.',
  };
}
