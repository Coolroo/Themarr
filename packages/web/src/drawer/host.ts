// What the drawer needs from boot: the app, themarr's address, the browser
// objects, and a way to preview and refresh. boot.ts implements it.

import type { Mode } from "@themarr/tokens";
import type { EnvStorage, FetchLike, WireTheme } from "../types.ts";
import type { DrawerCurrent } from "./protocol.ts";

export interface DrawerHost {
  /** The app's ID in themarr. */
  readonly app: string;
  /** Themarr's base URL, without a trailing slash. */
  readonly base: string;
  /** Themarr's exact origin: the only one the drawer talks to. */
  readonly origin: string;
  readonly nonce: string | undefined;
  readonly fetch: FetchLike;
  readonly document: Document;
  readonly window: Window;
  /** How long the drawer page has to say "ready" before the drawer offers a new tab. */
  readonly readyMs: number;
  storage(): EnvStorage | undefined;
  /** The person has a themarr session: the personal request answered 200 or 204. */
  signedIn(): boolean;
  current(): DrawerCurrent;
  /** The mode the app shows now. */
  mode(): Mode;
  /** Show theme on the app in this tab only; undefined shows the resolved theme again. */
  preview(theme: WireTheme | undefined, mode?: Mode): void;
  /** Ask themarr again and apply the result. */
  refresh(): Promise<void>;
}

const REQUEST_MS = 5000;

/**
 * GET a public themarr route as JSON, with no credentials and no request
 * headers (no CORS preflight). Resolves to the status and the body (or
 * undefined), and never throws.
 */
export async function getJson(host: DrawerHost, path: string, signal?: AbortSignal): Promise<{ status: number; body?: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), REQUEST_MS);
  const onOuter = (): void => ctrl.abort("aborted");
  signal?.addEventListener("abort", onOuter);
  try {
    const res = await host.fetch(`${host.base}${path}`, { method: "GET", credentials: "omit", redirect: "error", headers: {}, signal: ctrl.signal });
    if (res.status !== 200) return { status: res.status };
    return { status: 200, body: await res.json() };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuter);
  }
}
