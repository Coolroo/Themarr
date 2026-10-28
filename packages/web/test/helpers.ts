// Test doubles: a fake fetch with routes, and a small fake DOM (document,
// adoptedStyleSheets, <head>, localStorage, window events). No jsdom.

import { readFileSync } from "node:fs";
import type { BootOptions, Env, EnvDocument, EnvElement, EnvSheet, EnvStorage, EnvWindow, FetchInit, FetchLike, FetchResponse } from "../src/types.ts";

export const BASE = "https://themarr.test";
export const APP = "demo";
export const PUBLIC = `/v1/apps/${APP}/theme`;
export const PERSONAL = `/v1/me/apps/${APP}/theme`;
export const tokensPath = (id: string): string => `/v1/themes/${id}/tokens`;

type Json = Record<string, any>;

/** A golden fixture from packages/tokens as the server sends it: version, modes, tokens. */
export function wire(name: "seeded-indigo" | "seeded-with-tag" | "handmade-synth-dark", extra: Json = {}): Json {
  const t = JSON.parse(readFileSync(new URL(`../../tokens/fixtures/valid/${name}.json`, import.meta.url), "utf8")) as Json;
  return { version: t["version"], modes: t["modes"], tokens: t["tokens"], ...extra };
}

export interface Reply {
  /** Default 200. */
  status?: number;
  body?: unknown;
  etag?: string;
  /** Answer after this many ms. */
  delayMs?: number;
  /** Never answer, and ignore the abort signal. */
  hang?: boolean;
  /** Reject with this message (a network error, such as a CORS refusal). */
  error?: string;
  /** The body is not JSON. */
  badJson?: boolean;
}

export type Route = Reply | ((init: FetchInit) => Reply);

export interface Call {
  path: string;
  init: FetchInit;
}

/**
 * Throw as a browser does when a method runs on the wrong object, such as
 * `const f = window.matchMedia; f(q)` or `host.fetch(url)`: "Illegal
 * invocation". The fakes call it first, so an SDK that takes a browser API
 * off its object and calls it unbound fails the tests.
 */
export function owner(self: unknown, ok: boolean, what: string): void {
  if (!ok) throw new TypeError(`Failed to execute '${what}': Illegal invocation (this is ${self === undefined ? "undefined" : typeof self})`);
}

export function fakeFetch(routes: Record<string, Route>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  // A browser's fetch works only on the global object (or called bare).
  async function strictFetch(this: unknown, url: string, init: FetchInit): Promise<FetchResponse> {
    owner(this, this === undefined || this === globalThis, "fetch");
    if (!url.startsWith(BASE)) throw new TypeError(`unexpected URL ${url}`);
    const path = url.slice(BASE.length);
    calls.push({ path, init });
    const route = routes[path];
    if (route === undefined) throw new TypeError(`no route for ${path}`);
    const r = typeof route === "function" ? route(init) : route;
    if (r.hang) return new Promise<FetchResponse>(() => {});
    if (r.delayMs !== undefined) await new Promise((res) => setTimeout(res, r.delayMs));
    if (r.error !== undefined) throw new TypeError(r.error);
    const headers = new Map<string, string>();
    if (r.etag !== undefined) headers.set("etag", r.etag);
    return {
      status: r.status ?? 200,
      headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
      json: async () => {
        if (r.badJson) throw new SyntaxError("Unexpected token < in JSON");
        return structuredClone(r.body);
      },
    };
  }
  const fetch: FetchLike = strictFetch;
  return { fetch, calls };
}

export class FakeSheet implements EnvSheet {
  cssText = "";
  replaceSync(text: string): void {
    this.cssText = text;
  }
}

class FakeElement implements EnvElement {
  id = "";
  textContent: string | null = null;
  readonly tagName: string;
  readonly attrs = new Map<string, string>();
  parent: FakeHead | undefined;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
}

class FakeHead {
  children: FakeElement[] = [];
  appendChild(el: EnvElement): EnvElement {
    const e = el as FakeElement;
    e.remove();
    this.children.push(e);
    e.parent = this;
    return e;
  }
  removeChild(el: FakeElement): void {
    this.children = this.children.filter((c) => c !== el);
    el.parent = undefined;
  }
}

class Events {
  readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    owner(this, this instanceof Events, "addEventListener");
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    owner(this, this instanceof Events, "removeEventListener");
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  count(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

export class FakeDocument extends Events implements EnvDocument {
  adoptedStyleSheets?: EnvSheet[];
  readonly head = new FakeHead();
  visibilityState = "visible";
  constructor(constructable: boolean) {
    super();
    if (constructable) this.adoptedStyleSheets = [];
  }
  createElement(tag: "style"): EnvElement {
    owner(this, this instanceof FakeDocument, "createElement");
    return new FakeElement(tag);
  }
  getElementById(id: string): EnvElement | null {
    owner(this, this instanceof FakeDocument, "getElementById");
    return this.head.children.find((c) => c.id === id) ?? null;
  }
  /** Add an element as the server would have rendered it. */
  addServerStyle(css: string): FakeElement {
    const el = new FakeElement("style");
    el.id = "themarr";
    el.textContent = css;
    this.head.appendChild(el);
    return el;
  }
}

export class FakeWindow extends Events implements EnvWindow {
  CSSStyleSheet?: new () => EnvSheet;
  constructor(constructable: boolean) {
    super();
    if (constructable) this.CSSStyleSheet = FakeSheet;
  }
}

export class FakeStorage implements EnvStorage {
  readonly map = new Map<string, string>();
  blocked = false;
  getItem(key: string): string | null {
    owner(this, this instanceof FakeStorage, "getItem");
    if (this.blocked) throw new Error("SecurityError");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    owner(this, this instanceof FakeStorage, "setItem");
    if (this.blocked) throw new Error("SecurityError");
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    owner(this, this instanceof FakeStorage, "removeItem");
    if (this.blocked) throw new Error("SecurityError");
    this.map.delete(key);
  }
}

export interface Browser {
  env: Env;
  doc: FakeDocument;
  win: FakeWindow;
  storage: FakeStorage;
  /** The theme CSS on the page: the adopted sheets' text, then <style> elements'. */
  css(): string;
}

export function browser(constructable = true): Browser {
  const doc = new FakeDocument(constructable);
  const win = new FakeWindow(constructable);
  const storage = new FakeStorage();
  return {
    env: { document: doc, window: win, storage: () => storage },
    doc,
    win,
    storage,
    css: () =>
      [
        ...(doc.adoptedStyleSheets ?? []).map((s) => (s as FakeSheet).cssText),
        ...doc.head.children.map((c) => c.textContent ?? ""),
      ].join(""),
  };
}

/** Collect console.warn lines while fn runs. */
export async function warnings<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.warn = orig;
  }
}

/** Options for a browser boot against BASE/APP with the given fake fetch and env. */
export function opts(fetch: FetchLike, env: Env | undefined, more: Partial<BootOptions> = {}): BootOptions {
  const o: BootOptions = { app: APP, url: BASE, _fetch: fetch, ...more };
  if (env !== undefined) o._env = env;
  return o;
}

/** A Node-like env: no document, no window, no storage. */
export const NODE_ENV: Env = {};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
