import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Api, ApiError, explain, kindOf, loadSnapshot, Reloading, RELOAD_GUARD_MS, type FetchFn, type GuardStorage, type ResponseLike } from "../src/api.ts";

interface Call {
  url: string;
  init: RequestInit;
}

interface Reply {
  status?: number;
  body?: unknown;
  etag?: string;
  type?: string;
  contentType?: string;
  throws?: string;
}

function fake(replies: Record<string, Reply | (() => Reply)>): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url}`;
    const r0 = replies[key];
    if (r0 === undefined) throw new Error(`no reply for ${key}`);
    const r = typeof r0 === "function" ? r0() : r0;
    if (r.throws !== undefined) throw new TypeError(r.throws);
    const status = r.status ?? 200;
    const headers = new Map<string, string>();
    if (r.etag !== undefined) headers.set("etag", r.etag);
    const ct = r.contentType ?? (status >= 400 ? "application/problem+json" : "application/json");
    if (r.body !== undefined) headers.set("content-type", ct);
    const res: ResponseLike = {
      status,
      ...(r.type === undefined ? {} : { type: r.type }),
      headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
      text: async () => (r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
    return res;
  };
  return { fetch, calls };
}

function memory(): GuardStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe("versions", () => {
  it("sends the store ETag as If-Match, and keeps the new one", async () => {
    const f = fake({
      "GET /v1/themes": { body: { themes: [] }, etag: '"7"' },
      "PUT /v1/favourites": { body: { favourites: ["a"] }, etag: '"8"' },
      "DELETE /v1/themes/a": { status: 204, etag: '"9"' },
    });
    const api = new Api({ fetch: f.fetch });
    await api.get("/v1/themes");
    assert.equal(api.tags.store, '"7"');
    await api.put("/v1/favourites", { favourites: ["a"] });
    const put = f.calls[1];
    assert.ok(put);
    assert.equal(header(put.init, "If-Match"), '"7"');
    assert.equal(header(put.init, "Content-Type"), "application/json");
    assert.equal(put.init.body, '{"favourites":["a"]}');
    assert.equal(put.init.credentials, "same-origin");
    assert.equal(put.init.redirect, "manual");
    assert.equal(api.tags.store, '"8"');
    await api.delete("/v1/themes/a");
    assert.equal(header(f.calls[2]?.init ?? {}, "If-Match"), '"8"');
    assert.equal(header(f.calls[2]?.init ?? {}, "Content-Type"), undefined);
    assert.equal(api.tags.store, '"9"');
  });

  it("keeps prefs tags apart from store tags", async () => {
    const f = fake({
      "GET /v1/themes": { body: { themes: [] }, etag: '"7"' },
      "GET /v1/policies": { body: { users: {}, groups: {} }, etag: '"p3"' },
      "PUT /v1/policies/users/bob": { body: { theme: "x", kind: "default" }, etag: '"p4"' },
    });
    const api = new Api({ fetch: f.fetch });
    await api.get("/v1/themes");
    await api.get("/v1/policies");
    assert.deepEqual(api.tags, { store: '"7"', prefs: '"p3"' });
    await api.put("/v1/policies/users/bob", { theme: "x", kind: "default" });
    assert.equal(header(f.calls[2]?.init ?? {}, "If-Match"), '"p3"');
    assert.deepEqual(api.tags, { store: '"7"', prefs: '"p4"' });
    assert.equal(kindOf("/v1/me/apps/a/preference"), "prefs");
    assert.equal(kindOf("/v1/apps/a"), "store");
  });

  it("never sends a write without a version", async () => {
    const api = new Api({ fetch: fake({}).fetch });
    await assert.rejects(api.put("/v1/favourites", { favourites: [] }), (e: unknown) => e instanceof ApiError && e.status === 428);
  });

  it("doesn't let a late answer replace a newer version", () => {
    const api = new Api({ fetch: fake({}).fetch });
    api.setTag("store", '"9"');
    api.setTag("store", '"8"');
    assert.equal(api.tags.store, '"9"');
    api.setTag("store", '"8"', true);
    assert.equal(api.tags.store, '"8"');
    api.setTag("store", '"p9"');
    assert.equal(api.tags.store, '"8"');
  });
});

describe("refusals", () => {
  it("412 is a clear 'changed elsewhere' error", async () => {
    const f = fake({
      "GET /v1/assignments": { body: { global: null, perApp: {} }, etag: '"3"' },
      "PUT /v1/assignments": { status: 412, body: { status: 412, code: "version_conflict", detail: "x", request_id: "r1" } },
    });
    const api = new Api({ fetch: f.fetch });
    await api.get("/v1/assignments");
    await assert.rejects(api.put("/v1/assignments", { global: null, perApp: {} }), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 412);
      assert.equal(e.code, "version_conflict");
      assert.equal(e.requestId, "r1");
      assert.match(e.message, /Changed elsewhere/);
      return true;
    });
  });

  it("422 lists the theme's issues", () => {
    const msg = explain(422, "invalid_theme", "", [{ code: "missing_token", path: "/tokens/dark/primary", message: "required token \"primary\" is missing" }]);
    assert.match(msg, /\/tokens\/dark\/primary: required token "primary" is missing/);
  });

  it("has a sentence for 401, 403, 409 and 415", () => {
    assert.match(explain(401, "unauthenticated", ""), /sign-in has ended/);
    assert.match(explain(403, "not_admin", ""), /Only admins/);
    assert.match(explain(409, "in_use", ""), /still in use/);
    assert.match(explain(415, "unsupported_media_type", ""), /format/);
  });
});

describe("an ended session", () => {
  for (const [name, reply] of [
    ["a network error", { throws: "Failed to fetch" }],
    ["a redirect to the sign-in", { status: 0, type: "opaqueredirect" }],
    ["an HTML page instead of JSON", { body: "<html>", contentType: "text/html" }],
    ["a 401 that is not themarr's", { status: 401, body: "<html>", contentType: "text/html" }],
  ] as const) {
    it(`${name} reloads the page`, async () => {
      let reloads = 0;
      const storage = memory();
      const api = new Api({ fetch: fake({ "GET /v1/themes": reply }).fetch, reload: () => reloads++, storage: () => storage, now: () => 1_000_000 });
      await assert.rejects(api.get("/v1/themes"), Reloading);
      assert.equal(reloads, 1);
      assert.equal(storage.data.size, 1);
    });
  }

  it("doesn't reload again right after a reload: themarr is down", async () => {
    let reloads = 0;
    let down = "";
    const storage = memory();
    let now = 1_000_000;
    const api = new Api({
      fetch: fake({ "GET /v1/themes": { throws: "Failed to fetch" } }).fetch,
      reload: () => reloads++,
      onUnreachable: (r) => (down = r),
      storage: () => storage,
      now: () => now,
    });
    await assert.rejects(api.get("/v1/themes"), Reloading);
    now += 1000;
    await assert.rejects(api.get("/v1/themes"), (e: unknown) => e instanceof ApiError && e.code === "unreachable");
    assert.equal(reloads, 1);
    assert.equal(down, "Failed to fetch");
    now += RELOAD_GUARD_MS;
    await assert.rejects(api.get("/v1/themes"), Reloading);
    assert.equal(reloads, 2);
  });

  it("themarr's own 401 is an error, not a reload", async () => {
    let reloads = 0;
    const api = new Api({
      fetch: fake({ "GET /v1/themes": { status: 401, body: { status: 401, code: "unauthenticated" } } }).fetch,
      reload: () => reloads++,
      storage: () => memory(),
    });
    await assert.rejects(api.get("/v1/themes"), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.equal(reloads, 0);
  });

  it("never reloads without session storage for the guard: it asks the person (T-115 review)", async () => {
    const blocked: (() => GuardStorage | undefined)[] = [
      () => undefined,
      () => {
        throw new Error("SecurityError");
      },
      () => ({
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
      }),
      () => ({
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      }),
    ];
    for (const storage of blocked) {
      let reloads = 0;
      let ended = "";
      const api = new Api({
        fetch: fake({ "GET /v1/themes": { throws: "Failed to fetch" } }).fetch,
        reload: () => reloads++,
        onSessionEnded: (r) => (ended = r),
        storage,
      });
      for (let i = 0; i < 3; i++) {
        await assert.rejects(api.get("/v1/themes"), (e: unknown) => e instanceof ApiError && e.code === "session_ended" && /Reload the page/.test(e.message));
      }
      assert.equal(reloads, 0);
      assert.equal(ended, "Failed to fetch");
    }
  });
});

describe("loadSnapshot", () => {
  const base = {
    "GET /v1/apps": { body: { apps: [] }, etag: '"5"' },
    "GET /v1/assignments": { body: { global: "a", perApp: {} }, etag: '"5"' },
    "GET /v1/favourites": { body: { favourites: [] }, etag: '"5"' },
    "GET /v1/policies": { body: { users: {}, groups: {} }, etag: '"p2"' },
  };

  it("reads everything at one version", async () => {
    const f = fake({ ...base, "GET /v1/themes": { body: { themes: [] }, etag: '"5"' } });
    const api = new Api({ fetch: f.fetch });
    const snap = await loadSnapshot(api);
    assert.equal(snap.assignments.global, "a");
    assert.deepEqual(api.tags, { store: '"5"', prefs: '"p2"' });
    assert.equal(f.calls.length, 5);
  });

  it("reads again when a write landed between the reads", async () => {
    let n = 0;
    const f = fake({ ...base, "GET /v1/themes": () => ({ body: { themes: [] }, etag: n++ === 0 ? '"4"' : '"5"' }) });
    const api = new Api({ fetch: f.fetch });
    await loadSnapshot(api);
    assert.equal(f.calls.length, 10);
    assert.equal(api.tags.store, '"5"');
  });
});
