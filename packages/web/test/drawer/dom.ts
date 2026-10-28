// A small fake DOM for the drawer tests: elements with attributes, children,
// listeners (with bubbling through a shadow root to its host), focus, a
// shadow root with adoptedStyleSheets, an iframe with a contentWindow that
// records postMessage, and a window that delivers message events. It also
// satisfies the boot's EnvDocument and EnvWindow. No jsdom.

import type { Env, EnvSheet } from "../../src/types.ts";
import { FakeSheet, FakeStorage, owner } from "../helpers.ts";

type Fn = (ev: FEvent) => void;

export class FEvent {
  readonly type: string;
  key?: string;
  data?: unknown;
  origin?: string;
  source?: unknown;
  target: FEl | undefined;
  defaultPrevented = false;
  stopped = false;
  constructor(type: string, init: Partial<Pick<FEvent, "key" | "data" | "origin" | "source">> = {}) {
    this.type = type;
    Object.assign(this, init);
    this.target = undefined;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
}

class Listeners {
  readonly map = new Map<string, { fn: Fn; once: boolean }[]>();
  add(type: string, fn: Fn, opts?: unknown): void {
    const once = typeof opts === "object" && opts !== null && (opts as { once?: boolean }).once === true;
    const list = this.map.get(type) ?? [];
    if (!list.some((l) => l.fn === fn)) list.push({ fn, once });
    this.map.set(type, list);
  }
  remove(type: string, fn: Fn): void {
    this.map.set(
      type,
      (this.map.get(type) ?? []).filter((l) => l.fn !== fn),
    );
  }
  fire(ev: FEvent): void {
    for (const l of [...(this.map.get(ev.type) ?? [])]) {
      if (l.once) this.remove(ev.type, l.fn);
      l.fn(ev);
    }
  }
  count(type: string): number {
    return this.map.get(type)?.length ?? 0;
  }
}

/** A window inside the iframe: it records what the SDK posts. */
export class FContentWindow {
  readonly posted: { msg: unknown; targetOrigin: string }[] = [];
  postMessage(msg: unknown, targetOrigin: string): void {
    owner(this, this instanceof FContentWindow, "postMessage");
    this.posted.push({ msg: structuredClone(msg), targetOrigin });
  }
}

export class FEl {
  readonly tagName: string;
  readonly ownerDocument: FDoc;
  readonly attrs = new Map<string, string>();
  children: FEl[] = [];
  parent: FEl | null = null;
  shadowRoot: FShadow | null = null;
  contentWindow: FContentWindow | null = null;
  readonly listeners = new Listeners();
  readonly style = {
    props: new Map<string, string>(),
    setProperty(k: string, v: string): void {
      this.props.set(k, v);
    },
  };
  #text = "";

  constructor(tag: string, doc: FDoc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    if (this.tagName === "IFRAME") this.contentWindow = new FContentWindow();
  }

  get id(): string {
    return this.attrs.get("id") ?? "";
  }
  set id(v: string) {
    this.attrs.set("id", v);
  }
  get textContent(): string {
    return this.#text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string | null) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.#text = v ?? "";
  }
  setAttribute(k: string, v: string): void {
    owner(this, this instanceof FEl, "setAttribute");
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    owner(this, this instanceof FEl, "getAttribute");
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string): void {
    owner(this, this instanceof FEl, "removeAttribute");
    this.attrs.delete(k);
  }
  hasAttribute(k: string): boolean {
    owner(this, this instanceof FEl, "hasAttribute");
    return this.attrs.has(k);
  }
  get hidden(): boolean {
    return this.attrs.has("hidden");
  }
  appendChild<T extends FEl>(c: T): T {
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  replaceChildren(...nodes: FEl[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  removeChild(c: FEl): void {
    this.children = this.children.filter((x) => x !== c);
    c.parent = null;
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
  /** The next node up, through a shadow root to its host. */
  up(): FEl | null {
    return this.parent;
  }
  get isConnected(): boolean {
    let n: FEl | null = this;
    while (n !== null) {
      if (n === this.ownerDocument.documentElement) return true;
      n = n.up();
    }
    return false;
  }
  addEventListener(type: string, fn: Fn, opts?: unknown): void {
    owner(this, this instanceof FEl, "addEventListener");
    this.listeners.add(type, fn, opts);
  }
  removeEventListener(type: string, fn: Fn): void {
    owner(this, this instanceof FEl, "removeEventListener");
    this.listeners.remove(type, fn);
  }
  dispatch(ev: FEvent): FEvent {
    ev.target ??= this;
    let n: FEl | null = this;
    while (n !== null && !ev.stopped) {
      n.listeners.fire(ev);
      n = n.up();
    }
    return ev;
  }
  click(): void {
    if (this.hasAttribute("disabled")) return;
    this.dispatch(new FEvent("click"));
  }
  key(key: string): FEvent {
    return this.dispatch(new FEvent("keydown", { key }));
  }
  focus(): void {
    owner(this, this instanceof FEl, "focus");
    this.ownerDocument.focused = this;
  }
  attachShadow(_init: { mode: string }): FShadow {
    owner(this, this instanceof FEl, "attachShadow");
    this.shadowRoot = new FShadow(this);
    return this.shadowRoot;
  }
  /** Depth-first search of this node, its children and shadow roots. */
  all(): FEl[] {
    const out: FEl[] = [this];
    if (this.shadowRoot !== null) out.push(...this.shadowRoot.all());
    for (const c of this.children) out.push(...c.all());
    return out;
  }
  find(pred: (e: FEl) => boolean): FEl | undefined {
    return this.all().find(pred);
  }
  byClass(cls: string): FEl | undefined {
    return this.find((e) => (e.getAttribute("class") ?? "").split(" ").includes(cls));
  }
  byTag(tag: string): FEl | undefined {
    return this.find((e) => e.tagName === tag.toUpperCase());
  }
}

export class FShadow extends FEl {
  readonly host: FEl;
  adoptedStyleSheets: EnvSheet[] = [];
  constructor(host: FEl) {
    super("#shadow-root", host.ownerDocument);
    this.host = host;
  }
  override up(): FEl | null {
    return this.host;
  }
  get activeElement(): FEl | null {
    const f = this.ownerDocument.focused;
    if (f === null) return null;
    let n: FEl | null = f;
    while (n !== null) {
      if (n.parent === null && n instanceof FShadow) return n === this ? f : null;
      n = n.parent;
    }
    return null;
  }
}

export class FDoc {
  readonly documentElement: FEl;
  readonly head: FEl;
  body: FEl | null;
  adoptedStyleSheets?: EnvSheet[];
  visibilityState = "visible";
  focused: FEl | null = null;
  readonly listeners = new Listeners();
  /** What querySelector answers: the selectors that match the root (dark mode tests). */
  matching = new Set<string>();
  readonly queries: string[] = [];

  constructor(constructable: boolean, withBody = true) {
    this.documentElement = new FEl("html", this);
    this.head = this.documentElement.appendChild(new FEl("head", this));
    this.body = withBody ? this.documentElement.appendChild(new FEl("body", this)) : null;
    if (constructable) this.adoptedStyleSheets = [];
  }
  addBody(): void {
    this.body = this.documentElement.appendChild(new FEl("body", this));
    this.listeners.fire(new FEvent("DOMContentLoaded"));
  }
  createElement(tag: string): FEl {
    owner(this, this instanceof FDoc, "createElement");
    return new FEl(tag, this);
  }
  getElementById(id: string): FEl | null {
    owner(this, this instanceof FDoc, "getElementById");
    return this.documentElement.find((e) => e.id === id) ?? null;
  }
  querySelector(sel: string): FEl | null {
    owner(this, this instanceof FDoc, "querySelector");
    this.queries.push(sel);
    return sel.split(",").some((s) => this.matching.has(s.trim())) ? this.documentElement : null;
  }
  /** Like a browser: focus inside a shadow root shows as its host. */
  get activeElement(): FEl | null {
    let f = this.focused;
    if (f === null) return this.body;
    let n: FEl | null = f;
    while (n !== null) {
      if (n instanceof FShadow) f = n.host;
      n = n.up();
    }
    return f;
  }
  addEventListener(type: string, fn: Fn, opts?: unknown): void {
    owner(this, this instanceof FDoc, "addEventListener");
    this.listeners.add(type, fn, opts);
  }
  removeEventListener(type: string, fn: Fn): void {
    owner(this, this instanceof FDoc, "removeEventListener");
    this.listeners.remove(type, fn);
  }
}

export class FWin {
  CSSStyleSheet?: new () => EnvSheet;
  readonly listeners = new Listeners();
  prefersDark = false;
  constructor(constructable: boolean) {
    if (constructable) this.CSSStyleSheet = FakeSheet;
  }
  addEventListener(type: string, fn: Fn): void {
    owner(this, this instanceof FWin, "addEventListener");
    this.listeners.add(type, fn);
  }
  removeEventListener(type: string, fn: Fn): void {
    owner(this, this instanceof FWin, "removeEventListener");
    this.listeners.remove(type, fn);
  }
  matchMedia(q: string): { matches: boolean } {
    owner(this, this instanceof FWin, "matchMedia");
    return { matches: q === "(prefers-color-scheme: dark)" && this.prefersDark };
  }
  /** Deliver a message event, as postMessage from another window would. */
  message(data: unknown, origin: string, source: unknown): void {
    this.listeners.fire(new FEvent("message", { data, origin, source }));
  }
}

export interface Dom {
  env: Env;
  doc: FDoc;
  win: FWin;
  storage: FakeStorage;
  /** The theme CSS on the page (the boot's sheet or <style>). */
  css(): string;
  /** The drawer's host element, if mounted. */
  drawer(): FEl | undefined;
  /** An element in the drawer's shadow root, by class. */
  part(cls: string): FEl;
}

export function dom(constructable = true, storage = new FakeStorage(), withBody = true): Dom {
  const doc = new FDoc(constructable, withBody);
  const win = new FWin(constructable);
  const env = { document: doc, window: win, storage: () => storage } as unknown as Env;
  const drawer = (): FEl | undefined => doc.documentElement.find((e) => e.tagName === "THEMARR-DRAWER");
  return {
    env,
    doc,
    win,
    storage,
    css: () =>
      [
        ...(doc.adoptedStyleSheets ?? []).map((s) => (s as FakeSheet).cssText),
        ...doc.head.children.filter((c) => c.tagName === "STYLE").map((c) => c.textContent),
      ].join(""),
    drawer,
    part: (cls: string) => {
      const d = drawer();
      const e = d?.shadowRoot?.byClass(cls);
      if (e === undefined) throw new Error(`no .${cls} in the drawer`);
      return e;
    },
  };
}

/** Let pending promises and fake fetches settle. */
export async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}
