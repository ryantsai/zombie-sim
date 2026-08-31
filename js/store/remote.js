/* ZS.RemoteStore — optional server backing for ZS.Store (docs/SANGUO-DESIGN.md §5.2, §5.5).

   Never required: the game is fully playable with LocalStore forever. This
   exists so switching backends is one line at boot. Wire-up is deliberately
   boring REST:

     GET    <base>/saves/<key>   -> 200 body = the blob, ETag: <version>
                                   404 = absent (resolves to null)
     PUT    <base>/saves/<key>   body = the blob, If-Match: <etag> when known
     DELETE <base>/saves/<key>
     GET    <base>/saves?prefix= -> JSON string[] of keys

   Authorization comes from ZS.Auth.getToken() — an anonymous deviceId token in
   Stage 1, an OAuth bearer in Stage 2. RemoteStore does not care which.

   P6 exercises this against a deterministic mock endpoint. The retry clock is
   injectable so tests never wait in real time, while production keeps a short
   exponential backoff. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const DEFAULT_RETRIES = 3;
  const DEFAULT_BACKOFF_MS = 300;
  const DEFAULT_MAX_BACKOFF_MS = 2400;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  class RemoteStoreError extends Error {
    constructor(code, message, opts) {
      super(message || "store_" + code);
      this.name = "RemoteStoreError";
      this.code = code;
      const o = opts || {};
      if (o.status !== undefined) this.status = o.status;
      if (o.cause) this.cause = o.cause;
      if (o.etag) this.etag = o.etag;
      this.retryable = !!o.retryable;
    }
  }

  function optionInt(value, fallback, lo, hi) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.floor(n)));
  }

  function header(res, name) {
    if (!res || !res.headers) return null;
    if (typeof res.headers.get === "function") return res.headers.get(name);
    const want = name.toLowerCase();
    for (const key in res.headers) {
      if (key.toLowerCase() === want) return res.headers[key];
    }
    return null;
  }

  function validResponse(res) {
    return !!res && typeof res.status === "number" && typeof res.ok === "boolean";
  }

  class RemoteStore {
    constructor(baseUrl, opts) {
      const o = opts || {};
      this.name = "remote";
      this.base = String(baseUrl || "").replace(/\/+$/, "");
      this.auth = o.auth || ZS.Auth;
      this.fetch = o.fetch || (window.fetch && window.fetch.bind(window));
      this.retries = optionInt(o.retries, DEFAULT_RETRIES, 1, 8);
      this.backoffMs = optionInt(o.backoffMs, DEFAULT_BACKOFF_MS, 0, 60000);
      this.maxBackoffMs = optionInt(
        o.maxBackoffMs,
        Math.max(DEFAULT_MAX_BACKOFF_MS, this.backoffMs),
        this.backoffMs,
        60000,
      );
      this.sleep = typeof o.sleep === "function" ? o.sleep : sleep;
      this.etags = new Map();
      this.capabilities = { cloud: true, quotaBytes: null, atomic: true };
    }

    async _headers(extra) {
      const h = { "Content-Type": "text/plain;charset=utf-8" };
      const token = this.auth ? await this.auth.getToken() : null;
      if (token) h.Authorization = "Bearer " + String(token);
      if (extra) Object.assign(h, extra);
      return h;
    }

    _normalizeFailure(err) {
      if (err instanceof RemoteStoreError) return err;
      return new RemoteStoreError("unreachable", "store_unreachable", {
        cause: err,
        retryable: true,
      });
    }

    /* One request with bounded retry/backoff. 4xx never retries (it is our
       fault, not the network's); 5xx and network faults do. There is no sleep
       after the final attempt. */
    async _req(path, init, okNull) {
      let lastErr = null;
      for (let attempt = 0; attempt < this.retries; attempt++) {
        try {
          if (typeof this.fetch !== "function") {
            throw new RemoteStoreError("unavailable", "fetch is unavailable");
          }
          const res = await this.fetch(this.base + path, init);
          if (!validResponse(res)) {
            throw new RemoteStoreError("malformed", "store_malformed_response");
          }
          if (res.status === 404 && okNull) return null;
          if (res.status === 412) {
            throw new RemoteStoreError("conflict", "store_conflict", {
              status: res.status,
              etag: header(res, "ETag"),
            });
          }
          if (res.status >= 400 && res.status < 500) {
            throw new RemoteStoreError("http", "store_http_" + res.status, {
              status: res.status,
            });
          }
          if (res.status >= 500) {
            throw new RemoteStoreError("server", "store_http_" + res.status, {
              status: res.status,
              retryable: true,
            });
          }
          if (!res.ok) {
            throw new RemoteStoreError("http", "store_http_" + res.status, {
              status: res.status,
            });
          }
          return res;
        } catch (raw) {
          const err = this._normalizeFailure(raw);
          if (!err.retryable) throw err;
          lastErr = err;
          if (attempt >= this.retries - 1) break;
          const delay = Math.min(this.maxBackoffMs, this.backoffMs * Math.pow(2, attempt));
          if (delay > 0) await this.sleep(delay);
        }
      }
      throw lastErr || new RemoteStoreError("unreachable", "store_unreachable");
    }

    async _text(res) {
      if (!res || typeof res.text !== "function") {
        throw new RemoteStoreError("malformed", "store_malformed_body");
      }
      try {
        return await res.text();
      } catch (err) {
        throw new RemoteStoreError("malformed", "store_malformed_body", { cause: err });
      }
    }

    async get(key) {
      const k = String(key);
      const res = await this._req(
        "/saves/" + encodeURIComponent(k),
        { method: "GET", headers: await this._headers() },
        true,
      );
      if (!res) {
        this.etags.delete(k);
        return null;
      }
      const tag = header(res, "ETag");
      if (tag) this.etags.set(k, tag);
      else this.etags.delete(k);
      return await this._text(res);
    }

    async set(key, value) {
      const k = String(key);
      const tag = this.etags.get(k);
      const res = await this._req("/saves/" + encodeURIComponent(k), {
        method: "PUT",
        headers: await this._headers(tag ? { "If-Match": tag } : null),
        body: String(value),
      });
      const next = header(res, "ETag");
      if (next) this.etags.set(k, next);
      else this.etags.delete(k);
    }

    async remove(key) {
      const k = String(key);
      const tag = this.etags.get(k);
      await this._req(
        "/saves/" + encodeURIComponent(k),
        {
          method: "DELETE",
          headers: await this._headers(tag ? { "If-Match": tag } : null),
        },
        true,
      );
      this.etags.delete(k);
    }

    async keys(prefix) {
      const res = await this._req(
        "/saves?prefix=" + encodeURIComponent(prefix || ""),
        { method: "GET", headers: await this._headers() },
        true,
      );
      if (!res) return [];
      const text = await this._text(res);
      let list;
      try {
        list = JSON.parse(text);
      } catch (err) {
        throw new RemoteStoreError("malformed", "store_malformed_index", { cause: err });
      }
      if (!Array.isArray(list) || list.some((key) => typeof key !== "string")) {
        throw new RemoteStoreError("malformed", "store_malformed_index");
      }
      return Array.from(new Set(list)).sort();
    }
  }

  RemoteStore.DEFAULT_RETRIES = DEFAULT_RETRIES;
  RemoteStore.DEFAULT_BACKOFF_MS = DEFAULT_BACKOFF_MS;
  ZS.RemoteStoreError = RemoteStoreError;
  ZS.RemoteStore = RemoteStore;
})();
