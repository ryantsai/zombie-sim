/* ZS.SaveManager — the only persistence surface gameplay code may touch
   (docs/SANGUO-DESIGN.md §5).

   It owns the schema, the migration chain, and the durability dance; the Store
   under it stays dumb. Switching local -> server is `bind(otherStore)` at boot
   and nothing else.

   Sections. A snapshot is assembled from registered sections rather than from
   a hard-coded list, so P3 can add the campaign and P5 the general roster
   without editing this file:

     ZS.SaveManager.register("campaign", { capture() {...}, apply(data) {...} })

   Durability (§5.4). When the bound store reports `capabilities.atomic ===
   false` (localStorage), a write goes shadow -> main -> bak: a crash leaves a
   whole old or a whole new save, never a torn one, and `:bak` is read as a
   fallback when the main key is missing or unparseable. An atomic store
   (a server PUT) skips the dance entirely.

   Cloud fallback (§5.4). A RemoteStore is mirrored to a LocalStore after
   successful reads and writes. If its bounded retries are exhausted,
   SaveManager uses that mirror and sets cloudOutOfSync. Conflicts and other
   permanent HTTP failures are still surfaced — silently overwriting a newer
   cloud save would be worse than asking the player to resolve it. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const P = ZS.Store.PREFIX;
  const SCHEMA_VERSION = 1;
  const AUTOSAVE_SLOT = "auto";
  const AUTOSAVE_MIN_MS = 5000; // throttle; the caller fires once per World phase
  const APP_BUILD = "sanguo-p0";

  /* Ordered pure v -> v+1 upgrades. Empty at v1 on purpose: the chain exists
     from the first commit so that retrofitting it later never has to happen. */
  const MIGRATIONS = {
    // 1: (s) => { s.version = 2; ...; return s; },
  };

  function slotKey(slot) {
    return P + "slot:" + String(slot);
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function isCloudStore(store) {
    return !!(store && store.capabilities && store.capabilities.cloud);
  }

  function updatedAt(snap) {
    const text = snap && snap.meta && snap.meta.updatedAt;
    const time = text ? Date.parse(text) : NaN;
    return Number.isFinite(time) ? time : 0;
  }

  function isFallbackError(err) {
    return !!(
      err &&
      (err.code === "unreachable" ||
        err.code === "server" ||
        err.code === "malformed" ||
        err.code === "unavailable")
    );
  }

  function makeLocalFallback() {
    if (!ZS.LocalStore || typeof ZS.LocalStore.available !== "function") return null;
    try {
      return ZS.LocalStore.available() ? new ZS.LocalStore() : null;
    } catch {
      return null;
    }
  }

  class SaveError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  const SaveManager = {
    SCHEMA_VERSION,
    AUTOSAVE_SLOT,
    store: null,
    auth: null,
    fallbackStore: null,
    cloudOutOfSync: false,
    lastCloudError: null,
    lastFallbackError: null,
    _cloudFaulted: false,
    _cloudDirty: new Map(), // key -> "write" | "delete"; intentionally not saved
    sections: new Map(),
    playtimeSec: 0,
    createdAt: null,
    lastAutosaveAt: 0,
    lastError: null,

    /* ---- wiring ---------------------------------------------------- */

    bind(store, auth, opts) {
      this.store = store;
      this.auth = auth || ZS.Auth;
      const o = opts || {};
      this.fallbackStore = null;
      if (isCloudStore(store)) {
        this.fallbackStore = Object.prototype.hasOwnProperty.call(o, "fallbackStore")
          ? o.fallbackStore
          : makeLocalFallback();
        if (this.fallbackStore === store) this.fallbackStore = null;
      }
      this.cloudOutOfSync = false;
      this.lastCloudError = null;
      this.lastFallbackError = null;
      this._cloudFaulted = false;
      this._cloudDirty.clear();
      return this;
    },

    register(name, section) {
      if (
        !section ||
        typeof section.capture !== "function" ||
        typeof section.apply !== "function"
      ) {
        throw new SaveError("bad_section", "section " + name + " needs capture() and apply()");
      }
      this.sections.set(name, section);
      return this;
    },

    tick(dt) {
      this.playtimeSec += dt;
    },

    /* ---- snapshot -------------------------------------------------- */

    /* Plain data only — no live agents, no canvas state, no functions.
       Content that never changes (skills, place names, the almanac) is code,
       and the save references it by id. */
    capture() {
      const now = new Date().toISOString();
      if (!this.createdAt) this.createdAt = now;
      const snap = {
        version: SCHEMA_VERSION,
        meta: {
          createdAt: this.createdAt,
          updatedAt: now,
          playtimeSec: Math.round(this.playtimeSec),
          appBuild: APP_BUILD,
          deviceId: (this.auth && this.auth.deviceId) || null,
        },
        settings: null,
        campaign: null,
        battle: null,
      };
      for (const [name, sec] of this.sections) snap[name] = sec.capture();
      return snap;
    },

    apply(snap) {
      if (!isPlainObject(snap)) throw new SaveError("bad_snapshot", "not an object");
      this.createdAt = (snap.meta && snap.meta.createdAt) || this.createdAt;
      this.playtimeSec = (snap.meta && snap.meta.playtimeSec) || 0;
      for (const [name, sec] of this.sections) {
        if (Object.prototype.hasOwnProperty.call(snap, name)) sec.apply(snap[name]);
      }
      return snap;
    },

    /* ---- versioning ------------------------------------------------ */

    migrateUp(snap) {
      if (!isPlainObject(snap)) throw new SaveError("bad_snapshot", "not an object");
      let v = snap.version | 0;
      if (v < 1) throw new SaveError("bad_version", "missing version");
      if (v > SCHEMA_VERSION) {
        /* A save from a newer build is refused whole, never half-read. */
        throw new SaveError("future_version", "save v" + v + " > build v" + SCHEMA_VERSION);
      }
      while (v < SCHEMA_VERSION) {
        const step = MIGRATIONS[v];
        if (typeof step !== "function") {
          throw new SaveError("no_migration", "v" + v + " -> v" + (v + 1));
        }
        snap = step(snap);
        v = snap.version | 0;
      }
      return snap;
    },

    validate(snap) {
      if (!isPlainObject(snap)) return "not an object";
      if ((snap.version | 0) !== SCHEMA_VERSION) return "version mismatch";
      if (!isPlainObject(snap.meta)) return "missing meta";
      return null;
    },

    /* ---- read / write ---------------------------------------------- */

    async _writeTo(st, key, text) {
      if (!st) throw new SaveError("no_store", "SaveManager.bind() was never called");
      if (st.capabilities && st.capabilities.atomic) {
        await st.set(key, text);
        return;
      }
      /* shadow -> main -> bak (§5.4). The previous value is preserved as :bak
         before main is overwritten, so a crash at any point leaves one whole
         readable save. */
      const prev = await st.get(key);
      await st.set(key + ":shadow", text);
      try {
        if (prev !== null) await st.set(key + ":bak", prev);
        await st.set(key, text);
      } catch (e) {
        /* Out of quota part-way through: drop the shadow so the next read does
           not see a half-finished write, and let the caller hear about it. */
        await st.remove(key + ":shadow").catch(() => {});
        throw e;
      }
      await st.remove(key + ":shadow");
    },

    async _readFrom(st, key) {
      if (!st) throw new SaveError("no_store", "SaveManager.bind() was never called");
      const tryParse = (text) => {
        if (text === null) return null;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };
      const main = await st.get(key);
      let snap = tryParse(main);
      if (snap) return snap;
      if (isCloudStore(st)) {
        if (main !== null) {
          throw new SaveError("malformed", "cloud save is not valid JSON");
        }
        return null;
      }
      /* Main key absent or unparseable — fall back to the previous good save. */
      snap = tryParse(await st.get(key + ":bak"));
      return snap;
    },

    _refreshCloudState() {
      this.cloudOutOfSync = this._cloudFaulted || this._cloudDirty.size > 0;
      if (!this.cloudOutOfSync) this.lastCloudError = null;
    },

    _markCloudFault(err) {
      this._cloudFaulted = true;
      this.lastCloudError = err;
      this._refreshCloudState();
    },

    _markCloudDirty(key, kind, err) {
      this._cloudDirty.set(key, kind);
      this._cloudFaulted = true;
      this.lastCloudError = err;
      this._refreshCloudState();
    },

    _markCloudClean(key) {
      this._cloudDirty.delete(key);
      this._cloudFaulted = false;
      this._refreshCloudState();
    },

    async _mirrorWrite(key, text) {
      if (!this.fallbackStore) return;
      try {
        await this._writeTo(this.fallbackStore, key, text);
        this.lastFallbackError = null;
      } catch (err) {
        /* The cloud write is already durable. A broken optional mirror must
           not turn that successful save into a failure. */
        this.lastFallbackError = err;
      }
    },

    async _fallbackWrite(key, text, cloudError) {
      this._markCloudFault(cloudError);
      if (!this.fallbackStore) throw cloudError;
      try {
        await this._writeTo(this.fallbackStore, key, text);
      } catch (fallbackError) {
        const err = new SaveError(
          "fallback_failed",
          "cloud and local fallback writes failed",
          cloudError,
        );
        err.fallbackCause = fallbackError;
        throw err;
      }
      this.lastFallbackError = null;
      this._markCloudDirty(key, "write", cloudError);
    },

    async _write(key, text) {
      const st = this.store;
      if (!st) throw new SaveError("no_store", "SaveManager.bind() was never called");
      if (!isCloudStore(st)) return this._writeTo(st, key, text);
      try {
        await this._writeTo(st, key, text);
      } catch (err) {
        if (!isFallbackError(err)) {
          this._markCloudFault(err);
          throw err;
        }
        await this._fallbackWrite(key, text, err);
        return;
      }
      this._markCloudClean(key);
      await this._mirrorWrite(key, text);
    },

    async _fallbackRead(key, cloudError) {
      this._markCloudFault(cloudError);
      if (!this.fallbackStore) throw cloudError;
      let snap;
      try {
        snap = await this._readFrom(this.fallbackStore, key);
      } catch (fallbackError) {
        const err = new SaveError(
          "fallback_failed",
          "cloud and local fallback reads failed",
          cloudError,
        );
        err.fallbackCause = fallbackError;
        throw err;
      }
      this.lastFallbackError = null;
      if (!snap) throw cloudError;
      this._markCloudDirty(key, "write", cloudError);
      return snap;
    },

    async _read(key) {
      const st = this.store;
      if (!st) throw new SaveError("no_store", "SaveManager.bind() was never called");
      if (!isCloudStore(st)) return this._readFrom(st, key);

      const dirty = this._cloudDirty.get(key);
      if (dirty === "delete") return null;
      if (dirty === "write" && this.fallbackStore) {
        return this._readFrom(this.fallbackStore, key);
      }

      let snap;
      try {
        snap = await this._readFrom(st, key);
      } catch (err) {
        if (!isFallbackError(err)) {
          this._markCloudFault(err);
          throw err;
        }
        return this._fallbackRead(key, err);
      }
      if (snap) {
        let local = null;
        if (this.fallbackStore) {
          try {
            local = await this._readFrom(this.fallbackStore, key);
            this.lastFallbackError = null;
          } catch (err) {
            /* A valid cloud snapshot remains usable when only its optional
               local mirror is damaged. */
            this.lastFallbackError = err;
          }
        }
        if (local && updatedAt(local) > updatedAt(snap)) {
          this._markCloudDirty(
            key,
            "write",
            new SaveError("cloud_stale", "local fallback is newer than cloud"),
          );
          return local;
        }
        this._markCloudClean(key);
        await this._mirrorWrite(key, JSON.stringify(snap));
        return snap;
      }

      /* A local-only slot is the expected first-sync case. Keep it available
         and mark it dirty so the next save uploads it. */
      if (this.fallbackStore) {
        const local = await this._readFrom(this.fallbackStore, key);
        if (local) {
          this._markCloudDirty(
            key,
            "write",
            new SaveError("cloud_missing", "save exists only in local fallback"),
          );
          return local;
        }
      }
      this._markCloudClean(key);
      return null;
    },

    async _removeFrom(st, key) {
      if (!st) return;
      await st.remove(key);
      await st.remove(key + ":shadow");
      await st.remove(key + ":bak");
    },

    async _remove(key) {
      const st = this.store;
      if (!st) throw new SaveError("no_store", "SaveManager.bind() was never called");
      if (!isCloudStore(st)) return this._removeFrom(st, key);
      try {
        await st.remove(key);
      } catch (err) {
        if (!isFallbackError(err)) {
          this._markCloudFault(err);
          throw err;
        }
        if (!this.fallbackStore) {
          this._markCloudFault(err);
          throw err;
        }
        try {
          await this._removeFrom(this.fallbackStore, key);
        } catch (fallbackError) {
          this._markCloudFault(err);
          const failure = new SaveError(
            "fallback_failed",
            "cloud and local fallback deletes failed",
            err,
          );
          failure.fallbackCause = fallbackError;
          throw failure;
        }
        this._markCloudDirty(key, "delete", err);
        return;
      }
      this._markCloudClean(key);
      if (this.fallbackStore) {
        try {
          await this._removeFrom(this.fallbackStore, key);
          this.lastFallbackError = null;
        } catch (err) {
          this.lastFallbackError = err;
        }
      }
    },

    async _keys(prefix) {
      const st = this.store;
      if (!st) throw new SaveError("no_store", "SaveManager.bind() was never called");
      if (!isCloudStore(st)) return st.keys(prefix);

      let keys;
      try {
        keys = await st.keys(prefix);
        this._cloudFaulted = false;
        this._refreshCloudState();
      } catch (err) {
        if (!isFallbackError(err)) {
          this._markCloudFault(err);
          throw err;
        }
        if (!this.fallbackStore) {
          this._markCloudFault(err);
          throw err;
        }
        this._markCloudFault(err);
        return Array.from(new Set(await this.fallbackStore.keys(prefix))).sort();
      }

      if (!this.fallbackStore || this._cloudDirty.size === 0) return keys;
      const merged = new Set(keys);
      const localKeys = new Set(await this.fallbackStore.keys(prefix));
      for (const [key, kind] of this._cloudDirty) {
        if (prefix && !key.startsWith(prefix)) continue;
        if (kind === "delete") merged.delete(key);
        else if (localKeys.has(key)) merged.add(key);
      }
      return Array.from(merged).sort();
    },

    /* ---- public API ------------------------------------------------- */

    async save(slot) {
      const snap = this.capture();
      const problem = this.validate(snap);
      if (problem) throw new SaveError("invalid_capture", problem);
      await this._write(slotKey(slot), JSON.stringify(snap));
      return snap;
    },

    async load(slot) {
      const raw = await this._read(slotKey(slot));
      if (!raw) throw new SaveError("not_found", "no save in slot " + slot);
      const snap = this.migrateUp(raw);
      const problem = this.validate(snap);
      if (problem) throw new SaveError("invalid_save", problem);
      return this.apply(snap);
    },

    async has(slot) {
      return (await this._read(slotKey(slot))) !== null;
    },

    async deleteSlot(slot) {
      const k = slotKey(slot);
      await this._remove(k);
    },

    /* [{ slot, meta:{ turn, faction, playtime, updatedAt } }], newest first. */
    async listSlots() {
      const keys = await this._keys(P + "slot:");
      const out = [];
      for (const k of keys) {
        if (k.endsWith(":shadow") || k.endsWith(":bak")) continue;
        const snap = await this._read(k);
        if (!snap) continue;
        const c = isPlainObject(snap.campaign) ? snap.campaign : {};
        out.push({
          slot: k.slice((P + "slot:").length),
          meta: {
            turn: c.turn === undefined ? null : c.turn,
            year: c.year === undefined ? null : c.year,
            faction: c.playerFactionId === undefined ? null : c.playerFactionId,
            playtime: (snap.meta && snap.meta.playtimeSec) || 0,
            updatedAt: (snap.meta && snap.meta.updatedAt) || null,
            version: snap.version | 0,
          },
        });
      }
      out.sort((a, b) => String(b.meta.updatedAt).localeCompare(String(a.meta.updatedAt)));
      return out;
    },

    /* Called only at the end of a World phase — a safe boundary, never
       mid-resolve. Throttled so a fast-clicked turn cannot thrash the store. */
    async autosave(force) {
      const now = Date.now();
      if (!force && now - this.lastAutosaveAt < AUTOSAVE_MIN_MS) return false;
      this.lastAutosaveAt = now;
      try {
        await this.save(AUTOSAVE_SLOT);
        this.lastError = null;
        return true;
      } catch (e) {
        this.lastError = e;
        return false;
      }
    },
  };

  ZS.SaveError = SaveError;
  ZS.SaveManager = SaveManager;
})();
