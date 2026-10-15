import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function qualifyQueuedCancellation({
  fixture,
  call,
  snapshot,
  evaluate,
  optionsSession,
  command,
  job,
  page,
  host,
}) {
  fixture.sessions.get('wait').readyAt = Date.now() + 3600000;
  const message = (value) =>
    evaluate(optionsSession, 'chrome.runtime.sendMessage(' + JSON.stringify(value) + ')');
  const raw = (value) =>
    evaluate(
      optionsSession,
      'chrome.runtime.sendNativeMessage(' +
        JSON.stringify(host) +
        ',' +
        JSON.stringify({ version: 1, id: randomUUID(), ...value }) +
        ')',
    );
  await message({
    type: 'navigation_scheduler',
    request: { action: 'settings', max_active: 1, notifications: false },
  });
  const queued = [];
  for (let i = 0; i < 20; i++)
    queued.push(
      call(
        'add',
        fixture.base + '/nav-adapters/gofile/wait?id=queuecancel' + i,
        '--navigate',
        '--filename',
        'queued-cancel-' + i + '.bin',
      ),
    );
  const before = await snapshot(),
    victim = queued.at(-1),
    row = before.tasks.find((t) => t.id === victim.id);
  assert.equal(before.tasks.filter((t) => t.lease).length, 1);
  assert.equal(row.lease, null);
  assert.equal(row.status, 'queued');
  const nativeVictim = call('list').jobs.find((j) => j.id === victim.id);
  assert.equal(nativeVictim.navigation_scope, null);
  assert.equal(nativeVictim.navigation_owner, null);
  const request = { id: victim.id, owner: row.owner, scope: null, source_generation: 1 };
  assert.equal(
    (await raw({ command: 'cancel_navigation', args: { ...request, owner: randomUUID() } })).ok,
    false,
  );
  const original = call('list').jobs.find((j) => j.id === job.id);
  assert.equal(
    (
      await raw({
        command: 'cancel_navigation',
        args: { ...request, scope: { ...original.navigation_scope, private: true } },
      })
    ).ok,
    false,
  );
  assert.equal(
    (await raw({ command: 'cancel_navigation', args: { ...request, source_generation: 2 } })).ok,
    false,
  );
  const legacy = await raw({ command: 'cancel', args: { id: victim.id } });
  assert.equal(legacy.ok, false);
  assert.match(legacy.error.message, /active session fence/);
  assert.equal(call('list').jobs.find((j) => j.id === victim.id).state, 'waiting_browser');
  const owned = (await command('Target.getTargets')).targetInfos.find(
    (t) => t.type === 'page' && t.url === page,
  );
  assert.ok(owned);
  await message({ type: 'navigation_queue_cancel', id: victim.id });
  await message({ type: 'navigation_queue_cancel', id: victim.id }); // Exact terminal retry keeps its canonical owner after removing the queue row.
  assert.equal(
    (await raw({ command: 'cancel_navigation', args: { ...request, owner: randomUUID() } })).ok,
    false,
  );
  const cancelled = call('list').jobs.find((j) => j.id === victim.id);
  assert.equal(cancelled.state, 'cancelled');
  const after = await snapshot();
  assert.ok(!after.tasks.some((t) => t.id === victim.id));
  assert.ok(after.tasks.some((t) => t.id === job.id && t.lease));
  assert.ok(
    (await command('Target.getTargets')).targetInfos.some((t) => t.targetId === owned.targetId),
  );
  const ordinary = await raw({
    command: 'add',
    args: {
      request_id: randomUUID(),
      url: fixture.base + '/ordinary.bin',
      filename: 'ordinary.bin',
      directory: null,
      queue: null,
      checksum: null,
      paused: true,
      context: { headers: {}, private: false },
      media: null,
      description: '',
    },
  });
  assert.equal(ordinary.ok, true);
  assert.equal((await raw({ command: 'cancel', args: { id: ordinary.data.id } })).ok, true);
  assert.equal(call('list').jobs.find((j) => j.id === ordinary.data.id).state, 'cancelled');
  return {
    queue_size: 21,
    active_limit: 1,
    cancelled_row: 21,
    admitted_before_cancel: false,
    navigation_scope_before: null,
    navigation_owner_before: null,
    existing_scheduler_owner_required: true,
    foreign_regular_refused: true,
    foreign_private_refused: true,
    stale_source_refused: true,
    legacy_navigation_cancel_refused: true,
    ordinary_unscoped_download_legacy_cancel_preserved: true,
    state: cancelled.state,
    exact_terminal_retry_succeeded: true,
    queued_record_removed: true,
    active_peer_lease_preserved: true,
    active_peer_tab_preserved: true,
    desktop_cancel_fallback: false,
  };
}
