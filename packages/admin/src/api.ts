// The admin UI's API client: same-origin fetch, JSON, and the version rules of
// docs/contract.md. Every answer's ETag is kept per kind (the store's "<n>",
// prefs' "p<n>") and sent back as If-Match on the next write of that kind.
//
// A network error, a redirect (Authelia's login), or an answer that is not
// JSON where JSON belongs means the Authelia session has ended: the page
// reloads, so Authelia can sign the admin in again. A guard in session
// storage stops a reload loop when themarr itself is down; without session
// storage the page asks the admin to reload instead.

import type { Mode, Theme } from "@themarr/tokens";

export interface App {
  id: string;
  name: string;
  origins: string[];
}

/** A theme id, "inherit" or "none". */
export type Assignment = string;

export interface Assignments {
  global: string | null;
  perApp: Record<string, Assignment>;
}

export type PolicyKind = "default" | "enforced";

export interface Policy {
  theme: string;
  kind: PolicyKind;
}

export interface Policies {
  users: Record<string, Policy>;
  groups: Record<string, Policy>;
}

export interface LastCheck {
  at: string;
  result: "applied" | "unset";
  theme?: string;
}

export type { Mode, Theme };

/** One issue of a refused theme (422 invalid_theme). */
export interface Issue {
  code: string;
  path: string;
  message: string;
}

/** An answer themarr refused, with a message for people. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly issues: Issue[];
  readonly requestId: string;

  constructor(status: number, code: string, detail: string, issues: Issue[] = [], requestId = "") {
    super(explain(status, code, detail, issues));
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.issues = issues;
    this.requestId = requestId;
  }
}

/** Thrown after the page was told to reload: callers stop, nothing to show. */
export class Reloading extends Error {
  constructor(reason: string) {
    super(`reloading: ${reason}`);
    this.name = "Reloading";
  }
}

/** A clear sentence for each refusal (contract.md, Errors). */
export function explain(status: number, code: string, detail: string, issues: readonly Issue[] = []): string {
  switch (status) {
    case 401:
      return "Your sign-in has ended. Reload the page to sign in again.";
    case 403:
      if (code === "not_admin") return "Only admins can do this. Your account is not in the admins group.";
      if (code === "bad_origin" || code === "cross_site") return "Themarr refused a change that did not come from its own page. Reload the page and try again.";
      return `Not allowed (${code || "forbidden"}).`;
    case 404:
      return "Not found. It may have been deleted somewhere else; the page now shows the latest data.";
    case 409:
      if (code === "in_use") return "This theme is still in use: an app, the global default or a policy names it. Choose another theme there first.";
      if (code === "locked") return "An admin enforces a theme for this person, so a choice can't be saved.";
      return detail || `Conflict (${code}).`;
    case 412:
      return "Changed elsewhere: somebody saved first. The page now shows the latest data; make your change again.";
    case 413:
      return "Too large: themarr refused the size of this change.";
    case 415:
      return "Themarr refused the format of this change (415). This is a bug in the admin page; reload and try again.";
    case 422: {
      const list = issues.slice(0, 5).map((i) => `${i.path || "theme"}: ${i.message}`);
      const more = issues.length > 5 ? ` (and ${issues.length - 5} more)` : "";
      if (list.length > 0) return `Themarr refused the theme: ${list.join("; ")}${more}.`;
      return `Themarr refused this: ${detail || code}.`;
    }
    case 428:
      return "Themarr needs the version of the data this change is based on. Reload the page and try again.";
    case 500:
      return "Themarr could not save. Try again; if it keeps failing, check the server log.";
    default:
      return detail || `Themarr answered ${status}${code ? ` (${code})` : ""}.`;
  }
}

/** The parts of fetch's Response the client reads. */
export interface ResponseLike {
  status: number;
  type?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<ResponseLike>;

/** Where the reload guard keeps the time of the last reload. */
export interface GuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ApiOptions {
  fetch?: FetchFn;
  /** Reload the page (default location.reload). */
  reload?: () => void;
  /** Called instead of a reload when the last one was too recent: themarr is down. */
  onUnreachable?: (reason: string) => void;
  /**
   * Called instead of a reload when there is no session storage for the
   * guard: the page asks the person to reload instead (no reload loop).
   */
  onSessionEnded?: (reason: string) => void;
  /** Session storage for the guard; undefined or throwing: no automatic reload. */
  storage?: () => GuardStorage | undefined;
  now?: () => number;
}

/** No second automatic reload within this time: themarr is down, not the session. */
export const RELOAD_GUARD_MS = 15_000;
const GUARD_KEY = "themarr:admin:reloaded-at";

export type Kind = "store" | "prefs";

/** Which version a path's ETag and If-Match use. */
export function kindOf(path: string): Kind {
  return path.startsWith("/v1/policies") || path.startsWith("/v1/me/") ? "prefs" : "store";
}

const TAG_PATTERN: Record<Kind, RegExp> = { store: /^"\d+"$/, prefs: /^"p\d+"$/ };

function defaultStorage(): GuardStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export class Api {
  /** The last ETag seen per kind, such as `"12"` and `"p4"`. */
  readonly tags: Record<Kind, string | null> = { store: null, prefs: null };
  private readonly fetchFn: FetchFn;
  private readonly reloadFn: () => void;
  private readonly onUnreachable: (reason: string) => void;
  private readonly onSessionEnded: (reason: string) => void;
  private readonly storage: () => GuardStorage | undefined;
  private readonly now: () => number;

  constructor(opts: ApiOptions = {}) {
    this.fetchFn = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.reloadFn = opts.reload ?? (() => globalThis.location.reload());
    this.onUnreachable = opts.onUnreachable ?? (() => {});
    this.onSessionEnded = opts.onSessionEnded ?? (() => {});
    this.storage = opts.storage ?? defaultStorage;
    this.now = opts.now ?? Date.now;
  }

  async get<T>(path: string): Promise<T> {
    return (await this.send<T>("GET", path)).data;
  }

  /** A GET that also returns the answer's ETag. */
  read<T>(path: string): Promise<{ data: T; etag: string | null }> {
    return this.send<T>("GET", path);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return (await this.send<T>("PUT", path, body)).data;
  }

  async delete(path: string): Promise<void> {
    await this.send<void>("DELETE", path);
  }

  /**
   * Keep an ETag. Versions only go up, so an answer that arrives late with an
   * older version doesn't replace a newer one, unless `force` (a full reload).
   */
  setTag(kind: Kind, etag: string | null, force = false): void {
    if (etag === null || !TAG_PATTERN[kind].test(etag)) return;
    const n = (t: string | null): number => (t === null ? -1 : Number(t.replace(/[^0-9]/g, "")));
    if (force || n(etag) >= n(this.tags[kind])) this.tags[kind] = etag;
  }

  /**
   * Reload the page because the session ended, unless a reload just happened
   * (themarr is down), or the guard can't remember one: without session
   * storage (blocked, or a framed page in a browser that partitions it) a
   * reload could repeat for ever, so the page says so instead (T-115).
   */
  private reload(reason: string): never {
    let last: number;
    let store: GuardStorage | undefined;
    try {
      store = this.storage();
      if (store === undefined) throw new Error("no session storage");
      last = Number(store.getItem(GUARD_KEY) ?? 0);
      if (this.now() - last >= RELOAD_GUARD_MS) store.setItem(GUARD_KEY, String(this.now()));
    } catch {
      this.onSessionEnded(reason);
      throw new ApiError(0, "session_ended", "Your sign-in may have ended. Reload the page to sign in again.");
    }
    if (this.now() - last < RELOAD_GUARD_MS) {
      this.onUnreachable(reason);
      throw new ApiError(0, "unreachable", `Themarr can't be reached (${reason}). Try again in a moment.`);
    }
    this.reloadFn();
    throw new Reloading(reason);
  }

  private async send<T>(method: "GET" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ data: T; etag: string | null }> {
    const kind = kindOf(path);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (method !== "GET") {
      const tag = this.tags[kind];
      if (tag === null) throw new ApiError(428, "if_match_required", "The page has no version to send; reload it.");
      headers["If-Match"] = tag;
    }
    const init: RequestInit = { method, headers, credentials: "same-origin", redirect: "manual", cache: "no-store" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res: ResponseLike;
    try {
      res = await this.fetchFn(path, init);
    } catch (err) {
      return this.reload(err instanceof Error ? err.message : "network error");
    }
    if (res.type === "opaqueredirect" || res.status === 0 || (res.status >= 300 && res.status < 400)) {
      return this.reload("redirected (sign-in)");
    }
    const etag = res.headers.get("ETag");
    this.setTag(kind, etag);
    const type = res.headers.get("Content-Type") ?? "";
    const text = await res.text();
    if (res.status >= 200 && res.status < 300) {
      if (res.status === 204 || text === "") return { data: undefined as T, etag };
      if (!type.startsWith("application/json")) return this.reload("not JSON (sign-in page)");
      try {
        return { data: JSON.parse(text) as T, etag };
      } catch {
        return this.reload("unreadable answer");
      }
    }
    let problem: { code?: unknown; detail?: unknown; issues?: unknown; request_id?: unknown } = {};
    if (type.startsWith("application/problem+json") || type.startsWith("application/json")) {
      try {
        problem = JSON.parse(text) as typeof problem;
      } catch {
        problem = {};
      }
    } else if (res.status === 401 || res.status === 403) {
      // Not themarr's answer: Authelia's, so the session is the problem.
      return this.reload(`${res.status} from the sign-in`);
    }
    const issues = Array.isArray(problem.issues) ? (problem.issues as Issue[]) : [];
    throw new ApiError(
      res.status,
      typeof problem.code === "string" ? problem.code : "",
      typeof problem.detail === "string" ? problem.detail : "",
      issues,
      typeof problem.request_id === "string" ? problem.request_id : (res.headers.get("X-Request-Id") ?? ""),
    );
  }
}

/** Everything the admin pages show, read at one store version. */
export interface Snapshot {
  themes: Theme[];
  apps: App[];
  assignments: Assignments;
  favourites: string[];
  policies: Policies;
}

/**
 * Read all the admin data. The store GETs run together; if a write landed
 * between them (their ETags differ), read again, so the next If-Match is
 * the version of what the page shows.
 */
export async function loadSnapshot(api: Api, attempts = 3): Promise<Snapshot> {
  for (let i = 0; ; i++) {
    const seen: Record<Kind, Set<string | null>> = { store: new Set(), prefs: new Set() };
    const read = async <T>(path: string): Promise<T> => {
      const { data, etag } = await api.read<T>(path);
      seen[kindOf(path)].add(etag);
      return data;
    };
    const [themes, apps, assignments, favourites, policies] = await Promise.all([
      read<{ themes: Theme[] }>("/v1/themes"),
      read<{ apps: App[] }>("/v1/apps"),
      read<Assignments>("/v1/assignments"),
      read<{ favourites: string[] }>("/v1/favourites"),
      read<Policies>("/v1/policies"),
    ]);
    if (seen.store.size <= 1 || i + 1 >= attempts) {
      for (const kind of ["store", "prefs"] as const) {
        const [only] = [...seen[kind]];
        if (seen[kind].size === 1 && only !== undefined) api.setTag(kind, only, true);
      }
      return {
        themes: themes.themes,
        apps: apps.apps,
        assignments: { global: assignments.global ?? null, perApp: { ...assignments.perApp } },
        favourites: favourites.favourites,
        policies: { users: { ...policies.users }, groups: { ...policies.groups } },
      };
    }
  }
}
