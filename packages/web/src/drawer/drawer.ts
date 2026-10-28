// The in-app drawer (boot option `drawer`): a themarr button in the app's
// corner that opens a sidebar. Signed-in people get themarr's /drawer page
// in an iframe; guests get a local-only panel the SDK draws (guest.ts).
//
// Everything lives in one <themarr-drawer> element with an open shadow root,
// so the app's CSS can't reach it and its CSS can't reach the app. Its
// styles go in as a constructable sheet (or a <style> with the nonce).

import type { DrawerOptions, DrawerPosition } from "../types.ts";
import { button, el, logo, show } from "./dom.ts";
import { FrameDrawer } from "./frame.ts";
import { GuestDrawer } from "./guest.ts";
import type { DrawerHost } from "./host.ts";
import { DRAWER_CSS } from "./styles.ts";

export const HOST_TAG = "themarr-drawer";

/** localStorage key that remembers "Hide button" for an app. */
export function launcherKey(app: string): string {
  return `themarr:${app}:launcher`;
}

/** The checked position, or null when the option is out of shape. */
export function drawerPosition(opt: boolean | DrawerOptions | undefined): DrawerPosition | null {
  if (opt === true) return "bottom-right";
  if (typeof opt !== "object" || opt === null) return null;
  const p = opt.position ?? "bottom-right";
  return p === "bottom-right" || p === "bottom-left" ? p : null;
}

export class Drawer {
  readonly #host: DrawerHost;
  readonly element: HTMLElement;
  readonly shadow: ShadowRoot;
  readonly launcher: HTMLElement;
  readonly tab: HTMLElement;
  readonly panel: HTMLElement;
  readonly #body: HTMLElement;
  #open = false;
  #hidden: boolean;
  #frame: FrameDrawer | undefined;
  #guest: GuestDrawer | undefined;
  #returnTo: Element | null = null;
  #destroyed = false;
  readonly #onKey = (ev: Event): void => {
    const k = ev as KeyboardEvent;
    if (k.key === "Escape" && this.#open) {
      k.preventDefault();
      k.stopPropagation();
      this.close();
    }
  };
  readonly #onReady = (): void => this.#attach();

  constructor(host: DrawerHost, position: DrawerPosition) {
    this.#host = host;
    const doc = host.document;
    this.element = doc.createElement(HOST_TAG);
    this.shadow = this.element.attachShadow({ mode: "open" });
    this.#style();
    const side = el(doc, "div", position === "bottom-left" ? "left" : "right");

    this.launcher = button(doc, "launcher", "", () => this.open(), { "aria-label": "Open themarr" });
    this.launcher.appendChild(logo(doc));
    this.tab = button(doc, "tab", "", () => this.unhide(), { "aria-label": "Show the themarr button" });

    this.panel = el(doc, "div", "panel", { role: "dialog", "aria-label": `Themarr for ${host.app}`, tabindex: "-1" });
    const head = el(doc, "div", "head");
    head.appendChild(logo(doc));
    const title = el(doc, "span", "title");
    title.textContent = `themarr · ${host.app}`;
    head.appendChild(title);
    head.appendChild(button(doc, "hide", "Hide button", () => this.hide()));
    head.appendChild(button(doc, "close", "×", () => this.close(), { "aria-label": "Close" }));
    this.#body = el(doc, "div", "body");
    this.panel.appendChild(head);
    this.panel.appendChild(this.#body);

    side.appendChild(this.launcher);
    side.appendChild(this.tab);
    side.appendChild(this.panel);
    this.shadow.appendChild(side);
    this.shadow.addEventListener("keydown", this.#onKey);

    this.#hidden = this.#readHidden();
    this.#sync();
    if (doc.body !== null) this.#attach();
    else doc.addEventListener("DOMContentLoaded", this.#onReady, { once: true });
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** The signed-in iframe, while open. */
  get frame(): FrameDrawer | undefined {
    return this.#frame;
  }

  /** The guest panel, while open. */
  get guest(): GuestDrawer | undefined {
    return this.#guest;
  }

  #attach(): void {
    if (this.#destroyed || this.element.isConnected) return;
    this.#host.document.body?.appendChild(this.element);
  }

  #style(): void {
    const Ctor = (this.#host.window as unknown as { CSSStyleSheet?: new () => CSSStyleSheet }).CSSStyleSheet;
    if (Ctor !== undefined && "adoptedStyleSheets" in this.shadow) {
      try {
        const sheet = new Ctor();
        sheet.replaceSync(DRAWER_CSS);
        this.shadow.adoptedStyleSheets = [sheet];
        return;
      } catch {
        // Fall back to a <style> element below.
      }
    }
    const style = el(this.#host.document, "style");
    if (this.#host.nonce !== undefined) style.setAttribute("nonce", this.#host.nonce);
    style.textContent = DRAWER_CSS;
    this.shadow.appendChild(style);
  }

  #readHidden(): boolean {
    try {
      return this.#host.storage()?.getItem(launcherKey(this.#host.app)) === "hidden";
    } catch {
      return false;
    }
  }

  #writeHidden(hidden: boolean): void {
    try {
      const s = this.#host.storage();
      if (hidden) s?.setItem(launcherKey(this.#host.app), "hidden");
      else s?.removeItem(launcherKey(this.#host.app));
    } catch {
      // Blocked storage: the choice lasts until the page reloads.
    }
  }

  #sync(): void {
    show(this.panel, this.#open);
    show(this.launcher, !this.#open && !this.#hidden);
    show(this.tab, !this.#open && this.#hidden);
  }

  open(): void {
    if (this.#open || this.#destroyed) return;
    this.#returnTo = this.#host.document.activeElement;
    this.#open = true;
    this.#sync();
    if (this.#host.signedIn()) {
      this.#frame = new FrameDrawer(this.#host, this.#body, () => this.close());
      this.#frame.start();
    } else {
      this.#guest = new GuestDrawer(this.#host, this.#body);
      void this.#guest.start();
    }
    this.panel.focus();
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#frame?.stop();
    this.#frame = undefined;
    this.#guest?.stop();
    this.#guest = undefined;
    this.#body.replaceChildren();
    // Previews never outlive the drawer.
    this.#host.preview(undefined);
    this.#sync();
    this.#restoreFocus();
  }

  #restoreFocus(): void {
    const back = this.#returnTo;
    this.#returnTo = null;
    // Focus that came from inside the drawer (the launcher) shows as the
    // host element; it goes back to the launcher, or the tab when hidden.
    if (back !== null && back !== this.element && back !== this.#host.document.body && back.isConnected && "focus" in back) {
      (back as HTMLElement).focus();
      return;
    }
    (this.#hidden ? this.tab : this.launcher).focus();
  }

  /** "Hide button": close, and leave a thin tab at the screen's edge (remembered). */
  hide(): void {
    this.#hidden = true;
    this.#writeHidden(true);
    if (this.#open) {
      this.#returnTo = null;
      this.close();
    } else {
      this.#sync();
    }
    this.tab.focus();
  }

  /** The tab: show the button again. */
  unhide(): void {
    this.#hidden = false;
    this.#writeHidden(false);
    this.#sync();
    this.launcher.focus();
  }

  destroy(): void {
    if (this.#destroyed) return;
    if (this.#open) {
      this.#returnTo = null;
      this.close();
    }
    this.#destroyed = true;
    this.shadow.removeEventListener("keydown", this.#onKey);
    this.#host.document.removeEventListener("DOMContentLoaded", this.#onReady);
    this.element.remove();
  }
}
