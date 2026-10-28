// The guest drawer, for people without a themarr session (Seerr's Plex
// users): the SDK draws it itself. It lists the public catalog, previews a
// theme from its public tokens, and keeps one in this browser only (the
// local override). It never saves anything on themarr.

import { clearLocalOverride, getLocalOverride, isThemeId, setLocalOverride } from "../local.ts";
import { parseWire } from "../wire.ts";
import { button, el, show } from "./dom.ts";
import { getJson, type DrawerHost } from "./host.ts";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const MAX_NAME = 200;

interface Swatch {
  primary: string;
  background: string;
  foreground: string;
}

/** One catalog entry, checked. */
export interface CatalogTheme {
  id: string;
  name: string;
  swatch: Partial<Record<"light" | "dark", Swatch>>;
}

export interface Catalog {
  themes: CatalogTheme[];
  favourites: string[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function swatchOf(v: unknown): Swatch | undefined {
  if (!isObject(v)) return undefined;
  const { primary, background, foreground } = v;
  if (typeof primary !== "string" || typeof background !== "string" || typeof foreground !== "string") return undefined;
  if (!HEX.test(primary) || !HEX.test(background) || !HEX.test(foreground)) return undefined;
  return { primary, background, foreground };
}

/** Check GET /v1/catalog's body. Entries out of shape are skipped; a body out of shape is null. */
export function parseCatalog(body: unknown): Catalog | null {
  if (!isObject(body) || !Array.isArray(body["themes"])) return null;
  const themes: CatalogTheme[] = [];
  const seen = new Set<string>();
  for (const t of body["themes"] as unknown[]) {
    if (!isObject(t) || !isThemeId(t["id"]) || seen.has(t["id"])) continue;
    const name = t["name"];
    if (typeof name !== "string" || name.trim() === "" || name.length > MAX_NAME) continue;
    const sw: CatalogTheme["swatch"] = {};
    if (isObject(t["swatch"])) {
      const light = swatchOf(t["swatch"]["light"]);
      const dark = swatchOf(t["swatch"]["dark"]);
      if (light !== undefined) sw.light = light;
      if (dark !== undefined) sw.dark = dark;
    }
    if (sw.light === undefined && sw.dark === undefined) continue;
    seen.add(t["id"]);
    themes.push({ id: t["id"], name, swatch: sw });
  }
  const favs = Array.isArray(body["favourites"]) ? (body["favourites"] as unknown[]) : [];
  const favourites = favs.filter((id): id is string => typeof id === "string" && seen.has(id));
  return { themes, favourites: [...new Set(favourites)] };
}

export class GuestDrawer {
  readonly #host: DrawerHost;
  readonly #box: HTMLElement;
  readonly #root: HTMLElement;
  readonly #abort = new AbortController();
  #catalog: Catalog | undefined;
  #tiles: HTMLElement[] = [];
  #previewId: string | undefined;
  #seq = 0;
  #stopped = false;
  // Filled when the catalog arrives.
  #now: HTMLElement | undefined;
  #bar: HTMLElement | undefined;
  #barText: HTMLElement | undefined;
  #keep: HTMLElement | undefined;
  #forget: HTMLElement | undefined;
  #status: HTMLElement | undefined;
  #foot: HTMLElement | undefined;

  constructor(host: DrawerHost, box: HTMLElement) {
    this.#host = host;
    this.#box = box;
    this.#root = el(host.document, "div", "guest");
  }

  /** The tile buttons, in order (favourites first). */
  get tiles(): readonly HTMLElement[] {
    return this.#tiles;
  }

  async start(): Promise<void> {
    const doc = this.#host.document;
    const note = el(doc, "p", "note");
    note.textContent = "You are not signed in to themarr. A theme you keep here stays in this browser only.";
    this.#root.appendChild(note);
    const loading = el(doc, "p", "now");
    loading.textContent = "Loading themes…";
    this.#root.appendChild(loading);
    this.#box.appendChild(this.#root);
    const res = await getJson(this.#host, "/v1/catalog", this.#abort.signal);
    if (this.#stopped) return;
    const catalog = res.status === 200 ? parseCatalog(res.body) : null;
    if (catalog === null) {
      loading.textContent = "Themarr can't list its themes now. Try again later.";
      return;
    }
    loading.remove();
    this.#catalog = catalog;
    this.#build(catalog);
    this.#update();
  }

  stop(): void {
    this.#stopped = true;
    this.#abort.abort("closed");
    this.#root.remove();
    this.#foot?.remove();
  }

  #name(id: string | null | undefined): string | undefined {
    return this.#catalog?.themes.find((t) => t.id === id)?.name;
  }

  #build(c: Catalog): void {
    const doc = this.#host.document;
    this.#now = el(doc, "div", "now");
    this.#root.appendChild(this.#now);

    this.#bar = el(doc, "div", "bar", { role: "status" });
    this.#barText = el(doc, "span");
    this.#bar.appendChild(this.#barText);
    this.#bar.appendChild(button(doc, "reset", "Reset", () => this.#reset()));
    this.#root.appendChild(this.#bar);

    const byId = new Map(c.themes.map((t) => [t.id, t]));
    const favs = c.favourites.map((id) => byId.get(id)).filter((t): t is CatalogTheme => t !== undefined);
    if (favs.length > 0) this.#section("Favourites", favs);
    this.#section("All themes", c.themes);
    if (c.themes.length === 0) {
      const none = el(doc, "p", "now");
      none.textContent = "Themarr has no themes yet.";
      this.#root.appendChild(none);
    }

    const foot = el(doc, "div", "foot");
    this.#status = el(doc, "span", "status", { "aria-live": "polite" });
    this.#keep = button(doc, "keep", "Keep in this browser", () => void this.#keepLocal());
    this.#forget = button(doc, "forget", "Use the app's theme", () => void this.#clearLocal());
    foot.appendChild(this.#status);
    foot.appendChild(this.#keep);
    foot.appendChild(this.#forget);
    this.#box.appendChild(foot);
    this.#foot = foot;
  }

  #section(label: string, themes: CatalogTheme[]): void {
    const doc = this.#host.document;
    const title = el(doc, "span", "label");
    title.textContent = label;
    const grid = el(doc, "div", "grid", { role: "group", "aria-label": label });
    const mode = this.#host.mode();
    for (const t of themes) {
      const sw = t.swatch[mode] ?? t.swatch.light ?? t.swatch.dark;
      const band = t.swatch.dark ?? sw;
      const tile = el(doc, "button", "tile", { type: "button", "aria-label": `Preview ${t.name}`, "aria-pressed": "false", "data-theme": t.id });
      // Custom properties through the CSSOM: allowed under a strict CSP,
      // unlike a style attribute. Every value was checked as #RRGGBB.
      if (sw !== undefined) tile.style.setProperty("--t-bg", sw.primary);
      if (band !== undefined) {
        tile.style.setProperty("--t-band", band.background);
        tile.style.setProperty("--t-band-fg", band.foreground);
      }
      const name = el(doc, "span");
      name.textContent = t.name;
      tile.appendChild(name);
      tile.addEventListener("click", () => void this.#preview(t.id));
      grid.appendChild(tile);
      this.#tiles.push(tile);
    }
    this.#root.appendChild(title);
    this.#root.appendChild(grid);
  }

  #update(): void {
    const local = getLocalOverride(this.#host.app, this.#host.storage());
    const cur = this.#host.current();
    const nowName = cur.source === "local" ? this.#name(local) : undefined;
    if (this.#now !== undefined) {
      this.#now.textContent = "";
      const b = el(this.#host.document, "b");
      b.textContent = nowName ?? "The app's theme";
      this.#now.appendChild(b);
      const from = el(this.#host.document, "span");
      from.textContent = nowName !== undefined ? " · kept in this browser" : "";
      this.#now.appendChild(from);
    }
    for (const t of this.#tiles) t.setAttribute("aria-pressed", String(t.getAttribute("data-theme") === this.#previewId));
    const previewName = this.#name(this.#previewId);
    if (this.#bar !== undefined) show(this.#bar, previewName !== undefined);
    if (this.#barText !== undefined) this.#barText.textContent = previewName === undefined ? "" : `Previewing ${previewName} in this tab only.`;
    if (this.#keep !== undefined) {
      const can = previewName !== undefined && this.#previewId !== local;
      this.#keep.textContent = previewName === undefined ? "Keep in this browser" : `Keep ${previewName} in this browser`;
      if (can) this.#keep.removeAttribute("disabled");
      else this.#keep.setAttribute("disabled", "");
    }
    if (this.#forget !== undefined) show(this.#forget, local !== null);
  }

  #say(text: string): void {
    if (this.#status !== undefined) this.#status.textContent = text;
  }

  async #preview(id: string): Promise<void> {
    const seq = ++this.#seq;
    const res = await getJson(this.#host, `/v1/themes/${encodeURIComponent(id)}/tokens`, this.#abort.signal);
    if (this.#stopped || seq !== this.#seq) return;
    const parsed = res.status === 200 ? parseWire(res.body) : undefined;
    if (parsed === undefined || !parsed.ok) {
      this.#say("Themarr can't send this theme now.");
      return;
    }
    this.#host.preview(parsed.theme);
    this.#previewId = id;
    this.#say("");
    this.#update();
  }

  #reset(): void {
    this.#seq++;
    this.#host.preview(undefined);
    this.#previewId = undefined;
    this.#say("");
    this.#update();
  }

  async #keepLocal(): Promise<void> {
    const id = this.#previewId;
    if (id === undefined) return;
    if (!setLocalOverride(this.#host.app, id, this.#host.storage())) {
      this.#say("This browser does not let the page keep it.");
      return;
    }
    await this.#host.refresh();
    if (this.#stopped) return;
    this.#host.preview(undefined);
    this.#previewId = undefined;
    this.#say("Kept in this browser.");
    this.#update();
  }

  async #clearLocal(): Promise<void> {
    clearLocalOverride(this.#host.app, this.#host.storage());
    await this.#host.refresh();
    if (this.#stopped) return;
    this.#host.preview(undefined);
    this.#previewId = undefined;
    this.#say("This browser uses the app's theme again.");
    this.#update();
  }
}
