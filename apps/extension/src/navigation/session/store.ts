import type { SessionScope } from '../../../../../packages/shared/src/navigation';
type Area = {
  get(keys?: any): Promise<Record<string, any>>;
  set(values: Record<string, any>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};
export function durableNavigationRecord(key: string, value: any): any {
  if (!key.startsWith('resolver-') || !value?.scope || value.scope.private) return undefined;
  const scope = value.scope as SessionScope;
  const safe: Record<string, any> = { scope };
  for (const field of [
    'tabId',
    'sourceGeneration',
    'documentGeneration',
    'documentId',
    'sessionEpoch',
    'started',
    'steps',
    'downloadId',
    'leaseId',
    'leaseGeneration',
    'taskId',
    'generation',
    'waitStarted',
    'waitedMs',
  ])
    if (
      (typeof value[field] === 'string' && value[field].length <= 256) ||
      (typeof value[field] === 'number' && Number.isSafeInteger(value[field]) && value[field] >= 0)
    )
      safe[field] = value[field];
  if (typeof value.lastOrigin === 'string') {
    try {
      const origin = new URL(value.lastOrigin);
      if (
        ['http:', 'https:'].includes(origin.protocol) &&
        origin.origin === value.lastOrigin &&
        !origin.username &&
        !origin.password
      )
        safe.lastOrigin = origin.origin;
    } catch {}
  }
  // Wait reasons are fixed worker recovery codes; arbitrary page text and URLs stay transient.
  if (value.wait && typeof value.wait === 'object') {
    const wait: Record<string, unknown> = {};
    for (const field of [
      'generation',
      'source_generation',
      'observed_at_ms',
      'observed_duration_ms',
      'deadline_ms',
      'next_recheck_ms',
      'expires_at_ms',
    ])
      if (
        value.wait[field] === null ||
        (Number.isSafeInteger(value.wait[field]) && value.wait[field] >= 0)
      )
        wait[field] = value.wait[field];
    if (['server', 'page'].includes(value.wait.basis)) wait.basis = value.wait.basis;
    for (const field of ['requires_live_tab', 'notified'])
      if (typeof value.wait[field] === 'boolean') wait[field] = value.wait[field];
    if (
      typeof value.wait.reason === 'string' &&
      (/^[a-z_]{1,64}$/.test(value.wait.reason) || /^wait:[a-f0-9]{64}$/i.test(value.wait.reason))
    )
      wait.reason = value.wait.reason;
    if (
      typeof value.wait.fingerprint === 'string' &&
      /^[a-f0-9]{64}$/i.test(value.wait.fingerprint)
    )
      wait.fingerprint = value.wait.fingerprint;
    safe.wait = wait;
  }
  if (typeof value.fingerprint === 'string' && /^[0-9a-f]{64}$/i.test(value.fingerprint))
    safe.fingerprint = value.fingerprint;
  return safe;
}
// Nonsecret regular task references survive browser restart; signed action URLs,
// request contexts and private metadata remain in the ephemeral overlay only.
export function navigationStorage(local: Area, session: Area, privateWorker: boolean): Area {
  const area: Area = privateWorker ? session : {
    async get(keys?: any) {
      const [durable, transient] = await Promise.all([local.get(keys), session.get(keys)]);
      const safe: Record<string, any> = {};
      for (const [key, value] of Object.entries(durable)) {
        const record = durableNavigationRecord(key, value);
        if (record) safe[key] = record;
      }
      for (const [key, value] of Object.entries(transient))
        if (!value?.scope?.private && !value?.private && !value?.context?.private)
          safe[key] = value;
      return safe;
    },
    async set(values) {
      await session.set(values);
      const durable: Record<string, any> = {};
      for (const [key, value] of Object.entries(values)) {
        const safe = durableNavigationRecord(key, value);
        if (safe) durable[key] = safe;
      }
      if (Object.keys(durable).length) await local.set(durable);
    },
    async remove(keys) {
      await session.remove(keys);
      const items = typeof keys === 'string' ? [keys] : keys;
      const previous = await local.get(items);
      const regular = items.filter(
        (key) => durableNavigationRecord(key, previous[key]) !== undefined,
      );
      if (regular.length) await local.remove(regular);
    },
  };
  // Native claim/source counters are monotonic. A delayed read/modify/write must
  // never replace a newer claim, including in the private ephemeral overlay.
  let writes = Promise.resolve();
  function serialize(operation: () => Promise<void>): Promise<void> {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }
  return {
    get: (keys?: any) => area.get(keys),
    set(values) {
      const next = structuredClone(values);
      return serialize(async () => {
        const current = await area.get(Object.keys(next));
        for (const [key, value] of Object.entries(next)) {
          if (!key.startsWith('resolver-') || !current[key]) continue;
          for (const [previous, incoming] of [
            [current[key].sourceGeneration, value?.sourceGeneration],
            [current[key].scope?.claim_generation, value?.scope?.claim_generation],
          ]) {
            if (Number.isSafeInteger(previous) &&
                (!Number.isSafeInteger(incoming) || incoming < previous))
              throw new Error('Navigation record is stale');
          }
        }
        await area.set(next);
      });
    },
    remove(keys) {
      const selected = typeof keys === 'string' ? keys : [...keys];
      return serialize(() => area.remove(selected));
    },
  };
}
export function memoryStorage(): Area {
  const values: Record<string, any> = {};
  return {
    async get(keys?: any) {
      if (!keys) return structuredClone(values);
      const selected =
        typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return structuredClone(Object.fromEntries(
        selected.filter((key: string) => key in values).map((key: string) => [key, values[key]]),
      ));
    },
    async set(next) {
      Object.assign(values, structuredClone(next));
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
    },
  };
}
