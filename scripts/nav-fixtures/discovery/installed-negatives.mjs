// Installed production discovery negatives; only the native host address is substituted.
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const sourceRoot = process.cwd();
const require = createRequire(
  resolve(sourceRoot, "apps/extension/package.json"),
);
const esbuild = require("esbuild");
const mode = process.env.NAV_DISCOVERY_CASE ?? "cancel";
assert.ok(["cancel", "tab-loss", "auth-expiry"].includes(mode));
const executable =
  process.env.NAV_BROWSER ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const runRoot = resolve(
  ".fixture-streams",
  "discovery-negative-" + randomUUID(),
);
const extension = resolve(runRoot, "extension");
const state = resolve(runRoot, "state");
const downloads = resolve(runRoot, "downloads");
await Promise.all(
  [extension, state, downloads].map((path) => mkdir(path, { recursive: true })),
);
const pair =
  process.env.NAV_NATIVE_PAIR ??
  "C:/Users/gduplessy/code/Downloader/.fixture-streams/native-pairs/3b808ae-0.25.1";
const service = resolve(runRoot, "downloader-service.exe");
const cli = resolve(runRoot, "downloader.exe");
await copyFile(resolve(pair, "downloader-service.exe"), service);
await copyFile(resolve(pair, "downloader.exe"), cli);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha = async (file) => sha(await readFile(file));
assert.equal(
  await fileSha(service),
  "3cbd6aa2c7d65e2c4aeaabd83afed64d86e838d2c898fd8f63cb1083804056f2",
);
assert.equal(
  await fileSha(cli),
  "43094f64f3379c39cd24c0e3358df77d0931afa9dd81a80a9550d16e57787e0c",
);
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
}).trim();
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");
let extensionId = [
  ...createHash("sha256")
    .update(Buffer.from(key, "base64"))
    .digest()
    .subarray(0, 16),
]
  .map((n) => String.fromCharCode(97 + (n >> 4), 97 + (n & 15)))
  .join("");
const host = "org.downloader.fixture_" + randomUUID().replaceAll("-", "");
const entryPoints = ["background", "resolver", "discovery", "content"].map(
  (name) => resolve(sourceRoot, "apps/extension/src/" + name + ".ts"),
);
const built = await esbuild.build({
  absWorkingDir: sourceRoot,
  entryPoints,
  outdir: extension,
  metafile: true,
  bundle: true,
  format: "iife",
  target: "es2022",
  define: { BROWSER: JSON.stringify("chromium") },
  plugins: [
    {
      name: "isolated-native-address",
      setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, "utf8")).replaceAll(
            "org.downloader.native",
            host,
          ),
          loader: "ts",
          resolveDir: resolve(path, ".."),
        }));
      },
    },
  ],
});
const productionInputs = Object.keys(built.metafile.inputs).filter(
  (path) => !path.replaceAll("\\", "/").includes("node_modules/"),
);
const productionSourceHashes = Object.fromEntries(
  await Promise.all(
    productionInputs.map(async (path) => [
      relative(sourceRoot, resolve(sourceRoot, path)).replaceAll("\\", "/"),
      await fileSha(resolve(sourceRoot, path)),
    ]),
  ),
);
assert.ok(
  Object.keys(productionSourceHashes).includes(
    "apps/extension/src/navigation/discovery/runtime.ts",
  ),
);
await writeFile(
  resolve(extension, "options.html"),
  "<!doctype html><title>Isolated discovery driver</title>",
);
await writeFile(
  resolve(extension, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    key,
    name: "Downloader discovery qualification",
    version: "0.1.0",
    permissions: [
      "downloads",
      "nativeMessaging",
      "storage",
      "contextMenus",
      "activeTab",
      "alarms",
      "cookies",
      "webRequest",
      "scripting",
      "tabs",
      "notifications",
      "debugger",
    ],
    host_permissions: ["http://127.0.0.1/*"],
    background: { service_worker: "background.js" },
    options_ui: { page: "options.html", open_in_tab: true },
  }),
);
const nativeManifest = resolve(runRoot, "native.json");
async function registration() {
  await writeFile(
    nativeManifest,
    JSON.stringify({
      name: host,
      description: "Isolated discovery qualification",
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
const registry =
  (/msedge/i.test(executable)
    ? "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\"
    : "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\") + host;
const requests = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fixture");
  const authenticated = /fixture_auth=1/.test(req.headers.cookie ?? "");
  requests.push({ method: req.method, path: url.pathname, authenticated });
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/login") {
    res.setHeader("Set-Cookie", "fixture_auth=1; Path=/; SameSite=Lax");
    res.writeHead(303, { Location: "/nav-adapters/gofile/project" });
    res.end();
    return;
  }
  if (url.pathname === "/nav-adapters/gofile/project") {
    res.setHeader("Content-Type", "text/html");
    if (!authenticated) {
      res.end(
        '<!doctype html><title>Sign in</title><input type="password"><a href="/login">Sign in</a>',
      );
      return;
    }
    res.end(
      '<!doctype html><title>Discovery fixture</title><div aria-busy="true" id="busy">Rendering</div><script>setTimeout(()=>{const a=document.createElement("a");a.href="/original-resource.bin";a.textContent="Fixture resource";document.body.append(a);document.querySelector("#busy").remove()},7000)</script>',
    );
    return;
  }
  if (url.pathname === "/original-resource.bin") {
    res.writeHead(409);
    res.end("A negative discovery case must not probe this resource");
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end("<!doctype html><title>Retained user page</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const env = { ...process.env, DOWNLOADER_DATA_DIR: state };
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
daemon.stderr.on("data", (chunk) => {
  daemonError += chunk;
});
async function until(operation, message, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await operation();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error(message + " " + JSON.stringify(last));
}
await until(
  async () => {
    try {
      return call("settings");
    } catch {
      return null;
    }
  },
  "Native service unavailable: " + daemonError,
  30000,
);
const settings = call("settings");
const settingsValue = settings.settings ?? settings;
settingsValue.directory = downloads;
settingsValue.categories = [];
await writeFile(
  resolve(runRoot, "settings.json"),
  JSON.stringify(settingsValue),
);
call("set", resolve(runRoot, "settings.json"));
const projectId = randomUUID();
const project = {
  id: projectId,
  name: "Discovery negative " + mode,
  url: base + "/nav-adapters/gofile/project",
  directory: downloads,
  depth: 1,
  max_pages: 3,
  same_domain: true,
  include: "*.bin",
  exclude: "",
  min_size: 0,
  max_size: null,
  mirror: false,
  rendered: true,
  private: false,
  next_run: null,
};
await writeFile(resolve(runRoot, "project.json"), JSON.stringify(project));
call("grabber", resolve(runRoot, "project.json"));
call("grabber-run", projectId);
execFileSync(
  "reg",
  ["ADD", registry, "/ve", "/t", "REG_SZ", "/d", nativeManifest, "/f"],
  { windowsHide: true, stdio: "ignore" },
);
let browserProc,
  ws,
  sequence = 0;
const pending = new Map();
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + " timed out"));
    }, 30000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
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
async function evaluate(sessionId, expression) {
  const response = await command(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (response.exceptionDetails)
    throw Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value;
}
let browserVersion, result, inspectFailure;
try {
  browserProc = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--enable-unsafe-extension-debugging",
      "--user-data-dir=" + resolve(runRoot, "profile"),
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  browserProc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const endpoint = await until(
    async () => {
      try {
        const lines = (
          await readFile(
            resolve(runRoot, "profile", "DevToolsActivePort"),
            "utf8",
          )
        )
          .trim()
          .split(/\r?\n/);
        return "ws://127.0.0.1:" + lines[0] + lines[1];
      } catch {}
      return stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
    },
    "Browser did not start",
    30000,
  );
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    message.error
      ? waiter?.reject(Error(message.error.message))
      : waiter?.resolve(message.result);
  };
  ws.onclose = () => {
    for (const waiter of pending.values())
      waiter.reject(Error("Fixture browser closed"));
    pending.clear();
  };
  browserVersion = await command("Browser.getVersion");
  const loaded = await command("Extensions.loadUnpacked", { path: extension });
  if (loaded.id && loaded.id !== extensionId) {
    extensionId = loaded.id;
    await registration();
  }
  const options = await command("Target.createTarget", {
    url: "chrome-extension://" + extensionId + "/options.html",
  });
  const optionsSession = (
    await command("Target.attachToTarget", {
      targetId: options.targetId,
      flatten: true,
    })
  ).sessionId;
  await until(
    async () =>
      evaluate(
        optionsSession,
        'location.protocol==="chrome-extension:" && typeof chrome.storage?.local?.get==="function"',
      ),
    "Extension driver not ready",
    15000,
  );
  const page = (expression) => evaluate(optionsSession, expression);
  const message = (value) =>
    page("chrome.runtime.sendMessage(" + JSON.stringify(value) + ")");
  const native = async (command, args) => {
    const id = randomUUID();
    const response = await page(
      "chrome.runtime.sendNativeMessage(" +
        JSON.stringify(host) +
        "," +
        JSON.stringify({ version: 1, id, command, args }) +
        ")",
    );
    assert.equal(response.id, id);
    assert.equal(response.version, 1);
    if (!response.ok)
      throw Error(response.error?.message ?? JSON.stringify(response));
    return response.data;
  };
  const record = () =>
    page(
      "chrome.storage.local.get(" +
        JSON.stringify("discovery-" + projectId) +
        ").then(x=>x[" +
        JSON.stringify("discovery-" + projectId) +
        "])",
    );
  await message({ type: "settings_changed" });
  const pollAlarm = await page('chrome.alarms.get("resolver-poll")');
  assert.ok(
    pollAlarm,
    "Production discovery polling alarm must exist before activation",
  );
  assert.equal(pollAlarm.periodInMinutes, 0.5);
  console.log("Production polling alarm verified");
  inspectFailure = async () => ({
    record: await record(),
    alarms: await page("chrome.alarms.getAll()"),
    tabs: await page(
      "chrome.tabs.query({}).then(tabs=>tabs.map(tab=>({id:tab.id,url:tab.url,status:tab.status,windowId:tab.windowId})))",
    ),
  });
  const userTab = await page(
    "chrome.tabs.create({url:" +
      JSON.stringify(base + "/user-origin") +
      ",active:false})",
  );
  const sourceTab = await page(
    "chrome.tabs.create({url:" +
      JSON.stringify(base + "/login") +
      ",active:false})",
  );
  await until(
    async () => {
      const tab = await page("chrome.tabs.get(" + sourceTab.id + ")");
      return tab.status === "complete" && tab.url === project.url;
    },
    "Authenticated source page not ready",
    30000,
  );
  if (mode === "auth-expiry")
    await page(
      "chrome.cookies.remove({url:" +
        JSON.stringify(base + "/") +
        ',name:"fixture_auth"})',
    );
  await message({
    type: "discovery_start",
    id: projectId,
    tabId: sourceTab.id,
    permittedOrigins: [],
  });
  const initial = await until(async () => {
    const row = await record();
    return row?.tabId >= 0 ? row : null;
  }, "Production discovery record missing");
  const snapshot = () =>
    native("discovery_status", {
      id: projectId,
      scope: initial.scope,
      generation: initial.generation,
      action: "snapshot",
    });
  const initialState =
    mode === "auth-expiry"
      ? await snapshot()
      : await until(
          async () => {
            const value = await snapshot();
            return value.status === "exploring" && value.lease?.document
              ? value
              : null;
          },
          "Production document was not enrolled before interruption",
          15000,
        );
  assert.ok(
    mode === "auth-expiry"
      ? ["exploring", "authentication_required"].includes(initialState.status)
      : initialState.status === "exploring",
  );
  assert.equal(initialState.resources.length, 0);
  console.log("Enrolled discovery scope; starting " + mode);
  if (mode === "cancel") {
    const cancelled = await native("discovery_status", {
      id: projectId,
      scope: initial.scope,
      generation: initial.generation,
      action: "cancel",
    });
    assert.equal(cancelled.status, "cancelled");
    await until(
      async () => !(await record()),
      "Production cancellation did not remove persisted record",
      65000,
    );
    assert.equal(
      await page(
        "chrome.tabs.get(" + initial.tabId + ").then(()=>true,()=>false)",
      ),
      false,
    );
    const status = await snapshot();
    assert.equal(status.status, "cancelled");
    assert.equal(status.resources.length, 0);
    result = {
      cancelled: true,
      recordRemoved: true,
      ownedTabClosed: true,
      status: status.status,
      generation: status.generation,
    };
  } else if (mode === "tab-loss") {
    await page("chrome.tabs.remove(" + initial.tabId + ")");
    const replacement = await until(
      async () => {
        const row = await record();
        return row?.tabId >= 0 && row.tabId !== initial.tabId ? row : null;
      },
      "Owned tab loss did not recover the original frontier",
      65000,
    );
    assert.deepEqual(replacement.scope, initial.scope);
    assert.equal(replacement.sourceTabId, sourceTab.id);
    const status = await until(
      async () => {
        const value = await snapshot();
        return value.status === "ready" ? value : null;
      },
      "Recovered frontier did not become ready",
      30000,
    );
    assert.equal(status.resources.length, 1);
    assert.equal(status.resources[0].url, base + "/original-resource.bin");
    result = {
      ownedTabReplaced: true,
      exactScopePreserved: true,
      resourceCount: 1,
      status: status.status,
    };
  } else {
    const expired = await until(
      async () => {
        const value = await snapshot();
        return value.status === "authentication_required" ? value : null;
      },
      "Expired session did not surface authentication requirement",
      30000,
    );
    const retained = await record();
    assert.equal(retained.tabId, initial.tabId);
    assert.equal(expired.resources.length, 0);
    const authenticationTab = await page(
      "chrome.tabs.get(" + retained.tabId + ")",
    );
    assert.equal(authenticationTab.active, true);
    await page(
      "chrome.tabs.update(" +
        retained.tabId +
        ",{url:" +
        JSON.stringify(base + "/login") +
        "})",
    );
    const status = await until(
      async () => {
        const value = await snapshot();
        return value.status === "ready" ? value : null;
      },
      "Same-session login did not resume the original frontier",
      30000,
    );
    assert.equal(status.resources.length, 1);
    assert.deepEqual(status.scope, initial.scope);
    result = {
      authenticationRequired: true,
      activeOwnedTabRetained: true,
      sameScopeLoginRecovered: true,
      resourceCount: 1,
      status: status.status,
    };
  }
  assert.ok(
    await page(
      "chrome.tabs.get(" + sourceTab.id + ").then(()=>true,()=>false)",
    ),
  );
  assert.ok(
    await page("chrome.tabs.get(" + userTab.id + ").then(()=>true,()=>false)"),
  );
  assert.equal(
    requests.filter((request) => request.path === "/original-resource.bin")
      .length,
    0,
  );
  assert.equal(
    requests.filter((request) => request.method === "HEAD").length,
    0,
  );
  assert.equal(call("list").jobs.length, 0);
  const evidence = {
    result: "passed",
    case: mode,
    browser: browserVersion.product,
    os: process.platform,
    architecture: process.arch,
    sourceRevision,
    nativeBuildRevision: "3b808ae1967a210fc5b3a3e461488b9f2ab6cb61",
    nativeVersion: "0.25.1",
    nativeBinarySha256: await fileSha(service),
    cliBinarySha256: await fileSha(cli),
    fixtureSha256: await fileSha(import.meta.filename),
    productionSourceHashes,
    backgroundBundleSha256: await fileSha(resolve(extension, "background.js")),
    productionRuntimeUnchanged: true,
    nativeAddressOnlySubstitution: true,
    fixtureWorkerWakeInterval: false,
    productionPollAlarmVerified: true,
    initialActivation:
      "Trusted extension-page discovery_start using actual original tab metadata",
    cancellationBoundary:
      mode === "cancel"
        ? "Actual allowlisted native discovery_status from isolated extension page; desktop Cancel UI remains pending"
        : null,
    userOriginTabRetained: true,
    unrelatedUserTabRetained: true,
    payloadRequests: 0,
    headRequests: 0,
    createdJobs: 0,
    observations: result,
    requests,
    limitations: [
      "Local synthetic pages only; live providers/accounts and paid calls remain deferred",
      "Pregranted loopback permissions; native permission prompts are not qualified",
      "No desktop/native ComputerUse or owner GUI acceptance from this fixture",
      "Firefox and other platform lanes require separate qualification",
    ],
  };
  await writeFile(
    resolve(runRoot, "evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const actual = await inspectFailure?.().catch((error) => ({
    inspectionError: String(error),
  }));
  await writeFile(
    resolve(runRoot, "failure.json"),
    JSON.stringify(
      {
        error: String(error),
        mode,
        sourceRevision,
        requests,
        observations: result,
        actual,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  try {
    if (ws?.readyState === WebSocket.OPEN)
      await command("Browser.close").catch(() => {});
    ws?.close();
    browserProc?.kill();
    try {
      call("quit");
    } catch {}
    daemon.kill();
    await new Promise((resolve) => server.close(resolve));
    execFileSync("reg", ["DELETE", registry, "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } finally {
    esbuild.stop();
  }
}
