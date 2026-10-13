import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Every privacy assertion is based on actual split-worker/browser membership.
// The approved synthetic activation invokes the unchanged registered production listener.
export async function buildPrivateDriver({ build, ext }) {
  await build({
    stdin: {
      contents:
        "import {navigationStorage} from './apps/extension/src/navigation/session/store.ts'; const area=navigationStorage(chrome.storage.local,chrome.storage.session,chrome.extension.inIncognitoContext);globalThis.__fixtureReadNavigation=()=>area.get(null);globalThis.__fixtureSetNavigation=v=>area.set(v);globalThis.__fixtureRemoveNavigation=k=>area.remove(k);",
      resolveDir: process.cwd(),
      sourcefile: 'private-storage-probe.ts',
      loader: 'ts',
    },
    outfile: resolve(ext, 'storage-probe.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
  });
  await writeFile(
    resolve(ext, 'options.html'),
    '<script src="storage-probe.js"></script><script src="wake.js"></script>',
  );
}
export async function preparePrivateNavigation({
  command,
  evaluate,
  extId,
  fixtureTarget,
  base,
  cli,
  env,
  privacyMarker,
}) {
  // Actual browser load options grant this isolated extension access to its private window.

  const incognitoProbe = await evaluate(
    'new Promise(r=>chrome.extension.isAllowedIncognitoAccess(r))',
  );
  assert.equal(incognitoProbe, true, 'Actual browser did not grant incognito access');
  await evaluate(
    'new Promise((r,j)=>chrome.windows.create({incognito:true,url:"about:blank"},w=>chrome.runtime.lastError?j(Error(chrome.runtime.lastError.message)):r(w)))',
  );
  // Split-mode regular APIs do not enumerate private tabs. Use actual CDP context identity
  // only to open the driver; obtain tab identity and incognito flags in that private driver.
  const contextTargets = (await command('Target.getTargets')).targetInfos;
  const normalContext = contextTargets.find(
    (t) => t.targetId === fixtureTarget.targetId,
  )?.browserContextId;
  const privateSourceTarget = contextTargets.find(
    (t) =>
      t.type === 'page' &&
      t.url === 'about:blank' &&
      t.browserContextId &&
      t.browserContextId !== normalContext,
  );
  assert.ok(
    privateSourceTarget,
    'Browser did not expose the actual private context: ' +
      JSON.stringify(
        contextTargets.map((t) => ({
          type: t.type,
          url: t.url,
          browserContextId: t.browserContextId,
        })),
      ),
  );
  const privateBootstrap = await command('Target.attachToTarget', {
    targetId: privateSourceTarget.targetId,
    flatten: true,
  });
  await command(
    'Page.navigate',
    { url: 'chrome-extension://' + extId + '/options.html' },
    privateBootstrap.sessionId,
  );
  let privateTarget;
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await command('Target.getTargets');
    privateTarget = targets.targetInfos.find(
      (t) =>
        t.type === 'page' &&
        t.url === 'chrome-extension://' + extId + '/options.html' &&
        t.targetId !== fixtureTarget.targetId,
    );
    if (privateTarget) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(privateTarget, 'Private extension driver did not load');
  const { sessionId: privatePageSession } = await command('Target.attachToTarget', {
    targetId: privateTarget.targetId,
    flatten: true,
  });
  const privateEvaluate = async (expression) => {
    const result = await command(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      privatePageSession,
    );
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await privateEvaluate('globalThis.chrome?.runtime?.id').catch(() => null)) === extId)
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    await privateEvaluate('chrome.extension.inIncognitoContext'),
    true,
    'Driver is not actual incognito context',
  );
  const privateSource = await privateEvaluate('chrome.tabs.create({url:"about:blank"})');
  assert.ok(privateSource?.id, 'Actual private driver did not observe private source');
  assert.equal(privateSource.incognito, true);
  const membership = await privateEvaluate(
    '(async()=>{const stores=await chrome.cookies.getAllCookieStores();return stores.find(s=>s.tabIds.includes(' +
      privateSource.id +
      '));})()',
  );
  assert.ok(membership?.id, 'Actual private cookie-store membership unavailable');
  await privateEvaluate(
    'chrome.cookies.set({url:' +
      JSON.stringify(base) +
      ',name:"fixture_session",value:' +
      JSON.stringify(privacyMarker) +
      ',storeId:' +
      JSON.stringify(membership.id) +
      '})',
  );
  const sourceUrl = base + '/nav-adapters/g4u/blob?' + privacyMarker;
  await privateEvaluate(
    'chrome.tabs.update(' + privateSource.id + ',{url:' + JSON.stringify(sourceUrl) + '})',
  );
  await new Promise((r) => setTimeout(r, 1000));
  let privateWorker;
  for (let attempt = 0; attempt < 100 && !privateWorker; attempt++) {
    const targets = await command('Target.getTargets');
    for (const target of targets.targetInfos.filter(
      (t) =>
        t.type === 'service_worker' && t.url === 'chrome-extension://' + extId + '/background.js',
    )) {
      const attached = await command('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
      });
      const probe = await command(
        'Runtime.evaluate',
        { expression: 'chrome.extension.inIncognitoContext', returnByValue: true },
        attached.sessionId,
      );
      if (probe.result?.value === true) {
        privateWorker = { ...target, sessionId: attached.sessionId };
        break;
      }
    }
    if (!privateWorker) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(privateWorker, 'No actual split private production worker');
  const actualPrivateTab = await privateEvaluate('chrome.tabs.get(' + privateSource.id + ')');
  const menu = await command(
    'Runtime.evaluate',
    {
      expression:
        'globalThis.__fixtureMenuHandler({menuItemId:"navigate"},' +
        JSON.stringify(actualPrivateTab) +
        ')',
      awaitPromise: true,
      returnByValue: true,
    },
    privateWorker.sessionId,
  );
  if (menu.exceptionDetails) throw Error(JSON.stringify(menu.exceptionDetails));
  let jobId;
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshot = JSON.parse(
      execFileSync(cli, ['--json', 'list'], { env, windowsHide: true, encoding: 'utf8' }),
    );
    const privateJob = (snapshot.jobs ?? snapshot).find(
      (j) => j.private && j.navigation_scope?.private,
    );
    if (privateJob) {
      jobId = privateJob.id;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(jobId, 'Production private menu did not claim a navigation job');
  const ownedTab = await privateEvaluate(
    '(async()=>{const ref=(await globalThis.__fixtureReadNavigation())["resolver-' +
      jobId +
      '"];return ref?chrome.tabs.get(ref.tabId):null;})()',
  );
  assert.ok(ownedTab?.id, 'No production-owned blob tab');
  const targets = await command('Target.getTargets');
  const debuggerTargets = await privateEvaluate('chrome.debugger.getTargets()');
  const targetIdentity = debuggerTargets.find((target) => target.tabId === ownedTab.id);
  assert.ok(targetIdentity?.id, 'Actual owned private tab has no debugger target identity');
  const pageTarget = targets.targetInfos.find((target) => target.targetId === targetIdentity.id);
  assert.ok(pageTarget, 'No owned page target');
  return {
    jobId,
    ownedTab,
    pageTarget,
    evaluate: privateEvaluate,
    pageSession: privatePageSession,
    worker: privateWorker,
    membership,
  };
}
export async function auditPrivateNavigation({ evaluateRegular, jobId, privacyMarker, data }) {
  const observations = {};
  const regularSnapshot = await evaluateRegular('chrome.runtime.sendMessage({type:"snapshot"})');
  observations.normalProjectionHidesPrivate =
    !JSON.stringify(regularSnapshot).includes(jobId) &&
    !JSON.stringify(regularSnapshot).includes(privacyMarker);
  assert.equal(observations.normalProjectionHidesPrivate, true);
  const local = await evaluateRegular('chrome.storage.local.get(null)');
  observations.localMarkerAbsent =
    !JSON.stringify(local).includes(privacyMarker) && !JSON.stringify(local).includes(jobId);
  assert.equal(observations.localMarkerAbsent, true);
  let diskMarker = false;
  for (const file of ['downloader.db', 'downloader.db-wal']) {
    try {
      const bytes = await readFile(resolve(data, file));
      if (bytes.includes(Buffer.from(privacyMarker)) || bytes.includes(Buffer.from(jobId)))
        diskMarker = true;
    } catch (error) {
      if (file === 'downloader.db' || error.code !== 'ENOENT') throw error;
    }
  }
  observations.durableDbMarkerAbsent = !diskMarker;
  assert.equal(diskMarker, false);
  const normalOverlay = await evaluateRegular('globalThis.__fixtureReadNavigation()');
  observations.regularOverlayHidesPrivate =
    !JSON.stringify(normalOverlay).includes(jobId) &&
    !JSON.stringify(normalOverlay).includes(privacyMarker);
  assert.equal(
    observations.regularOverlayHidesPrivate,
    true,
    'Production regular overlay exposed private Blob record',
  );
  const normalCaptureStatus = await evaluateRegular(
    'chrome.runtime.sendMessage({type:"capture_status"})',
  );
  observations.regularCaptureStatusHidesPrivate = !normalCaptureStatus.some(
    (row) => row.id === jobId,
  );
  assert.equal(observations.regularCaptureStatusHidesPrivate, true);
  return observations;
}

// Seed only a mapping-format fixture, using the actual private job created above.
// This qualifies shared-area fencing; it does not fabricate a browser download event.
export async function auditPrivatePrimitiveMappings({ regularEvaluate, privateEvaluate, jobId }) {
  const key = 'browser-job-fixture-' + crypto.randomUUID();
  try {
    await privateEvaluate(
      'globalThis.__fixtureSetNavigation(' + JSON.stringify({ [key]: jobId }) + ')',
    );
    const regular = await regularEvaluate('globalThis.__fixtureReadNavigation()');
    const regularReadFenced = !(key in regular) && !JSON.stringify(regular).includes(jobId);
    await regularEvaluate('globalThis.__fixtureRemoveNavigation(' + JSON.stringify(key) + ')');
    const retained = await privateEvaluate('globalThis.__fixtureReadNavigation()');
    return {
      seededMapping: true,
      actualSplitBrowserStorage: true,
      regularReadFenced,
      regularRemoveFenced: retained[key] === jobId,
    };
  } finally {
    await privateEvaluate('globalThis.__fixtureRemoveNavigation(' + JSON.stringify(key) + ')');
  }
}
