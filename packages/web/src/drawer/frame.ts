// The signed-in drawer: themarr's /drawer page in an iframe. All saving
// happens inside the page (same-origin calls with the person's session);
// the app only previews and refreshes, on the page's messages.
//
// A message counts only when all three hold: event.origin is themarr's
// exact origin, event.source is this iframe's window, and the data is one
// of the protocol's shapes. Everything else is ignored, silently.

import { clearLocalOverride, setLocalOverride } from "../local.ts";
import { el } from "./dom.ts";
import type { DrawerHost } from "./host.ts";
import { DRAWER_PROTOCOL, parseDrawerMessage, type DrawerHello, type FromDrawer } from "./protocol.ts";

/** The iframe may run its scripts, call themarr and open a new tab; it may not navigate the app. */
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

export class FrameDrawer {
  readonly #host: DrawerHost;
  readonly #box: HTMLElement;
  readonly #close: () => void;
  readonly #iframe: HTMLIFrameElement;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #ready = false;
  #stopped = false;
  readonly #onMessage = (ev: MessageEvent): void => this.#receive(ev);

  constructor(host: DrawerHost, box: HTMLElement, close: () => void) {
    this.#host = host;
    this.#box = box;
    this.#close = close;
    this.#iframe = el(host.document, "iframe", "frame", {
      src: this.pageUrl(),
      title: "Themarr",
      sandbox: SANDBOX,
      referrerpolicy: "no-referrer",
    }) as HTMLIFrameElement;
  }

  /** The drawer page for this app. */
  pageUrl(): string {
    return `${this.#host.base}/drawer?app=${encodeURIComponent(this.#host.app)}`;
  }

  get iframe(): HTMLIFrameElement {
    return this.#iframe;
  }

  start(): void {
    this.#host.window.addEventListener("message", this.#onMessage);
    this.#box.appendChild(this.#iframe);
    this.#timer = setTimeout(() => this.#fallback(), this.#host.readyMs);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#host.window.removeEventListener("message", this.#onMessage);
    this.#iframe.remove();
  }

  focus(): void {
    this.#iframe.focus();
  }

  /** Tell the page what the app shows now. */
  hello(): void {
    const msg: DrawerHello = {
      themarr: DRAWER_PROTOCOL,
      type: "hello",
      app: this.#host.app,
      mode: this.#host.mode(),
      current: this.#host.current(),
    };
    // The exact origin, never "*": the message goes nowhere if the frame
    // was navigated away from themarr.
    this.#iframe.contentWindow?.postMessage(msg, this.#host.origin);
  }

  #receive(ev: MessageEvent): void {
    if (this.#stopped) return;
    if (ev.origin !== this.#host.origin) return;
    const win = this.#iframe.contentWindow;
    if (win === null || ev.source !== win) return;
    const msg = parseDrawerMessage(ev.data);
    if (msg === null) return;
    void this.#act(msg);
  }

  async #act(msg: FromDrawer): Promise<void> {
    const host = this.#host;
    switch (msg.type) {
      case "ready":
        this.#ready = true;
        if (this.#timer !== undefined) clearTimeout(this.#timer);
        this.hello();
        return;
      case "preview":
        host.preview(msg.body, msg.mode);
        return;
      case "clearPreview":
        host.preview(undefined);
        return;
      case "close":
        this.#close();
        return;
      case "keepLocal":
        if (host.current().locked) return; // An enforced theme: preview only.
        if (!setLocalOverride(host.app, msg.themeId, host.storage())) return;
        break;
      case "clearLocal":
        clearLocalOverride(host.app, host.storage());
        break;
      case "saved":
        // A local override sits above the saved choice: drop it, or the
        // person would not see what they saved.
        if (msg.scope === "me") clearLocalOverride(host.app, host.storage());
        break;
    }
    await host.refresh();
    if (this.#stopped) return;
    host.preview(undefined);
    this.hello();
  }

  /** The page never said "ready" (no session, or Authelia refused to be framed): offer a new tab. */
  #fallback(): void {
    if (this.#ready || this.#stopped) return;
    const doc = this.#host.document;
    this.#iframe.remove();
    const box = el(doc, "div", "fallback");
    const p = el(doc, "p", "note");
    p.textContent = "Themarr could not open here. Sign in to themarr in a new tab, then open the drawer again.";
    const a = el(doc, "a", undefined, { href: this.pageUrl(), target: "_blank", rel: "noopener noreferrer" });
    a.textContent = "Sign in to themarr";
    box.appendChild(p);
    box.appendChild(a);
    this.#box.appendChild(box);
  }
}
