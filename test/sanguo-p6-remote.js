/* P6 RemoteStore verification (SANGUO-DESIGN.md §5.2, §5.4, §5.5).

   A deterministic in-page fetch endpoint exercises the real classic-script
   modules without a cloud account or wall-clock sleeps. It covers the Store
   contract, bearer auth, ETag conflicts, bounded retry/backoff, defensive
   response handling, and SaveManager's local mirror/out-of-sync seam.

   Run: node test/sanguo-p6-remote.js
        node test/sanguo-p6-remote.js --headed */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const HEADED = process.argv.includes("--headed");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, { actual, expected });
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch(HEADED ? { headless: false, channel: "chrome" } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("weberror", (error) => errors.push(String(error.error())));

  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });

  const result = await page.evaluate(async () => {
    function makeEndpoint() {
      const endpoint = {
        entries: new Map(),
        log: [],
        faults: [],
        offline: false,
      };

      endpoint.force = (key, body) => {
        const old = endpoint.entries.get(key);
        endpoint.entries.set(key, { body: String(body), version: old ? old.version + 1 : 1 });
      };

      endpoint.fetch = async (url, init) => {
        const request = init || {};
        const headers = new Headers(request.headers || {});
        const u = new URL(url);
        endpoint.log.push({
          method: request.method || "GET",
          path: u.pathname + u.search,
          authorization: headers.get("Authorization"),
          ifMatch: headers.get("If-Match"),
          body: request.body === undefined ? null : String(request.body),
        });

        if (endpoint.offline) throw new TypeError("mock network offline");
        const fault = endpoint.faults.length ? endpoint.faults.shift() : null;
        if (fault === "network") throw new TypeError("mock network fault");
        if (fault === "invalid-response") return { nope: true };
        if (fault === "bad-text") {
          return {
            status: 200,
            ok: true,
            headers: new Headers(),
            text: async () => {
              throw new Error("body stream failed");
            },
          };
        }
        if (typeof fault === "number") {
          return new Response("mock " + fault, { status: fault });
        }

        const root = "/api/saves";
        if (u.pathname === root) {
          const prefix = u.searchParams.get("prefix") || "";
          const keys = Array.from(endpoint.entries.keys()).filter((key) => key.startsWith(prefix));
          return new Response(JSON.stringify(keys), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!u.pathname.startsWith(root + "/")) return new Response("not found", { status: 404 });

        const key = decodeURIComponent(u.pathname.slice((root + "/").length));
        const current = endpoint.entries.get(key);
        const tag = current ? '"v' + current.version + '"' : null;
        if ((request.method || "GET") === "GET") {
          if (!current) return new Response("not found", { status: 404 });
          return new Response(current.body, { status: 200, headers: { ETag: tag } });
        }
        if (request.method === "PUT") {
          const match = headers.get("If-Match");
          if (match && match !== tag) {
            return new Response("conflict", {
              status: 412,
              headers: tag ? { ETag: tag } : {},
            });
          }
          const next = { body: String(request.body), version: current ? current.version + 1 : 1 };
          endpoint.entries.set(key, next);
          return new Response(null, {
            status: 204,
            headers: { ETag: '"v' + next.version + '"' },
          });
        }
        if (request.method === "DELETE") {
          if (!current) return new Response("not found", { status: 404 });
          const match = headers.get("If-Match");
          if (match && match !== tag) {
            return new Response("conflict", { status: 412, headers: { ETag: tag } });
          }
          endpoint.entries.delete(key);
          return new Response(null, { status: 204 });
        }
        return new Response("method", { status: 405 });
      };
      return endpoint;
    }

    const auth = {
      deviceId: "mock-device",
      calls: 0,
      async getToken() {
        this.calls++;
        return "token-123";
      },
    };
    const out = {};

    /* Store contract + bearer + versions. */
    const endpoint = makeEndpoint();
    const store = new ZS.RemoteStore("https://mock.invalid/api/", {
      auth,
      fetch: endpoint.fetch,
      sleep: async () => {},
    });
    const weirdKey = "hsg:v1:slot:a/b c";
    out.capabilities = store.capabilities;
    out.missing = await store.get(weirdKey);
    await store.set(weirdKey, "one");
    out.first = await store.get(weirdKey);
    await store.set(weirdKey, "two");
    await store.set("hsg:v1:slot:z", "z");
    await store.set("hsg:v1:slot:a", "a");
    out.keys = await store.keys("hsg:v1:slot:");
    await store.remove(weirdKey);
    out.afterRemove = await store.get(weirdKey);
    out.contractLog = endpoint.log;
    out.authCalls = auth.calls;

    /* Two clients race from the same ETag. */
    const races = makeEndpoint();
    const raceA = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      fetch: races.fetch,
      sleep: async () => {},
    });
    const raceB = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      fetch: races.fetch,
      sleep: async () => {},
    });
    await raceA.set("race", "v1");
    await raceA.get("race");
    await raceB.get("race");
    await raceA.set("race", "winner");
    const beforeConflict = races.log.length;
    try {
      await raceB.set("race", "loser");
      out.conflict = "none";
    } catch (error) {
      out.conflict = error.code;
      out.conflictName = error.name;
      out.conflictStatus = error.status;
      out.conflictEtag = error.etag;
    }
    out.conflictAttempts = races.log.length - beforeConflict;
    out.raceWinner = races.entries.get("race").body;

    /* Retries use an injected clock: exact delays, no final sleep. */
    const retryDelays = [];
    let retryAttempts = 0;
    const retryStore = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      retries: 4,
      backoffMs: 7,
      maxBackoffMs: 20,
      sleep: async (ms) => retryDelays.push(ms),
      fetch: async () => {
        retryAttempts++;
        if (retryAttempts < 4) return new Response("later", { status: 503 });
        return new Response("ready", { status: 200 });
      },
    });
    out.retryValue = await retryStore.get("retry");
    out.retryAttempts = retryAttempts;
    out.retryDelays = retryDelays;

    const networkDelays = [];
    let networkAttempts = 0;
    const networkStore = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      retries: 2,
      backoffMs: 9,
      sleep: async (ms) => networkDelays.push(ms),
      fetch: async () => {
        networkAttempts++;
        throw new TypeError("offline");
      },
    });
    try {
      await networkStore.get("network");
    } catch (error) {
      out.networkCode = error.code;
      out.networkName = error.name;
    }
    out.networkAttempts = networkAttempts;
    out.networkDelays = networkDelays;

    let serverAttempts = 0;
    const serverStore = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      retries: 3,
      backoffMs: 0,
      sleep: async () => {},
      fetch: async () => {
        serverAttempts++;
        return new Response("down", { status: 502 });
      },
    });
    try {
      await serverStore.get("server");
    } catch (error) {
      out.serverCode = error.code;
      out.serverStatus = error.status;
    }
    out.serverAttempts = serverAttempts;

    let clientAttempts = 0;
    const clientStore = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      retries: 4,
      sleep: async () => {},
      fetch: async () => {
        clientAttempts++;
        return new Response("bad", { status: 400 });
      },
    });
    try {
      await clientStore.get("client");
    } catch (error) {
      out.clientCode = error.code;
      out.clientStatus = error.status;
    }
    out.clientAttempts = clientAttempts;

    async function errorCode(fetch) {
      const candidate = new ZS.RemoteStore("https://mock.invalid/api", {
        auth,
        fetch,
        sleep: async () => {},
      });
      try {
        await candidate.keys("hsg:");
        return "none";
      } catch (error) {
        return error.code;
      }
    }
    out.badJson = await errorCode(async () => new Response("{", { status: 200 }));
    out.badIndex = await errorCode(
      async () => new Response(JSON.stringify(["ok", 7]), { status: 200 }),
    );
    out.badResponse = await errorCode(async () => ({ nope: true }));
    out.badBody = await errorCode(async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => {
        throw new Error("stream");
      },
    }));

    /* SaveManager remains backend-agnostic. */
    const manager = ZS.SaveManager;
    const originalStore = manager.store;
    const originalAuth = manager.auth;
    const originalFallback = manager.fallbackStore;
    let probe = "initial";
    manager.register("p6Probe", {
      capture: () => ({ probe }),
      apply: (data) => {
        probe = data.probe;
      },
    });

    const saveEndpoint = makeEndpoint();
    const saveRemote = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      fetch: saveEndpoint.fetch,
      sleep: async () => {},
    });
    const saveFallback = new ZS.MemoryStore();
    manager.bind(saveRemote, auth, { fallbackStore: saveFallback });
    probe = "cloud-round-trip";
    await manager.save("cloud");
    probe = "mutated";
    await manager.load("cloud");
    out.saveProbe = probe;
    out.saveHas = await manager.has("cloud");
    out.saveSlots = (await manager.listSlots()).map((slot) => slot.slot);
    out.remoteSaveKeys = Array.from(saveEndpoint.entries.keys())
      .filter((key) => key.startsWith("hsg:v1:slot:cloud"))
      .sort();
    out.mirrorHas = (await saveFallback.get("hsg:v1:slot:cloud")) !== null;
    out.saveInSync = manager.cloudOutOfSync;
    await manager.deleteSlot("cloud");
    out.deletedRemote = saveEndpoint.entries.has("hsg:v1:slot:cloud");
    out.deletedMirror = await saveFallback.keys("hsg:v1:slot:cloud");

    /* A failed cloud save is durable locally and wins over stale cloud state
       until an explicit later save succeeds. */
    const offlineEndpoint = makeEndpoint();
    const offlineDelays = [];
    const offlineRemote = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      fetch: offlineEndpoint.fetch,
      retries: 3,
      backoffMs: 2,
      sleep: async (ms) => offlineDelays.push(ms),
    });
    const offlineFallback = new ZS.MemoryStore();
    manager.bind(offlineRemote, auth, { fallbackStore: offlineFallback });
    probe = "cloud-before-outage";
    await manager.save("offline");
    await new Promise((resolve) => setTimeout(resolve, 5));
    offlineEndpoint.offline = true;
    probe = "saved-offline";
    const attemptsBeforeOfflineSave = offlineEndpoint.log.length;
    await manager.save("offline");
    out.offlineAttempts = offlineEndpoint.log.length - attemptsBeforeOfflineSave;
    out.offlineDelays = offlineDelays.slice();
    out.offlineFlag = manager.cloudOutOfSync;
    out.offlineCode = manager.lastCloudError && manager.lastCloudError.code;
    out.offlineLocal = (await offlineFallback.get("hsg:v1:slot:offline")) !== null;
    probe = "mutated";
    const callsBeforeLocalLoad = offlineEndpoint.log.length;
    await manager.load("offline");
    out.offlineLoaded = probe;
    out.offlineLoadCloudCalls = offlineEndpoint.log.length - callsBeforeLocalLoad;
    out.offlineSlots = (await manager.listSlots()).map((slot) => slot.slot);

    /* bind() state is transient, but the mirrored snapshot survives a reload.
       Comparing updatedAt keeps newer offline progress ahead of stale cloud. */
    offlineEndpoint.offline = false;
    const reboundRemote = new ZS.RemoteStore("https://mock.invalid/api", {
      auth,
      fetch: offlineEndpoint.fetch,
      retries: 3,
      backoffMs: 2,
      sleep: async (ms) => offlineDelays.push(ms),
    });
    manager.bind(reboundRemote, auth, { fallbackStore: offlineFallback });
    probe = "mutated-after-rebind";
    await manager.load("offline");
    out.reboundLoaded = probe;
    out.reboundFlag = manager.cloudOutOfSync;
    out.reboundCode = manager.lastCloudError && manager.lastCloudError.code;

    probe = "uploaded-later";
    await manager.save("offline");
    out.recoveredFlag = manager.cloudOutOfSync;
    out.recoveredRemote = JSON.parse(
      offlineEndpoint.entries.get("hsg:v1:slot:offline").body,
    ).p6Probe.probe;

    /* An external update invalidates our cached version. SaveManager must
       surface the conflict and leave the local mirror untouched. */
    const mirrorBeforeConflict = await offlineFallback.get("hsg:v1:slot:offline");
    offlineEndpoint.force("hsg:v1:slot:offline", mirrorBeforeConflict);
    const conflictLogStart = offlineEndpoint.log.length;
    probe = "must-not-win";
    try {
      await manager.save("offline");
      out.managerConflict = "none";
    } catch (error) {
      out.managerConflict = error.code;
    }
    out.managerConflictAttempts = offlineEndpoint.log.length - conflictLogStart;
    out.managerConflictFlag = manager.cloudOutOfSync;
    out.managerConflictMirror = JSON.parse(
      await offlineFallback.get("hsg:v1:slot:offline"),
    ).p6Probe.probe;

    /* If neither cloud nor fallback can answer, load must retain the network
       diagnosis instead of pretending that the slot is absent. */
    const emptyFallback = new ZS.MemoryStore();
    offlineEndpoint.offline = true;
    manager.bind(reboundRemote, auth, { fallbackStore: emptyFallback });
    try {
      await manager.load("unknown");
      out.emptyFallbackCode = "none";
    } catch (error) {
      out.emptyFallbackCode = error.code;
    }
    out.emptyFallbackFlag = manager.cloudOutOfSync;
    offlineEndpoint.offline = false;

    /* Atomic MemoryStore never creates these rungs, but deleteSlot retains
       the original contract and clears them if an older caller left them. */
    const memoryPrimary = new ZS.MemoryStore();
    await memoryPrimary.set("hsg:v1:slot:memory", "main");
    await memoryPrimary.set("hsg:v1:slot:memory:shadow", "shadow");
    await memoryPrimary.set("hsg:v1:slot:memory:bak", "bak");
    manager.bind(memoryPrimary, auth);
    await manager.deleteSlot("memory");
    out.memoryDeleteKeys = await memoryPrimary.keys("hsg:v1:slot:memory");

    /* Omitting an explicit fallback selects LocalStore when this origin
       supports it; local and memory primary bindings remain unchanged. */
    manager.bind(reboundRemote, auth);
    out.autoFallback = manager.fallbackStore && manager.fallbackStore.name;
    manager.sections.delete("p6Probe");
    manager.bind(originalStore, originalAuth, { fallbackStore: originalFallback });
    return out;
  });

  console.log("\n[contract]");
  eq("RemoteStore advertises cloud storage", result.capabilities.cloud, true);
  eq("RemoteStore advertises atomic PUTs", result.capabilities.atomic, true);
  eq("RemoteStore has no client-side quota", result.capabilities.quotaBytes, null);
  eq("GET missing resolves to null", result.missing, null);
  eq("PUT then GET round-trips an opaque string", result.first, "one");
  eq("DELETE makes the key absent", result.afterRemove, null);
  eq(
    "keys(prefix) is sorted and scoped",
    JSON.stringify(result.keys),
    JSON.stringify(["hsg:v1:slot:a", "hsg:v1:slot:a/b c", "hsg:v1:slot:z"]),
  );
  ok(
    "every request carries Auth's bearer token",
    result.contractLog.every((entry) => entry.authorization === "Bearer token-123"),
    result.contractLog,
  );
  ok("Auth.getToken is consulted per request", result.authCalls >= result.contractLog.length);
  ok(
    "path keys are URI encoded",
    result.contractLog.some((entry) => entry.path.includes("a%2Fb%20c")),
    result.contractLog,
  );
  ok(
    "a cached ETag is sent on overwrite",
    result.contractLog.some((entry) => entry.method === "PUT" && entry.ifMatch === '"v1"'),
    result.contractLog,
  );
  ok(
    "a cached ETag is sent on delete",
    result.contractLog.some((entry) => entry.method === "DELETE" && entry.ifMatch === '"v2"'),
    result.contractLog,
  );

  console.log("\n[conflict + failures]");
  eq("stale If-Match surfaces conflict", result.conflict, "conflict");
  eq("conflicts use the typed RemoteStore error", result.conflictName, "RemoteStoreError");
  eq("conflicts retain HTTP status", result.conflictStatus, 412);
  eq("conflicts expose the current server ETag", result.conflictEtag, '"v2"');
  eq("conflicts are never retried", result.conflictAttempts, 1);
  eq("the rejected writer cannot overwrite the winner", result.raceWinner, "winner");
  eq("a transient server response eventually returns its body", result.retryValue, "ready");
  eq("retry count is bounded by the configured attempts", result.retryAttempts, 4);
  eq(
    "exponential backoff is capped",
    JSON.stringify(result.retryDelays),
    JSON.stringify([7, 14, 20]),
  );
  eq("network exhaustion is classified", result.networkCode, "unreachable");
  eq("network errors use the typed error", result.networkName, "RemoteStoreError");
  eq("network retries are bounded", result.networkAttempts, 2);
  eq("there is no sleep after the final attempt", JSON.stringify(result.networkDelays), "[9]");
  eq("5xx exhaustion remains a server error", result.serverCode, "server");
  eq("5xx errors retain status", result.serverStatus, 502);
  eq("5xx retry count is bounded", result.serverAttempts, 3);
  eq("4xx failures are classified", result.clientCode, "http");
  eq("4xx failures retain status", result.clientStatus, 400);
  eq("4xx failures are not retried", result.clientAttempts, 1);
  eq("invalid JSON indexes fail closed", result.badJson, "malformed");
  eq("non-string index entries fail closed", result.badIndex, "malformed");
  eq("invalid response objects fail closed", result.badResponse, "malformed");
  eq("failed body reads fail closed", result.badBody, "malformed");

  console.log("\n[SaveManager]");
  eq("SaveManager round-trips through RemoteStore unchanged", result.saveProbe, "cloud-round-trip");
  eq("SaveManager.has works through RemoteStore", result.saveHas, true);
  eq(
    "SaveManager.listSlots works through RemoteStore",
    JSON.stringify(result.saveSlots),
    '["cloud"]',
  );
  eq(
    "atomic cloud saves create no shadow or backup keys",
    JSON.stringify(result.remoteSaveKeys),
    '["hsg:v1:slot:cloud"]',
  );
  eq("a successful cloud save is mirrored locally", result.mirrorHas, true);
  eq("a successful cloud save is in sync", result.saveInSync, false);
  eq("deleteSlot removes the remote save", result.deletedRemote, false);
  eq("deleteSlot removes the local mirror", result.deletedMirror.length, 0);

  console.log("\n[fallback]");
  eq("an offline cloud save exhausts exactly three attempts", result.offlineAttempts, 3);
  eq(
    "offline retry delays are bounded and omit a final sleep",
    JSON.stringify(result.offlineDelays),
    "[2,4]",
  );
  eq("offline save flags cloud out of sync", result.offlineFlag, true);
  eq("offline save retains the network diagnosis", result.offlineCode, "unreachable");
  eq("offline save is durable in the local fallback", result.offlineLocal, true);
  eq("an unsynced local save loads unchanged", result.offlineLoaded, "saved-offline");
  eq("an unsynced local save never reads stale cloud first", result.offlineLoadCloudCalls, 0);
  eq(
    "listSlots falls back while cloud is offline",
    JSON.stringify(result.offlineSlots),
    '["offline"]',
  );
  eq("new binding keeps newer mirrored progress", result.reboundLoaded, "saved-offline");
  eq("new binding recognizes stale cloud", result.reboundFlag, true);
  eq("stale cloud has an explicit diagnosis", result.reboundCode, "cloud_stale");
  eq("a later successful save clears the out-of-sync flag", result.recoveredFlag, false);
  eq("the later save uploads the local progression", result.recoveredRemote, "uploaded-later");
  eq("SaveManager surfaces ETag conflicts", result.managerConflict, "conflict");
  eq("SaveManager does not retry ETag conflicts", result.managerConflictAttempts, 1);
  eq("a SaveManager conflict flags cloud divergence", result.managerConflictFlag, true);
  eq(
    "a conflict does not overwrite the local mirror",
    result.managerConflictMirror,
    "uploaded-later",
  );
  eq(
    "cloud failure without a local copy is not reported as missing",
    result.emptyFallbackCode,
    "unreachable",
  );
  eq("cloud failure without a local copy still flags status", result.emptyFallbackFlag, true);
  eq("MemoryStore deleteSlot still clears all durability rungs", result.memoryDeleteKeys.length, 0);
  eq("cloud binding auto-selects LocalStore when available", result.autoFallback, "local");

  console.log("\n[console]");
  ok("no unexpected browser errors", errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
