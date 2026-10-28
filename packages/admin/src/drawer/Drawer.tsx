// The drawer page: themarr's own page inside the SDK's drawer iframe
// (decision 0009). It lists the themes as tiles, previews one on the app
// (postMessage, protocol version 1), and keeps a choice: in this browser
// (the SDK's local override), for the person (their saved choice on
// themarr), or, for admins, for everyone on the app. Admins also get an
// Edit tab: a seeded copy of a theme, previewed live, saved as a new theme.
//
// Messages: "ready" goes to window.parent with targetOrigin "*" (it carries
// nothing). "hello" is accepted only from window.parent, through
// parseAppMessage; its origin is kept and every later message goes to that
// exact origin. themarr's frame-ancestors (the app's registered origins)
// decide who may frame this page at all.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { makeSeededTheme } from "@themarr/palette";
import { CONTRAST_LEVELS, SCHEME_STYLES, type ContrastLevel, type Mode, type SchemeStyle, type Theme } from "@themarr/tokens";
import { parseAppMessage, type DrawerHello, type FromDrawer, type WireTheme } from "@themarr/web";
import { Api, ApiError, Reloading, type Assignments } from "../api.ts";
import { Segmented } from "../components/common.tsx";
import { applyLabel, scopeHint, scopes, seeNow, tiles, type Catalog, type Scope, type Tile } from "../logic/drawer.ts";
import { slugify } from "../logic/editor.ts";
import { CONTRAST_LABEL, STYLE_LABEL, withAppAssignment } from "../logic/themes.ts";

interface Pref {
  theme: string | null;
  locked: boolean;
}

interface Draft {
  primary: string;
  tag: string | null;
  schemeStyle: SchemeStyle;
  contrast: ContrastLevel;
  name: string;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function queryApp(): string | null {
  const v = new URLSearchParams(location.search).get("app");
  return v !== null && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? v : null;
}

const MODES_OPTS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

function TileButton(props: { t: Tile; on: boolean; onPick: () => void; onHover: () => void }) {
  const { t } = props;
  return (
    <button
      type="button"
      class="tile"
      aria-pressed={props.on}
      aria-label={`Preview ${t.name}${t.modes === "" ? "" : `, ${t.modes}`}`}
      style={{ "--sw-fill": t.fill, "--sw-band": t.band, "--sw-band-fg": t.bandFg }}
      onClick={props.onPick}
      onMouseEnter={props.onHover}
      onFocus={props.onHover}
    >
      <span class="tile-band">{t.name}</span>
    </button>
  );
}

export function Drawer() {
  const framed = window.parent !== window;
  const api = useMemo(() => new Api(), []);
  // Admin routes need two-factor; a one-factor session gets Authelia's
  // redirect there. That means "not an admin here", never a page reload.
  const adminApi = useMemo(() => new Api({ reload: () => {}, storage: () => undefined }), []);
  const origin = useRef<string | null>(null);
  const [hello, setHello] = useState<DrawerHello | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [pref, setPref] = useState<Pref | null>(null);
  const [admin, setAdmin] = useState(false);
  const [assignments, setAssignments] = useState<Assignments | null>(null);
  const [tab, setTab] = useState<"themes" | "edit">("themes");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<Mode | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("browser");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const bodies = useRef(new Map<string, WireTheme>());

  const post = (msg: FromDrawer) => {
    if (origin.current !== null) window.parent.postMessage(msg, origin.current);
  };

  // The protocol: listen, then say ready.
  useEffect(() => {
    if (!framed) return;
    const want = queryApp();
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const m = parseAppMessage(e.data);
      if (m === null) return;
      if (want !== null && m.app !== want) return;
      if (origin.current !== null && e.origin !== origin.current) return;
      origin.current = e.origin;
      setHello(m);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) post({ themarr: 1, type: "close" });
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKey);
    window.parent.postMessage({ themarr: 1, type: "ready" }, "*");
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const loadCatalog = async () => {
    try {
      setCatalog(await api.get<Catalog>("/v1/catalog"));
    } catch (e) {
      if (!(e instanceof Reloading)) setStatus({ ok: false, text: errorText(e) });
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  const app = hello?.app ?? null;

  const loadPref = async (id: string) => {
    try {
      setPref(await api.get<Pref>(`/v1/me/apps/${id}/preference`));
    } catch (e) {
      if (!(e instanceof Reloading)) setPref(null);
    }
  };

  const loadAdmin = async () => {
    try {
      setAssignments(await adminApi.get<Assignments>("/v1/assignments"));
      setAdmin(true);
    } catch {
      setAdmin(false);
    }
  };

  useEffect(() => {
    if (app === null) return;
    void loadPref(app);
    void loadAdmin();
  }, [app]);

  // A new hello follows every refresh the page asked for: any preview is gone.
  useEffect(() => {
    setPreviewId(null);
    setDraft(null);
  }, [hello]);

  const locked = hello?.current.locked === true || pref?.locked === true;
  const allowed = scopes({ locked, canSaveMe: pref !== null, admin, app: app ?? "this app" });
  const scopeNow = allowed.some((s) => s.id === scope) ? scope : (allowed[0]?.id ?? "browser");
  const t = catalog === null ? null : tiles(catalog);
  const nameOf = (id: string | null | undefined) => (id == null ? undefined : catalog?.themes.find((x) => x.id === id)?.name);
  const appThemeId = app === null || assignments === null ? undefined : (assignments.perApp[app] ?? "inherit") === "inherit" ? (assignments.global ?? undefined) : assignments.perApp[app];
  const now = hello === null ? null : seeNow(hello.current, { local: nameOf(hello.current.local), saved: nameOf(pref?.theme), app: nameOf(appThemeId) });

  const bodyOf = async (id: string): Promise<WireTheme> => {
    const cached = bodies.current.get(id);
    if (cached !== undefined) return cached;
    const b = await api.get<WireTheme>(`/v1/themes/${id}/tokens`);
    bodies.current.set(id, b);
    return b;
  };

  const sendPreview = (body: WireTheme, mode: Mode | null) => {
    post(mode === null ? { themarr: 1, type: "preview", body } : { themarr: 1, type: "preview", body, mode });
  };

  const preview = async (id: string) => {
    setStatus(null);
    setPreviewId(id);
    setDraft(null);
    try {
      sendPreview(await bodyOf(id), previewMode);
    } catch (e) {
      if (!(e instanceof Reloading)) setStatus({ ok: false, text: errorText(e) });
    }
  };

  const draftBody = (d: Draft): WireTheme => {
    const th = makeSeededTheme({ id: "draft", name: "Draft", seeds: { primary: d.primary, tag: d.tag ?? undefined }, schemeStyle: d.schemeStyle, contrast: d.contrast });
    return { version: 1, modes: th.modes, tokens: th.tokens };
  };

  const setMode = (m: Mode) => {
    setPreviewMode(m);
    if (draft !== null) sendPreview(draftBody(draft), m);
    else if (previewId !== null) {
      const b = bodies.current.get(previewId);
      if (b !== undefined) sendPreview(b, m);
    }
  };

  const reset = () => {
    setPreviewId(null);
    setDraft(null);
    setStatus(null);
    post({ themarr: 1, type: "clearPreview" });
  };

  const fail = (e: unknown) => {
    if (e instanceof Reloading) return;
    setStatus({ ok: false, text: e instanceof ApiError ? e.message : errorText(e) });
  };

  const apply = async () => {
    if (previewId === null || app === null || locked) return;
    const name = nameOf(previewId) ?? previewId;
    setBusy(true);
    try {
      if (scopeNow === "browser") {
        post({ themarr: 1, type: "keepLocal", themeId: previewId });
        setStatus({ ok: true, text: `Kept ${name} in this browser.` });
      } else if (scopeNow === "me") {
        if (api.tags.prefs === null) await loadPref(app);
        setPref(await api.put<Pref>(`/v1/me/apps/${app}/preference`, { theme: previewId }));
        post({ themarr: 1, type: "saved", scope: "me" });
        setStatus({ ok: true, text: `Saved ${name} for you on every device.` });
      } else if (assignments !== null) {
        setAssignments(await adminApi.put<Assignments>("/v1/assignments", withAppAssignment(assignments, app, previewId)));
        post({ themarr: 1, type: "saved", scope: "app" });
        setStatus({ ok: true, text: `${app} now boots with ${name}.` });
      }
    } catch (e) {
      fail(e);
      if (e instanceof ApiError && e.status === 412) {
        await loadPref(app);
        await loadAdmin();
      }
    } finally {
      setBusy(false);
    }
  };

  const clearMine = async () => {
    if (app === null) return;
    setBusy(true);
    try {
      setPref(await api.put<Pref>(`/v1/me/apps/${app}/preference`, { theme: null }));
      post({ themarr: 1, type: "saved", scope: "me" });
      setStatus({ ok: true, text: "Your saved choice is cleared." });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = async () => {
    setTab("edit");
    if (draft !== null) return;
    const base = previewId ?? catalog?.favourites[0] ?? catalog?.themes[0]?.id ?? null;
    let d: Draft = { primary: "#5146D9", tag: null, schemeStyle: "tonal", contrast: 0, name: "" };
    if (base !== null) {
      try {
        const full = await adminApi.get<Theme>(`/v1/themes/${base}`);
        if (full.source.kind === "seeded") {
          d = { primary: full.source.seeds.primary, tag: full.source.seeds.tag ?? null, schemeStyle: full.source.schemeStyle, contrast: full.source.contrast, name: `${full.name} copy` };
        } else {
          const c = catalog?.themes.find((x) => x.id === base)?.swatch;
          d = { ...d, primary: (c?.light ?? c?.dark)?.primary ?? d.primary, name: `${full.name} copy` };
        }
      } catch {
        // Start from the defaults.
      }
    }
    setDraft(d);
    sendPreview(draftBody(d), previewMode);
  };

  const changeDraft = (patch: Partial<Draft>) => {
    if (draft === null) return;
    const d = { ...draft, ...patch };
    setDraft(d);
    if (!("name" in patch)) sendPreview(draftBody(d), previewMode);
  };

  const saveNew = async () => {
    if (draft === null) return;
    const name = draft.name.trim();
    if (name === "") return setStatus({ ok: false, text: "Give the new theme a name." });
    const taken = new Set(catalog?.themes.map((x) => x.id) ?? []);
    const stem = slugify(name) || "theme";
    let id = stem;
    for (let i = 2; taken.has(id); i++) id = `${stem.slice(0, 60)}-${i}`;
    setBusy(true);
    try {
      if (adminApi.tags.store === null) await loadAdmin();
      const th = makeSeededTheme({ id, name, seeds: { primary: draft.primary, tag: draft.tag ?? undefined }, schemeStyle: draft.schemeStyle, contrast: draft.contrast });
      await adminApi.put<Theme>(`/v1/themes/${id}`, th);
      await loadCatalog();
      await loadAdmin();
      setStatus({ ok: true, text: `Saved ${name} in themarr. Find it under All themes.` });
      setTab("themes");
      setDraft(null);
      setPreviewId(null);
      post({ themarr: 1, type: "clearPreview" });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!framed) {
    return (
      <main class="drawer drawer-alone">
        <h1 class="drawer-h">Themarr drawer</h1>
        <p class="text">This page lives in an app's themarr drawer. Open an app and click its themarr button, or go to the themarr admin page.</p>
        <a class="btn" href="/">
          Open themarr
        </a>
      </main>
    );
  }

  const hovered = [...(t?.favourites ?? []), ...(t?.others ?? [])].find((x) => x.id === hover);
  const previewName = nameOf(previewId);
  const editing = admin && tab === "edit";

  return (
    <main class="drawer">
      <h1 class="sr-only">Themarr themes{app === null ? "" : ` for ${app}`}</h1>
      <p class="drawer-who xsmall muted">{admin ? "Signed in · admin" : "Signed in"}</p>

      {admin && (
        <div role="tablist" aria-label="Drawer" class="drawer-tabs">
          <button type="button" role="tab" aria-selected={tab === "themes"} onClick={() => setTab("themes")}>
            Themes
          </button>
          <button type="button" role="tab" aria-selected={tab === "edit"} onClick={() => void startEdit()}>
            Edit (admin)
          </button>
        </div>
      )}

      <div class="drawer-body">
        {hello === null && <p class="muted small">Waiting for the app…</p>}

        {locked && (
          <div class="drawer-lock" role="note">
            An admin set the theme for you on this app. You can preview other themes, but not keep them.
          </div>
        )}

        {now !== null && (
          <div class="drawer-now">
            <span class="xsmall muted">You see now</span>
            <span class="strong">
              {now.name} <span class="muted xsmall normal">· {now.from}</span>
            </span>
          </div>
        )}

        {(previewId !== null || draft !== null) && (
          <div class="drawer-previewing" role="status">
            <span class="grow">
              Previewing <strong>{draft !== null ? "your draft" : (previewName ?? previewId)}</strong> in this tab only.
            </span>
            <button type="button" class="btn btn-sm" onClick={reset}>
              Reset
            </button>
          </div>
        )}

        <Segmented label="Preview mode" options={MODES_OPTS} value={previewMode ?? hello?.mode ?? "light"} onChange={setMode} class="seg-fill" />

        {!editing && t !== null && (
          <div class="stack-sm" onMouseLeave={() => setHover(null)}>
            {t.favourites.length > 0 && (
              <section class="stack-xs" aria-label="Favourites">
                <span class="drawer-label">Favourites</span>
                <div class="tiles">
                  {t.favourites.map((x) => (
                    <TileButton key={x.id} t={x} on={x.id === previewId} onPick={() => void preview(x.id)} onHover={() => setHover(x.id)} />
                  ))}
                </div>
              </section>
            )}
            <section class="stack-xs" aria-label="All themes">
              <span class="drawer-label">All themes</span>
              {t.others.length === 0 && t.favourites.length === 0 ? (
                <span class="muted small">No themes yet.</span>
              ) : (
                <div class="tiles">
                  {t.others.map((x) => (
                    <TileButton key={x.id} t={x} on={x.id === previewId} onPick={() => void preview(x.id)} onHover={() => setHover(x.id)} />
                  ))}
                </div>
              )}
            </section>
            <span class="xsmall muted">
              {hovered === undefined ? "Click a theme to preview it on this app." : `${hovered.name}${hovered.modes === "" ? "" : ` · ${hovered.modes}`} · click to preview`}
            </span>
          </div>
        )}

        {editing && draft === null && <p class="muted small">Loading…</p>}
        {editing && draft !== null && (
          <div class="stack-sm">
            <span class="small">A seeded copy. The app behind shows every change; nothing is saved until you save it as a new theme.</span>
            <div class="row gap-10 wrap">
              <label class="row gap-8">
                <input type="color" class="color-input" value={draft.primary.toLowerCase()} onInput={(e) => changeDraft({ primary: (e.currentTarget as HTMLInputElement).value.toUpperCase() })} />
                <span class="col">
                  <span class="small strong">Accent</span>
                  <span class="xsmall mono muted">{draft.primary}</span>
                </span>
              </label>
              <label class="row gap-8">
                <input
                  type="color"
                  class="color-input"
                  value={(draft.tag ?? "#E0662F").toLowerCase()}
                  onInput={(e) => changeDraft({ tag: (e.currentTarget as HTMLInputElement).value.toUpperCase() })}
                />
                <span class="col">
                  <span class="small strong">Tags</span>
                  <span class="xsmall mono muted">{draft.tag ?? "auto"}</span>
                </span>
              </label>
              {draft.tag !== null && (
                <button type="button" class="btn btn-sm" onClick={() => changeDraft({ tag: null })}>
                  Auto tags
                </button>
              )}
            </div>
            <div class="field">
              <span class="field-label small">Scheme style</span>
              <div role="group" aria-label="Scheme style" class="choice-grid">
                {SCHEME_STYLES.map((s) => (
                  <button type="button" key={s} class="choice choice-sm" aria-pressed={draft.schemeStyle === s} onClick={() => changeDraft({ schemeStyle: s })}>
                    <span class="choice-label">{STYLE_LABEL[s]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div class="field">
              <span class="field-label small">Contrast</span>
              <Segmented
                label="Contrast"
                options={CONTRAST_LEVELS.map((c) => ({ id: String(c), label: CONTRAST_LABEL[c] }))}
                value={String(draft.contrast)}
                onChange={(v) => changeDraft({ contrast: Number(v) as ContrastLevel })}
                class="seg-fill seg-sm"
              />
            </div>
            <label class="field">
              <span class="field-label small">Name</span>
              <input type="text" class="input" maxLength={100} value={draft.name} onInput={(e) => changeDraft({ name: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <div class="row gap-8">
              <button type="button" class="btn btn-strong grow" disabled={busy} onClick={() => void saveNew()}>
                Save as new theme
              </button>
              <a class="btn" href="/editor/new" target="_blank" rel="noopener">
                Full editor
              </a>
            </div>
          </div>
        )}

        {status !== null && (
          <p class={`drawer-status small ${status.ok ? "is-ok" : "is-bad"}`} role={status.ok ? "status" : "alert"}>
            {status.text}
          </p>
        )}
      </div>

      {!editing && !locked && hello !== null && (
        <div class="drawer-keep">
          <span class="drawer-label">{previewId === null ? "Keep a theme for" : `Keep ${previewName ?? previewId} for`}</span>
          <Segmented label="Keep for" options={allowed} value={scopeNow} onChange={setScope} class="seg-fill seg-sm" />
          <span class="xsmall muted">{previewId === null ? "Click a theme first." : scopeHint(scopeNow)}</span>
          <button type="button" class="btn btn-strong" disabled={previewId === null || busy} onClick={() => void apply()}>
            {applyLabel(scopeNow, app ?? "this app")}
          </button>
          <div class="row gap-8 wrap">
            {hello.current.local !== undefined && (
              <button type="button" class="btn btn-sm btn-ghost" onClick={() => post({ themarr: 1, type: "clearLocal" })}>
                Forget this browser's choice
              </button>
            )}
            {pref?.theme != null && (
              <button type="button" class="btn btn-sm btn-ghost" disabled={busy} onClick={() => void clearMine()}>
                Clear my saved choice
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
