// Real production worker/resolver with isolated native host and pregranted local fixture permissions.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { startChallengeServer, expectedHash } from "./server.mjs";
const require = createRequire(
    new URL("../../../apps/extension/package.json", import.meta.url),
  ),
  { build } = require("esbuild");
const scenario = process.env.NAV_CHALLENGE_CASE ?? "fresh";
const controlObservations = [];
assert(
  ["fresh", "cancel", "csrf", "image", "selected-host"].includes(scenario),
);
const executable =
  process.env.NAV_BROWSER ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = resolve(".fixture-challenges", "installed-" + randomUUID()),
  extension = resolve(root, "extension"),
  state = resolve(root, "state"),
  output = resolve(root, "output"),
  service = resolve(root, "downloader-service.exe"),
  cli = resolve(root, "downloader.exe");
const nativePair =
  process.env.NAV_NATIVE_PAIR ??
  "C:/Users/gduplessy/code/Downloader/.fixture-streams/native-pairs/3b808ae-0.25.1";
const nativeHashes = {
  "downloader-service.exe":
    "3cbd6aa2c7d65e2c4aeaabd83afed64d86e838d2c898fd8f63cb1083804056f2",
  "downloader.exe":
    "43094f64f3379c39cd24c0e3358df77d0931afa9dd81a80a9550d16e57787e0c",
};
for (const [name, expected] of Object.entries(nativeHashes)) {
  const source = resolve(nativePair, name);
  assert.equal(
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
    expected,
    "Immutable native source mismatch",
  );
  await mkdir(root, { recursive: true });
  await copyFile(source, resolve(root, name));
  assert.equal(
    createHash("sha256")
      .update(await readFile(resolve(root, name)))
      .digest("hex"),
    expected,
    "Copied native mismatch",
  );
}
const driverHash = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await mkdir(extension, { recursive: true });
await mkdir(".local/nav-challenges", { recursive: true });
await mkdir(state, { recursive: true });
await mkdir(output, { recursive: true });
const fixture = await startChallengeServer(),
  host = "org.downloader.fixture_" + randomUUID().replaceAll("-", ""),
  env = { ...process.env, DOWNLOADER_DATA_DIR: state };
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }),
  key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
let extensionId = [
  ...createHash("sha256")
    .update(Buffer.from(key, "base64"))
    .digest()
    .subarray(0, 16),
]
  .map((n) => String.fromCharCode(97 + (n >> 4), 97 + (n & 15)))
  .join("");
const buildResult = await build({
  metafile: true,
  entryPoints: [
    "apps/extension/src/background.ts",
    "apps/extension/src/resolver.ts",
    "apps/extension/src/options.ts",
    "apps/extension/src/content.ts",
    "apps/extension/src/discovery.ts",
  ],
  outdir: extension,
  bundle: true,
  format: "iife",
  target: "es2022",
  define: { BROWSER: JSON.stringify("chromium") },
  plugins: [
    {
      name: "fixture-native-address",
      setup(build) {
        build.onLoad({ filter: /background\.ts$/ }, async (args) => ({
          contents: (await readFile(args.path, "utf8")).replace(
            "const HOST = 'org.downloader.native';",
            "const HOST = '" + host + "';",
          ),
          loader: "ts",
        }));
      },
    },
  ],
});
await copyFile(
  "apps/extension/public/options.html",
  resolve(extension, "options.html"),
);
await writeFile(
  resolve(extension, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    key,
    name: "Downloader production challenge fixture",
    version: "0.1.0",
    permissions: [
      "downloads",
      "nativeMessaging",
      "storage",
      "contextMenus",
      "activeTab",
      "alarms",
      "debugger",
      "cookies",
      "webRequest",
      "webNavigation",
      "scripting",
      "tabs",
      "notifications",
    ],
    host_permissions: ["http://127.0.0.1/*"],
    background: { service_worker: "background.js" },
    options_ui: { page: "options.html", open_in_tab: true },
  }),
);
const manifest = resolve(root, "native.json");
async function registration() {
  await writeFile(
    manifest,
    JSON.stringify({
      name: host,
      description: "Isolated production challenge fixture",
      path: service,
      type: "stdio",
      allowed_origins: ["chrome-extension://" + extensionId + "/"],
    }),
  );
  await writeFile(
    resolve(state, "native-allowlist.json"),
    JSON.stringify({ chrome_ids: [extensionId], firefox_ids: [] }),
  );
}
await registration();
function call(...args) {
  return JSON.parse(
    execFileSync(cli, ["--json", ...args], {
      env,
      windowsHide: true,
      timeout: 60000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}
const daemon = spawn(service, ["daemon"], {
  env,
  windowsHide: true,
  stdio: ["ignore", "ignore", "pipe"],
});
let daemonError = "";
daemon.stderr.on("data", (b) => (daemonError += b));
let settings;
for (let i = 0; i < 100; i++) {
  try {
    settings = call("settings").settings;
    break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
if (!settings) throw Error("Native startup failed:" + daemonError);
settings.directory = output;
settings.categories = [];
settings.captcha = {
  enabled: false,
  external_opt_in: false,
  key_ref: "",
  task_ceiling_microusd: 0,
  total_budget_microusd: 0,
};
await writeFile(resolve(root, "settings.json"), JSON.stringify(settings));
call("set", resolve(root, "settings.json"));
const registry =
  (/msedge/i.test(executable)
    ? "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\"
    : "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\") + host;
execFileSync(
  "reg",
  ["ADD", registry, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"],
  {
    windowsHide: true,
    stdio: "ignore",
  },
);
let browserProc,
  ws,
  sequence = 0;
const pending = new Map();
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + " deadline"));
    }, 60000);
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        resolveResult(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    ws.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
}
async function evaluate(session, expression) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let result;
    try {
      result = await command(
        "Runtime.evaluate",
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        session,
      );
    } catch (error) {
      if (
        String(error).includes("Execution context was destroyed") &&
        attempt < 9
      ) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw error;
    }
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  throw Error("Execution context recovery exhausted");
}
async function targetSession(targetId) {
  return (await command("Target.attachToTarget", { targetId, flatten: true }))
    .sessionId;
}
async function click(session, name, role = "button") {
  const tree = await command("Accessibility.getFullAXTree", {}, session),
    node = tree.nodes.find(
      (n) =>
        !n.ignored &&
        n.role?.value === role &&
        (name === null || n.name?.value === name) &&
        n.backendDOMNodeId,
    );
  if (!node) return false;
  const { model } = await command(
      "DOM.getBoxModel",
      { backendNodeId: node.backendDOMNodeId },
      session,
    ),
    border = model.border,
    x = (border[0] + border[2] + border[4] + border[6]) / 4,
    y = (border[1] + border[3] + border[5] + border[7]) / 4;
  await command(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x, y, button: "left", clickCount: 1 },
    session,
  );
  await command(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x, y, button: "left", clickCount: 1 },
    session,
  );
  return true;
}
async function currentContinue(session, provider) {
  const deadline = Date.now() + 30000;
  let last;
  let refreshingNode;
  async function inspect(node) {
    const resolved = await command("DOM.resolveNode", {backendNodeId:node.backendDOMNodeId}, session);
    const result = await command("Runtime.callFunctionOn", {objectId:resolved.object.objectId,functionDeclaration:'function(){const root=this.getRootNode();return {connected:this.isConnected,disabled:this.disabled,checked:this.checked,selected:[...root.querySelectorAll("input[type=radio]")].some(input=>input.isConnected&&!input.disabled&&input.checked),stale:root.textContent.includes("Page changed. Refresh the selection.")}}',returnByValue:true},session);
    return {objectId:resolved.object.objectId,state:result.result.value};
  }
  while(Date.now()<deadline) {
    const tree=(await command("Accessibility.getFullAXTree",{},session)).nodes;
    const visible=tree.filter(node=>!node.ignored);
    if(visible.some(node=>node.name?.value?.includes("Page changed. Refresh the selection."))) {
      const refresh=visible.find(node=>node.role?.value==="button"&&node.name?.value==="Refresh"&&node.backendDOMNodeId);
      if(refresh) {
        const current=await inspect(refresh);
        last={phase:"waiting for stale-preview replacement",refreshNode:refresh.backendDOMNodeId,...current.state};
        if(current.state.connected&&!current.state.disabled&&refreshingNode!==refresh.backendDOMNodeId) {
          refreshingNode=refresh.backendDOMNodeId;
          await waitClick(session,"Refresh");
          controlObservations.push({provider,action:"actual stale preview Refresh"});
        }
      }
      await new Promise(resolve=>setTimeout(resolve,100));
      continue;
    }
    const radio=visible.find(node=>node.role?.value==="radio"&&node.backendDOMNodeId);
    if(radio) {
      const current=await inspect(radio); last=current.state;
      if(current.state.connected&&!current.state.disabled) {
        if(!current.state.checked) await waitClick(session,null,"radio");
        const selected=await inspect(radio);
        if(selected.state.connected&&!selected.state.disabled&&selected.state.checked) {
          const fresh=(await command("Accessibility.getFullAXTree",{},session)).nodes;
          const button=fresh.find(node=>!node.ignored&&node.role?.value==="button"&&node.name?.value==="Continue"&&node.backendDOMNodeId);
          if(button) {
            const ready=await inspect(button); last=ready.state;
            if(ready.state.connected&&!ready.state.disabled&&ready.state.selected&&!ready.state.stale) {
              controlObservations.push({provider,action:"current selection ready",state:ready.state});
              return {objectId:ready.objectId,tree:fresh};
            }
          }
        }
      }
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error("Current enabled selected preview did not become ready: "+JSON.stringify({provider,last}));
}
async function waitClick(session, name, role = "button") {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await click(session, name, role)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(
    "Production control missing: " +
      name +
      " " +
      JSON.stringify({
        tree: (await command("Accessibility.getFullAXTree", {}, session)).nodes
          .filter((n) => !n.ignored)
          .map((n) => ({ role: n.role?.value, name: n.name?.value })),
        jobs: call("list").jobs.map((j) => ({
          id: j.id,
          state: j.state,
          error: j.error,
          navigation_url: j.navigation_url,
          selected_host: j.selected_host,
        })),
        submits: fixture.submits,
      }),
  );
}
try {
  browserProc = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--enable-unsafe-extension-debugging",
      "--user-data-dir=" + resolve(root, "profile"),
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  browserProc.stderr.on("data", (b) => (stderr += b));
  let endpoint;
  for (let i = 0; i < 200; i++) {
    try {
      const lines = (
        await readFile(resolve(root, "profile", "DevToolsActivePort"), "utf8")
      )
        .trim()
        .split(/\r?\n/);
      endpoint = "ws://127.0.0.1:" + lines[0] + lines[1];
      break;
    } catch {}
    const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      endpoint = match[1];
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!endpoint) throw Error("Browser startup failed:" + stderr);
  ws = new WebSocket(endpoint);
  await new Promise((r, reject) => {
    ws.onopen = r;
    ws.onerror = reject;
  });
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (!event.id) return;
    const waiter = pending.get(event.id);
    pending.delete(event.id);
    event.error
      ? waiter?.reject(Error(event.error.message))
      : waiter?.resolve(event.result);
  };
  const version = await command("Browser.getVersion"),
    loaded = await command("Extensions.loadUnpacked", { path: extension });
  if (loaded.id && loaded.id !== extensionId) {
    extensionId = loaded.id;
    await registration();
  }
  const options = await command("Target.createTarget", {
      url: "chrome-extension://" + extensionId + "/options.html",
    }),
    optionsSession = await targetSession(options.targetId);
  await evaluate(optionsSession, "new Promise(r=>setTimeout(r,1000))");
  await evaluate(
    optionsSession,
    'chrome.storage.local.set({settings:{directCapture:true,locale:"en",disabledAdapters:[]}})',
  );
  await evaluate(
    optionsSession,
    'chrome.runtime.sendMessage({type:"settings_changed"})',
  );
  const rows = [];
  for (const provider of ["g4u", "ddownload", "rapidgator", "gofile"]) {
    const page = fixture.base + "/nav-challenges/" + provider + "/page";
    const job = call(
      "add",
      page,
      "--navigate",
      "--filename",
      provider + "-intended.bin",
      "--sha256",
      expectedHash,
    );
    await evaluate(
      optionsSession,
      "chrome.runtime.sendMessage(" +
        JSON.stringify({ type: "continue_navigation", url: page }) +
        ")",
    );
    let tab;
    for (let i = 0; i < 200; i++) {
      const targets = await command("Target.getTargets");
      tab = targets.targetInfos.find(
        (t) => t.type === "page" && t.url === page,
      );
      if (tab) break;
      if (i > 0 && i % 50 === 0)
        await evaluate(
          optionsSession,
          "chrome.runtime.sendMessage(" +
            JSON.stringify({ type: "continue_navigation", url: page }) +
            ")",
        );
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!tab)
      throw Error(
        "Owned navigation tab missing: " +
          JSON.stringify({
            targets: (await command("Target.getTargets")).targetInfos.map(
              (t) => ({
                type: t.type,
                url: t.url,
              }),
            ),
            snapshot: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"snapshot"})',
            ),
            diagnostics: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"diagnostics"})',
            ),
          }),
      );
    const session = await targetSession(tab.targetId);
    await command("Runtime.enable", {}, session);
    await waitClick(session, "Use this file host: gofile.io");
    if (scenario !== "fresh") {
      if (scenario === "cancel") await waitClick(session, "Cancel");
      else {
        const panelDeadline = Date.now() + 30000;
        let boundPanel = false;
        while (Date.now() < panelDeadline) {
          const tree = await command("Accessibility.getFullAXTree", {}, session);
          boundPanel = tree.nodes.some((n) => !n.ignored && n.role?.value === "button" && n.name?.value === "Solve locally");
          if (boundPanel) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.ok(boundPanel, "Bound challenge panel missing before mutation");
        const expressions = {
          csrf: 'document.querySelector("input[name=csrf]").value="public-fixture-replaced-csrf"',
          image: 'document.querySelector("img").src += "?replacement=1"',
          "selected-host":
            'document.querySelector("input[name=selected_host]").value="ddownload.com"',
        };
        await evaluate(session, expressions[scenario]);
        await waitClick(session, "Solve locally");
      }
      let observed = [];
      const refusalDeadline = Date.now() + 45000;
      do {
        observed = (await command("Accessibility.getFullAXTree", {}, session)).nodes
          .filter((n) => !n.ignored)
          .map((n) => ({ role: n.role?.value, name: n.name?.value }));
        const finished = scenario === "cancel"
          ? !observed.some((n) => n.role === "dialog" && n.name === "Image challenge")
          : observed.some((n) => n.name === "Unsupported or expired challenge. Complete it in the page.");
        if (finished) break;
        assert.equal(fixture.submits.length, 0, "Stale/cancelled challenge submitted during refusal wait");
        await new Promise((r) => setTimeout(r, 200));
      } while (Date.now() < refusalDeadline);
      await writeFile(resolve(root,"observed-controls.json"),JSON.stringify(observed,null,2));
      if (scenario === "cancel")
        assert(
          !observed.some(
            (n) => n.role === "dialog" && n.name === "Image challenge",
          ),
        );
      else
        assert(
          observed.some(
            (n) =>
              n.name ===
                "Unsupported or expired challenge. Complete it in the page.",
          ),
          "No explicit stale refusal",
        );
      assert.equal(
        fixture.submits.length,
        0,
        "Stale/cancelled challenge submitted",
      );
      const jobs = call("list").jobs;
      assert(
        jobs.every((j) => j.state === "waiting_user" && j.bytes === 0),
        "Negative path started transfer",
      );
      rows.push({
        scenario,
        provider,
        original_submissions: fixture.submits.length,
        job_states: jobs.map((j) => j.state),
        observed,
      });
      break;
    }
    await waitClick(session, "Solve locally");
    console.log("Local solve invoked for " + provider);
    await command("Target.detachFromTarget", { sessionId: session });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const urls = (await command("Target.getTargets")).targetInfos;
      if (
        urls.find((t) => t.targetId === tab.targetId)?.url.endsWith("/submit")
      )
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log("Form result ", JSON.stringify(fixture.submits));
    await evaluate(optionsSession,"chrome.runtime.sendMessage("+JSON.stringify({type:"navigation_queue_continue",id:job.id})+")");
    const currentTreeSession = await targetSession(tab.targetId);
    const {objectId,tree} = await currentContinue(currentTreeSession,provider);
    await command("Runtime.callFunctionOn",{
      objectId,
      functionDeclaration:'function(){const observe=()=>{const root=this.getRootNode();return {connected:this.isConnected,disabled:this.disabled,selected:[...root.querySelectorAll("input[type=radio]")].some(input=>input.isConnected&&!input.disabled&&input.checked),stale:root.textContent.includes("Page changed. Refresh the selection.")}};const trace={prepared:observe()};globalThis.__navChallengeControlTrace=trace;globalThis.__navChallengeActivate=()=>{trace.activated=observe();if(!trace.activated.connected||trace.activated.disabled||!trace.activated.selected||trace.activated.stale){trace.refused=true;return trace}this.click();trace.clicked=true;return trace};return trace.prepared}',
      returnByValue:true,
    },currentTreeSession);
    await command("Target.detachFromTarget", {sessionId:currentTreeSession});
    const activation = await evaluate(optionsSession,'(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url==='+JSON.stringify(page.replace("/page","/submit"))+');if(!tab)throw Error("Fresh result tab missing");const result=await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:()=>{const activate=globalThis.__navChallengeActivate;delete globalThis.__navChallengeActivate;if(typeof activate!=="function")throw Error("Prepared actual Continue missing");return activate()}});return result[0]?.result})()');
    controlObservations.push({provider,action:"after debugger detach activation",trace:activation});
    assert(activation?.clicked&&!activation.refused&&activation.activated.connected&&!activation.activated.disabled&&activation.activated.selected&&!activation.activated.stale,"Actual Continue became stale or disabled before activation");
    assert(
      fixture.submits.some((s) => s.provider === provider && s.accepted),
      "Original challenge form did not submit: " +
        JSON.stringify(
          tree
            .filter((n) => !n.ignored && n.role?.value === "status")
            .map((n) => n.name?.value),
        ),
    );

    let complete;
    const completionDeadline = Date.now() + 60000;
    while (Date.now() < completionDeadline) {
      const current = call("list").jobs.find((j) => j.id === job.id);
      if (current?.state === "complete") {
        complete = current;
        break;
      }
      if (current?.state === "failed") throw Error(current.error);
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!complete)
      throw Error(
        "Production worker/native completion missing for " +
          provider +
          ": " +
          JSON.stringify({
            diagnostics: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"diagnostics"})',
            ),
            settings: await evaluate(
              optionsSession,
              'chrome.storage.local.get("settings")',
            ),
            capture: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"capture_status"})',
            ),
            jobs: call("list").jobs.map((j) => ({
              state: j.state,
              error: j.error,
              nav: j.navigation_url,
            })),
            snapshot: await evaluate(
              optionsSession,
              'chrome.runtime.sendMessage({type:"snapshot"})',
            ),
          }),
      );
    assert.equal(fixture.requests.filter(request=>request.method==="POST"&&request.path==="/nav-challenges/"+provider+"/submit").length,1,"Expected one original challenge POST for "+provider);
    assert(complete.destination.startsWith(output));
    const bytes = await readFile(complete.destination);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expectedHash,
    );
    assert.equal(complete.page_url, page);
    assert.equal(complete.selected_host, "gofile.io");
    rows.push({
      provider,
      selected_host: complete.selected_host,
      bytes: bytes.length,
      sha256: expectedHash,
      state: complete.state,
      claim_generation: complete.navigation_scope.claim_generation,
      source_generation: complete.source_generation,
    });
    console.log("Verified production challenge " + provider);
  }
  assert.equal(
    fixture.submits.filter((s) => s.accepted).length,
    scenario === "fresh" ? 4 : 0,
  );
  const evidence = {
    source_revision: sourceRevision,
    driver_sha256: driverHash,
    source_graph: await Promise.all(
      Object.keys(buildResult.metafile.inputs)
        .sort()
        .map(async (path) => ({
          path,
          sha256: createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        })),
    ),
    native_build_revision: "3b808ae1967a210fc5b3a3e461488b9f2ab6cb61",
    native_hashes: nativeHashes,
    fixture: "production-installed-challenges-v1",
    browser: version.product,
    os: process.platform,
    arch: process.arch,
    native_version: call("diagnostics").version,
    native_binary_sha256: createHash("sha256")
      .update(await readFile(service))
      .digest("hex"),
    diagnostic_source_changes: false,
    rows,
    control_observations: controlObservations,
    scenario,
    request_counts: fixture.requests.reduce((counts,r)=>{const key=r.method+" "+r.path;counts[key]=(counts[key]??0)+1;return counts},{}),
    accepted_original_submissions: fixture.submits.filter((s) => s.accepted)
      .length,
    paid_calls: 0,
    limits: [
      "Synthetic open-circle protocol only; live providers/accounts and paid provider pending",
      "Pregranted loopback permissions and unique fixture native host name; production worker/resolver/modules otherwise unchanged",
      "Host choice, local solve, actual stale-preview Refresh and radio use AX/Input with bounded readiness checks. The current connected enabled selected Continue element is activated through a guarded page closure after driver detachment; no response bytes travel through CDP",
      "The trusted extension Continue action resumes the fresh HTML page before preview; native desktop window and unavailable browser/platform matrix remain pending",
    ],
  };
  await writeFile(
    resolve(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(
    ".local/nav-challenges/installed-result.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await writeFile(
    resolve(root, "failure.json"),
    JSON.stringify(
      {
        source_revision: sourceRevision,
        error: String(error),
        stack: error.stack,
        submits: fixture.submits,
        control_observations: controlObservations,
      },
      null,
      2,
    ),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  if (ws) {
    await command("Browser.close").catch(() => {});
    ws.close();
  }
  browserProc?.kill();
  try {
    call("quit");
  } catch {}
  daemon.kill();
  await fixture.close();
  await require("esbuild").stop();
  // Exactly the unique fixture-created key; no user native host registration is altered.
  execFileSync("reg", ["DELETE", registry, "/f"], {
    windowsHide: true,
    stdio: "ignore",
  });
}

await require("esbuild").stop();
