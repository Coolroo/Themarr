// themarr.boot: ask themarr for the app's theme and apply it before the app
// draws. It resolves within timeoutMs whatever happens and never throws.
//
// Layers, asked at the same time under one deadline (the plan, "users and
// preferences"):
//   1. personal  GET /v1/me/apps/{app}/theme  (Authelia cookie), if `locked`
//   2. local     GET /v1/themes/{id}/tokens   (id from localStorage)
//   3. personal  (not locked)
//   4. public    GET /v1/apps/{app}/theme
// 204 means "nothing at this layer". Only the public answer decides
// "unreachable": a personal failure means the person is not signed in.

import { ID_MAX_LENGTH, ID_PATTERN } from "@themarr/tokens";
import { checkRender, cssFor, themeValues, type Render } from "./css.ts";
import { clearLocalOverride, getLocalOverride } from "./local.ts";
import { ThemeSheet } from "./sheet.ts";
import { Drawer, drawerPosition } from "./drawer/drawer.ts";
import type { DrawerHost } from "./drawer/host.ts";
import { currentMode } from "./drawer/mode.ts";
import type { DrawerCurrent } from "./drawer/protocol.ts";
import type {
  BootOptions,
  BootResult,
  Env,
  EnvDocument,
  EnvStorage,
  EnvWindow,
  FetchInit,
  FetchLike,
  FetchResponse,
  RenderOptions,
  Source,
  Status,
  WireTheme,
} from "./types.ts";
import { parseWire, type Parsed } from "./wire.ts";

type Answer = Extract<Parsed, { ok: true }>;
type Outcome = { kind: "theme"; answer: Answer } | { kind: "none" } | { kind: "not-found" } | { kind: "error"; reason: string };

interface Resolved {
  status: Status;
  theme?: WireTheme;
  source?: Source;
  reason?: string;
  /** The CSS text the page gets ("" for none). */
  css: string;
}

const DEFAULT_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60_000;

/** The render options boot used, so renderCss(result) needs no second copy. */
const renderOf = new WeakMap<object, Render>();

function warn(url: string, app: string, reason: string): void {
  console.warn(`[themarr] unreachable (${url}, ${app}): ${reason}; using app defaults`);
}

/** Check the url option: https only, no credentials, query or fragment. Returns the base or a problem. */
function checkUrl(url: unknown): { base: string } | string {
  if (typeof url !== "string") return "bad option url";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "bad option url: not an absolute URL";
  }
  if (u.protocol !== "https:") return `bad option url: https:// only, not ${u.protocol}//`;
  if (u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") {
    return "bad option url: no user, query or fragment";
  }
  return { base: u.origin + u.pathname.replace(/\/+$/, "") };
}

/**
 * The runtime's fetch, always called on globalThis. A browser's fetch is a
 * method of Window: called on any other object (the Booted instance, the
 * drawer host) it throws "Illegal invocation". Undefined without a fetch.
 */
export function globalFetch(): FetchLike | undefined {
  const g = globalThis as { fetch?: (url: string, init: FetchInit) => Promise<FetchResponse> };
  if (typeof g.fetch !== "function") return undefined;
  return (url, init) => g.fetch!(url, init);
}

function defaultEnv(): Env {
  const g = globalThis as { document?: EnvDocument; window?: EnvWindow; localStorage?: EnvStorage };
  return {
    document: g.document,
    window: g.window,
    storage: () => {
      try {
        return g.localStorage;
      } catch {
        return undefined;
      }
    },
  };
}

class Booted {
  readonly result: BootResult;
  readonly #o: BootOptions;
  readonly #base: string;
  readonly #render: Render;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #env: Env;
  readonly #browser: boolean;
  readonly #personal: boolean;
  readonly #sheet: ThemeSheet | undefined;
  /** Node only: URL → the last 200 answer and its ETag, for If-None-Match. */
  readonly #cache = new Map<string, { etag: string; answer: Answer }>();
  #outage = false;
  /** The last personal request answered 200 or 204: the person has a themarr session. */
  #signedIn = false;
  #locked = false;
  /** The resolved theme's CSS, and a drawer preview's, which wins while set. */
  #resolvedCss = "";
  #previewCss: string | undefined;
  #drawer: Drawer | undefined;
  #disposed = false;
  #running: Promise<void> | undefined;
  #again = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #abort: AbortController | undefined;
  readonly #onFocus = (): void => this.#schedule();
  readonly #onVisible = (): void => {
    if (this.#env.document?.visibilityState === "visible") this.#schedule();
  };

  constructor(o: BootOptions, base: string, render: Render, timeoutMs: number, fetchFn: FetchLike, env: Env) {
    this.#o = o;
    this.#base = base;
    this.#render = render;
    this.#timeoutMs = timeoutMs;
    // Never `this.#fetch = fetchFn`: calling it as this.#fetch(...) would
    // make the Booted instance its `this`. The arrow calls it bare.
    this.#fetch = (url, init) => fetchFn(url, init);
    this.#env = env;
    this.#browser = env.document !== undefined;
    this.#personal = o.personal ?? this.#browser;
    this.#sheet = env.document === undefined ? undefined : new ThemeSheet(env.document, env.window, o.nonce);
    this.result = {
      status: "unset",
      refresh: () => this.refresh(),
      dispose: () => this.dispose(),
    };
    renderOf.set(this.result, render);
  }

  #storage(): EnvStorage | undefined {
    try {
      return this.#env.storage?.();
    } catch {
      return undefined;
    }
  }

  async #request(url: string, credentials: "omit" | "include", signal: AbortSignal, local: boolean): Promise<Outcome> {
    // In a browser: no request headers at all. Any header outside the CORS
    // safelist makes the browser send a preflight (OPTIONS), which themarr
    // and the Authelia bypass do not answer. The browser's HTTP cache
    // revalidates with its own ETag instead (Cache-Control: no-cache).
    // In Node there is no CORS and no HTTP cache: send If-None-Match.
    const cached = this.#browser ? undefined : this.#cache.get(url);
    const headers: Record<string, string> = {};
    if (cached !== undefined) headers["If-None-Match"] = cached.etag;
    let res;
    try {
      res = await this.#fetch(url, { method: "GET", credentials, redirect: "error", headers, signal });
    } catch (e) {
      return { kind: "error", reason: signal.aborted ? String(signal.reason) : `network error: ${(e as Error)?.message ?? String(e)}` };
    }
    if (res.status === 304 && cached !== undefined) return { kind: "theme", answer: cached.answer };
    if (res.status === 204) {
      this.#cache.delete(url);
      return { kind: "none" };
    }
    if (res.status === 404 && local) {
      this.#cache.delete(url);
      return { kind: "not-found" };
    }
    if (res.status !== 200) return { kind: "error", reason: `HTTP ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: "error", reason: signal.aborted ? String(signal.reason) : "bad JSON" };
    }
    const parsed = parseWire(body);
    if (!parsed.ok) return { kind: "error", reason: parsed.reason };
    const etag = this.#browser ? null : res.headers.get("ETag");
    if (etag !== null && etag !== "") this.#cache.set(url, { etag, answer: parsed });
    else this.#cache.delete(url);
    return { kind: "theme", answer: parsed };
  }

  /** Ask every layer at once, under one deadline, and pick the theme. */
  async #ask(): Promise<Resolved> {
    const ctrl = new AbortController();
    this.#abort = ctrl;
    const outer = this.#o.signal;
    const onOuter = (): void => ctrl.abort("aborted");
    if (outer?.aborted) ctrl.abort("aborted");
    outer?.addEventListener("abort", onOuter);
    const timer = setTimeout(() => ctrl.abort(`timeout after ${this.#timeoutMs} ms`), this.#timeoutMs);
    // A fetch that ignores its signal still loses the race at the deadline.
    const stopped = new Promise<Outcome>((resolve) => {
      const done = (): void => resolve({ kind: "error", reason: String(ctrl.signal.reason) });
      if (ctrl.signal.aborted) done();
      else ctrl.signal.addEventListener("abort", done, { once: true });
    });
    const race = (p: Promise<Outcome>): Promise<Outcome> => Promise.race([p, stopped]);
    const app = encodeURIComponent(this.#o.app);
    try {
      const localId = this.#browser ? getLocalOverride(this.#o.app, this.#storage()) : null;
      const [pub, per, loc] = await Promise.all([
        race(this.#request(`${this.#base}/v1/apps/${app}/theme`, "omit", ctrl.signal, false)),
        this.#personal
          ? race(this.#request(`${this.#base}/v1/me/apps/${app}/theme`, "include", ctrl.signal, false))
          : Promise.resolve<Outcome>({ kind: "none" }),
        localId === null
          ? Promise.resolve<Outcome>({ kind: "none" })
          : race(this.#request(`${this.#base}/v1/themes/${localId}/tokens`, "omit", ctrl.signal, true)),
      ]);
      if (loc.kind === "not-found") clearLocalOverride(this.#o.app, this.#storage());
      this.#signedIn = this.#personal && (per.kind === "theme" || per.kind === "none");
      this.#locked = per.kind === "theme" && per.answer.locked;
      return this.#pick(pub, per, loc);
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
      if (this.#abort === ctrl) this.#abort = undefined;
    }
  }

  #pick(pub: Outcome, per: Outcome, loc: Outcome): Resolved {
    let answer: Answer | undefined;
    let source: Source | undefined;
    if (per.kind === "theme" && per.answer.locked) {
      answer = per.answer;
      source = per.answer.source ?? "enforced";
    } else if (loc.kind === "theme") {
      answer = loc.answer;
      source = "local";
    } else if (per.kind === "theme") {
      answer = per.answer;
      source = per.answer.source ?? "saved";
    } else if (pub.kind === "theme") {
      answer = pub.answer;
      source = pub.answer.source ?? "public";
    }
    if (answer !== undefined && source !== undefined) {
      const css = cssFor(answer.theme, this.#render);
      if (css === "") return { status: "unset", css }; // No palette for the forced mode.
      return { status: "applied", theme: answer.theme, source, css };
    }
    if (pub.kind === "error") return { status: "unreachable", reason: pub.reason, css: "" };
    return { status: "unset", css: "" };
  }

  #fill(r: Resolved): void {
    const res = this.result;
    res.status = r.status;
    delete res.tokens;
    delete res.version;
    delete res.source;
    delete res.theme;
    delete res.reason;
    if (r.theme !== undefined) {
      res.theme = r.theme;
      res.tokens = themeValues(r.theme);
      res.version = r.theme.version;
    }
    if (r.source !== undefined) res.source = r.source;
    if (r.reason !== undefined) res.reason = r.reason;
  }

  async start(): Promise<BootResult> {
    const r = await this.#ask();
    if (r.status === "unreachable") {
      this.#outage = true;
      warn(this.#o.url, this.#o.app, r.reason ?? "unknown");
    }
    this.#resolvedCss = r.css;
    this.#show();
    this.#fill(r);
    const w = this.#env.window;
    const d = this.#env.document;
    if ((this.#o.refreshOnFocus ?? true) && w !== undefined && d !== undefined) {
      w.addEventListener("focus", this.#onFocus);
      d.addEventListener("visibilitychange", this.#onVisible);
    }
    this.#mountDrawer();
    return this.result;
  }

  /** The page shows the drawer's preview while there is one, else the resolved theme. */
  #show(): void {
    this.#sheet?.set(this.#previewCss ?? this.#resolvedCss);
  }

  /** The drawer, when the app asked for it and this is a browser (never in Node). */
  #mountDrawer(): void {
    const position = drawerPosition(this.#o.drawer);
    const doc = this.#env.document as unknown as Document | undefined;
    const win = this.#env.window as unknown as Window | undefined;
    if (position === null || doc === undefined || win === undefined || typeof doc.createElement !== "function") return;
    try {
      this.#drawer = new Drawer(this.#drawerHost(doc, win), position);
    } catch {
      // A browser without shadow DOM: no drawer; the theme still applies.
    }
  }

  #drawerHost(doc: Document, win: Window): DrawerHost {
    return {
      app: this.#o.app,
      base: this.#base,
      origin: new URL(this.#o.url).origin,
      nonce: this.#o.nonce,
      fetch: this.#fetch,
      document: doc,
      window: win,
      readyMs: this.#o._drawerReadyMs ?? 10_000,
      storage: () => this.#storage(),
      signedIn: () => this.#signedIn,
      current: (): DrawerCurrent => {
        const r = this.result;
        const cur: DrawerCurrent = { source: r.status === "applied" && r.source !== undefined ? r.source : "none", locked: this.#locked };
        if (r.status === "applied" && r.version !== undefined) cur.version = r.version;
        const local = getLocalOverride(this.#o.app, this.#storage());
        if (local !== null) cur.local = local;
        return cur;
      },
      mode: () => currentMode(this.#render, doc, win),
      preview: (theme, mode) => {
        if (this.#disposed) return;
        if (theme === undefined) this.#previewCss = undefined;
        else this.#previewCss = cssFor(theme, mode === undefined ? this.#render : { ...this.#render, mode });
        this.#show();
      },
      refresh: () => this.refresh(),
    };
  }

  #schedule(): void {
    if (this.#disposed) return;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.refresh();
    }, this.#o._debounceMs ?? 250);
  }

  /** Ask again. A refresh asked while one runs runs once more after it. */
  refresh(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#running !== undefined) {
      this.#again = true;
      return this.#running;
    }
    const run = async (): Promise<void> => {
      try {
        do {
          this.#again = false;
          await this.#refreshOnce();
        } while (this.#again && !this.#disposed);
      } catch {
        // A refresh never breaks the app; the page keeps what it has.
      } finally {
        this.#running = undefined;
      }
    };
    this.#running = run();
    return this.#running;
  }

  async #refreshOnce(): Promise<void> {
    const r = await this.#ask();
    if (this.#disposed) return;
    if (r.status === "unreachable") {
      // Keep what the page has; warn once per outage.
      if (!this.#outage) warn(this.#o.url, this.#o.app, r.reason ?? "unknown");
      this.#outage = true;
      return;
    }
    this.#outage = false;
    const before = this.result;
    const same =
      before.status === r.status &&
      before.source === r.source &&
      (this.#sheet === undefined ? JSON.stringify(before.theme) === JSON.stringify(r.theme) : this.#resolvedCss === r.css) &&
      before.version === r.theme?.version;
    if (same) return;
    this.#resolvedCss = r.css;
    this.#show();
    this.#fill(r);
    try {
      this.#o.onChange?.(this.result);
    } catch {
      // The app's callback must not stop the SDK.
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#abort?.abort("disposed");
    this.#drawer?.destroy();
    this.#drawer = undefined;
    this.#env.window?.removeEventListener("focus", this.#onFocus);
    this.#env.document?.removeEventListener("visibilitychange", this.#onVisible);
    this.#sheet?.clear();
  }
}

function unreachable(reason: string): BootResult {
  return { status: "unreachable", reason, refresh: () => Promise.resolve(), dispose: () => {} };
}

/** Check the boot options. Returns the problem as text, or the checked values. */
function checkBoot(o: BootOptions): { base: string; render: Render; timeoutMs: number } | string {
  if (typeof o !== "object" || o === null) return "bad options";
  if (typeof o.app !== "string" || o.app.length > ID_MAX_LENGTH || !ID_PATTERN.test(o.app)) return "bad option app";
  const url = checkUrl(o.url);
  if (typeof url === "string") return url;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    return "bad option timeoutMs";
  }
  if (o.nonce !== undefined && (typeof o.nonce !== "string" || o.nonce === "")) return "bad option nonce";
  if (o.drawer !== undefined && o.drawer !== false && drawerPosition(o.drawer) === null) return "bad option drawer";
  const render = checkRender(o);
  if (typeof render === "string") return render;
  return { base: url.base, render, timeoutMs };
}

/**
 * Ask themarr for the app's theme and apply it. Await it before the app
 * draws. Resolves within timeoutMs; never throws.
 */
export async function boot(opts: BootOptions): Promise<BootResult> {
  try {
    const checked = checkBoot(opts);
    if (typeof checked === "string") {
      warn(String(opts?.url), String(opts?.app), checked);
      return unreachable(checked);
    }
    const fetchFn = opts._fetch ?? globalFetch();
    if (fetchFn === undefined) {
      warn(opts.url, opts.app, "no fetch in this runtime");
      return unreachable("no fetch in this runtime");
    }
    const b = new Booted(opts, checked.base, checked.render, checked.timeoutMs, fetchFn, opts._env ?? defaultEnv());
    return await b.start();
  } catch (e) {
    const reason = `internal error: ${(e as Error)?.message ?? String(e)}`;
    try {
      warn(String(opts?.url), String(opts?.app), reason);
    } catch {
      // Nothing left to tell.
    }
    return unreachable(reason);
  }
}

/**
 * The CSS text for a boot result, for a server-rendered page: put it in
 * <style id="themarr"> in <head>. Without opts it uses the options boot was
 * given. "" when there is no theme. Throws a TypeError on bad options.
 */
export function renderCss(result: Pick<BootResult, "theme"> | undefined, opts?: RenderOptions): string {
  let r: Render | string | undefined = opts === undefined && result !== undefined ? renderOf.get(result) : undefined;
  r ??= checkRender(opts ?? {});
  if (typeof r === "string") throw new TypeError(`[themarr] ${r}`);
  return cssFor(result?.theme, r);
}
