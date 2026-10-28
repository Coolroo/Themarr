// The theme editor. Two sources: "From colours" (an accent, an optional
// second accent, a scheme style and a contrast level; Material makes the
// rest, and any token can be overridden) and "Hand-made" (every colour set
// by hand, with the modes the theme has). Contrast checks and a live light
// and dark preview follow every change; Save sends the finished tokens.

import { useEffect, useMemo, useState } from "preact/hooks";
import { EXAMPLES } from "@themarr/examples";
import { CONTRAST_LEVELS, MODES, SCHEME_STYLES, type ContrastLevel, type Mode, type Theme } from "@themarr/tokens";
import { DEFAULT_RADIUS, toModeTokens, type ColorTokenName } from "@themarr/palette";
import type { WireTheme } from "@themarr/web";
import { PageTitle, Segmented } from "../components/common.tsx";
import { ExampleFrame } from "../components/ExampleFrame.tsx";
import { useData, useSnap } from "../data.tsx";
import { contrastRows, contrastSummary } from "../logic/contrast.ts";
import {
  buildTheme,
  draftColors,
  editorFromTheme,
  newEditorState,
  overrideCountText,
  parseRadius,
  PRESETS,
  sameState,
  slugify,
  tokenGroups,
  withSource,
  type EditorState,
} from "../logic/editor.ts";
import { examplesHref } from "../logic/routes.ts";
import { CONTRAST_LABEL, previewVarsFromColors, STYLE_HINT, STYLE_LABEL, themeById } from "../logic/themes.ts";
import { Link, navigate, setLeaveGuard } from "../router.tsx";

const SOURCES = [
  { id: "seeded", label: "From colours", hint: "Pick an accent; themarr builds the rest" },
  { id: "handmade", label: "Hand-made", hint: "Set every colour yourself" },
] as const;

function lower(hex: string | undefined | null): string {
  return (hex ?? "#000000").toLowerCase();
}

function inputValue(e: Event): string {
  return (e.currentTarget as HTMLInputElement).value;
}

/** One mode of the draft as a small app screen. */
function PreviewPane(props: { mode: Mode; colors: Partial<Record<string, string>> | undefined; radius: string; handmade: boolean }) {
  const label = props.mode === "light" ? "Light" : "Dark";
  const vars = previewVarsFromColors(props.colors);
  if (vars === null) {
    return (
      <div class={`pv pv-missing pv-${props.mode}`}>
        <span class="pv-missing-title">No {props.mode} palette</span>
        <span class="muted small">
          In {props.mode} mode, apps keep their own look.{props.handmade ? " Tick the mode to add one." : ""}
        </span>
      </div>
    );
  }
  vars["--t-radius"] = props.radius;
  return (
    <div class={`pv pv-${props.mode}`} style={vars} role="img" aria-label={`${label} preview`}>
      <div class="pv-bar">
        <span class="pv-mode">{label}</span>
        <span class="pv-dots">
          <i />
          <i />
        </span>
      </div>
      <div class="pv-body">
        <div class="pv-tabs">
          <span class="pv-tab is-on">Library</span>
          <span class="pv-tab">Queue</span>
          <span class="pv-tab">Settings</span>
        </div>
        <div class="pv-card">
          <div class="pv-title">Card title</div>
          <div class="pv-muted">Muted body text sits here, at the size most apps use for descriptions.</div>
          <div class="pv-input">Focused input</div>
          <div class="pv-buttons">
            <span class="pv-btn pv-primary">Primary</span>
            <span class="pv-btn pv-secondary">Secondary</span>
            <span class="pv-btn pv-outline">Outline</span>
            <span class="pv-btn pv-destructive">Delete</span>
          </div>
        </div>
        <div class="pv-pop">
          <span class="pv-pop-title">Pop-up</span>
          <span class="pv-accent">Accent</span>
        </div>
        <div class="pv-people">
          <span class="pv-small">People and tags</span>
          <span class="pv-avatar">AB</span>
          <span class="pv-tagchip">#family</span>
          <span class="pv-tagline">shared</span>
        </div>
        <div class="pv-status">
          <span class="pv-success">Downloaded</span>
          <span class="pv-warning">Missing</span>
          <span class="pv-info">Queued</span>
        </div>
        <div class="pv-chart">
          <span class="c1" />
          <span class="c2" />
          <span class="c3" />
          <span class="c4" />
          <span class="c5" />
        </div>
      </div>
    </div>
  );
}

function ColorField(props: { id: string; label: string; hint?: string; value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <div class="color-field">
      <input type="color" class="color-input" aria-labelledby={props.id} value={lower(props.value)} onInput={(e) => props.onChange(inputValue(e).toUpperCase())} />
      <input
        type="text"
        class="hex-input mono"
        aria-label={`${props.label}, hex`}
        value={text}
        maxLength={7}
        spellcheck={false}
        onInput={(e) => {
          const v = inputValue(e);
          setText(v);
          if (/^#[0-9a-fA-F]{6}$/.test(v.trim())) props.onChange(v.trim().toUpperCase());
        }}
      />
    </div>
  );
}

function EditorForm(props: { initial: EditorState }) {
  const data = useData();
  const snap = useSnap();
  const [base, setBase] = useState(props.initial);
  const [s, setS] = useState(props.initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [phoneMode, setPhoneMode] = useState<Mode>("light");
  const [exampleId, setExampleId] = useState(EXAMPLES[0]?.id ?? "");
  const dirty = !sameState(s, base);

  const set = (patch: Partial<EditorState>) => {
    setSaved(false);
    setS((cur) => ({ ...cur, ...patch }));
  };

  useEffect(() => {
    if (!dirty) {
      setLeaveGuard(null);
      return;
    }
    setLeaveGuard(() => window.confirm("Leave without saving? Your changes to this theme are lost."));
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", unload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty]);

  const colors = useMemo(() => draftColors(s), [s]);
  const rows = useMemo(() => contrastRows(colors), [colors]);
  const summary = contrastSummary(rows);
  const groups = useMemo(() => tokenGroups(s), [s]);
  const radius = parseRadius(s.radius) ?? DEFAULT_RADIUS;
  const radiusCss = `${radius.$value.value}${radius.$value.unit}`;
  const draft = useMemo<WireTheme>(() => {
    const modes = MODES.filter((m) => colors[m] !== undefined);
    const tokens: WireTheme["tokens"] = {};
    for (const m of modes) tokens[m] = toModeTokens(colors[m] ?? {}, radius);
    return { version: 1, modes, tokens };
  }, [colors, radiusCss]);
  const example = EXAMPLES.find((e) => e.id === exampleId) ?? EXAMPLES[0];
  const seeded = s.source === "seeded";
  const existingIds = snap.themes.map((t) => t.id);

  const save = async () => {
    const built = buildTheme(s, existingIds);
    setProblems(built.problems);
    if (built.theme === null) return;
    setSaving(true);
    const stored = await data.saveTheme(built.theme);
    setSaving(false);
    if (stored === null) return;
    const next = editorFromTheme(stored);
    setBase(next);
    setS(next);
    setSaved(true);
    if (props.initial.isNew) {
      setLeaveGuard(null);
      navigate(`/editor/${stored.id}`, { replace: true });
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the theme "${base.name}"? Apps that use it go back to their next choice.`)) return;
    if (await data.deleteTheme(base.id)) {
      setLeaveGuard(null);
      navigate("/themes");
    }
  };

  const setName = (name: string) => set(s.isNew && !s.idTouched ? { name, id: slugify(name) } : { name });

  const statusText = saved ? "Saved. Apps pick it up on their next load." : dirty ? "Unsaved changes" : "No changes";
  const autoTag = colors.light?.tag ?? colors.dark?.tag ?? "#000000";

  return (
    <>
      <header class="page-head page-head-row editor-head">
        <div class="page-intro">
          <Link href="/themes" class="back-link">
            ← Themes
          </Link>
          <PageTitle title={s.isNew ? "New theme" : base.name}>{s.name.trim() === "" ? "New theme" : s.name}</PageTitle>
        </div>
        <div class="row gap-12 wrap">
          <span class={`status ${saved ? "is-ok" : dirty ? "is-dirty" : ""}`} role="status">
            {statusText}
          </span>
          <button type="button" class="btn" disabled={!dirty || saving} onClick={() => setS(base)}>
            Discard
          </button>
          <button type="button" class="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save theme"}
          </button>
        </div>
      </header>

      {problems.length > 0 && (
        <div class="notice notice-error" role="alert">
          <strong>The theme can't be saved yet:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div class="editor">
        <section class="editor-controls" aria-label="Controls">
          <div class="card pad stack">
            <label class="field">
              <span class="field-label">Theme name</span>
              <input type="text" class="input" value={s.name} maxLength={100} onInput={(e) => setName(inputValue(e))} />
            </label>
            {s.isNew ? (
              <label class="field">
                <span class="field-label">
                  ID <span class="muted normal">· in URLs and app settings; it can't change later</span>
                </span>
                <input
                  type="text"
                  class="input mono"
                  value={s.id}
                  maxLength={64}
                  spellcheck={false}
                  onInput={(e) => set({ id: inputValue(e).toLowerCase().replace(/[^a-z0-9-]/g, ""), idTouched: true })}
                />
              </label>
            ) : (
              <div class="field">
                <span class="field-label">ID</span>
                <span class="mono">{s.id}</span>
              </div>
            )}

            <div class="field">
              <span class="field-label">Source</span>
              <div role="group" aria-label="Source" class="choice-grid">
                {SOURCES.map((o) => (
                  <button type="button" key={o.id} class="choice" aria-pressed={s.source === o.id} onClick={() => setS((cur) => withSource(cur, o.id))}>
                    <span class="choice-label">{o.label}</span>
                    <span class="choice-hint">{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {seeded ? (
              <>
                <div class="field">
                  <span class="field-label" id="accent-label">
                    Accent colour <span class="muted normal">· buttons, links, anything you can press</span>
                  </span>
                  <div class="row gap-12 wrap">
                    <ColorField id="accent-label" label="Accent colour" value={s.primary} onChange={(primary) => set({ primary })} />
                    <div class="row gap-6 wrap">
                      {PRESETS.map((hex) => (
                        <button
                          type="button"
                          key={hex}
                          class="preset"
                          aria-label={`Use ${hex}`}
                          aria-pressed={hex === s.primary}
                          style={{ "--sw-fill": hex }}
                          onClick={() => set({ primary: hex })}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div class="field">
                  <span class="field-label" id="tag-label">
                    Second accent <span class="muted normal">· people and tags (optional)</span>
                  </span>
                  <div class="row gap-12 wrap">
                    <ColorField id="tag-label" label="Second accent" value={s.tag ?? autoTag} onChange={(tag) => set({ tag })} />
                    <span class={`pill ${s.tag === null ? "" : "pill-accent"}`}>{s.tag === null ? "Auto" : "Your colour"}</span>
                    {s.tag !== null && (
                      <button type="button" class="btn btn-sm" onClick={() => set({ tag: null })}>
                        Back to auto
                      </button>
                    )}
                  </div>
                  <span class="hint">Auto picks a hue that sits well beside the accent. Set it to choose your own second hue.</span>
                </div>

                <div class="field">
                  <span class="field-label">Scheme style</span>
                  <div role="group" aria-label="Scheme style" class="choice-grid">
                    {SCHEME_STYLES.map((id) => (
                      <button type="button" key={id} class="choice" aria-pressed={s.schemeStyle === id} onClick={() => set({ schemeStyle: id })}>
                        <span class="choice-label">{STYLE_LABEL[id]}</span>
                        <span class="choice-hint">{STYLE_HINT[id]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div class="field">
                  <span class="field-label">Contrast</span>
                  <Segmented
                    label="Contrast"
                    options={CONTRAST_LEVELS.map((c) => ({ id: String(c), label: CONTRAST_LABEL[c] }))}
                    value={String(s.contrast)}
                    onChange={(v) => set({ contrast: Number(v) as ContrastLevel })}
                    class="seg-fill"
                  />
                </div>
              </>
            ) : (
              <>
                <p class="text">You set every colour yourself; no generator runs. Use this for themes built from several unrelated hues.</p>
                <div class="field">
                  <span class="field-label">Modes this theme has</span>
                  <div class="row gap-10 wrap">
                    {MODES.map((m) => (
                      <label key={m} class="check">
                        <input
                          type="checkbox"
                          checked={s.handModes[m]}
                          onChange={(e) => {
                            const on = (e.currentTarget as HTMLInputElement).checked;
                            const next = { ...s.handModes, [m]: on };
                            if (!next.light && !next.dark) {
                              (e.currentTarget as HTMLInputElement).checked = true;
                              return;
                            }
                            set({ handModes: next });
                          }}
                        />
                        {m === "light" ? "Light" : "Dark"}
                      </label>
                    ))}
                  </div>
                  <span class="hint">An app in a mode this theme lacks keeps its own look in that mode.</span>
                </div>
                <label class="check">
                  <input type="checkbox" checked={s.handTag} onChange={(e) => set({ handTag: (e.currentTarget as HTMLInputElement).checked })} />
                  Second accent for people and tags
                </label>
              </>
            )}

            <label class="field">
              <span class="field-label">
                Corner radius <span class="muted normal">· such as 0.5rem or 10px</span>
              </span>
              <input
                type="text"
                class="input mono input-short"
                value={s.radius}
                aria-invalid={parseRadius(s.radius) === null}
                onInput={(e) => set({ radius: inputValue(e) })}
              />
            </label>
          </div>

          <div class="card pad stack-sm">
            <h2 class="card-title">Contrast checks</h2>
            <div class={`banner ${summary.failing === 0 ? "banner-ok" : "banner-bad"}`}>{summary.text}</div>
            <table class="checks">
              <thead>
                <tr>
                  <th scope="col">Pair</th>
                  <th scope="col">Light</th>
                  <th scope="col">Dark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.foreground}>
                    <th scope="row">{r.label}</th>
                    {[r.light, r.dark].map((v, i) => (
                      <td key={i} class={`mono ${v === null ? "muted" : v.ok ? "ok" : "bad"}`}>
                        {v === null ? "none" : v.text}
                        {v !== null && !v.ok && <span class="sr-only"> (below 4.5:1)</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="hint">Text needs 4.5:1. Red ratios fall short; themarr still saves them.</p>
          </div>

          <div class="card pad-x tokens">
            <div class="row-between tokens-head">
              <h2 class="card-title">Tokens</h2>
              <span class="muted small">{overrideCountText(s)}</span>
            </div>
            {seeded && <p class="hint">An override is one colour for both modes, or two (light, then dark). Write auto for a mode to keep its generated colour.</p>}
            {groups.map((g, gi) => (
              <details key={g.group} open={gi < 3} class="token-group">
                <summary>{g.label}</summary>
                <div class="token-rows">
                  {g.rows.map((r) => {
                    const leftOut = !seeded && (r.name === "tag" || r.name === "tag-foreground") && !s.handTag;
                    return (
                      <div key={r.name} class={`token-row ${seeded ? "" : "token-row-hand"}`}>
                        <span class="tok-sw tok-light" style={r.light === null ? {} : { "--sw-fill": r.light }} title={`light ${r.light ?? "none"}`} />
                        <span class="tok-sw tok-dark" style={r.dark === null ? {} : { "--sw-fill": r.dark }} title={`dark ${r.dark ?? "none"}`} />
                        <span class={`tok-name mono ${r.overridden ? "is-over" : ""}`}>{r.name}</span>
                        {seeded ? (
                          <input
                            type="text"
                            class="input input-sm mono"
                            aria-label={`Override ${r.name}`}
                            aria-invalid={r.invalid}
                            placeholder="auto"
                            spellcheck={false}
                            value={r.override}
                            onInput={(e) => set({ overrides: { ...s.overrides, [r.name]: inputValue(e) } })}
                          />
                        ) : leftOut ? (
                          <span class="muted small">Left out</span>
                        ) : (
                          <span class="hand-inputs">
                            {MODES.filter((m) => s.handModes[m]).map((m) => (
                              <input
                                key={m}
                                type="color"
                                class="color-input color-input-sm"
                                aria-label={`${r.name} (${m})`}
                                value={lower(s.hand[m][r.name as ColorTokenName])}
                                onInput={(e) =>
                                  set({ hand: { ...s.hand, [m]: { ...s.hand[m], [r.name]: inputValue(e).toUpperCase() } } })
                                }
                              />
                            ))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>

          {!s.isNew && (
            <div class="card pad row-between wrap gap-12">
              <span class="small muted">Deleting is refused while an app, the global default or a policy uses the theme.</span>
              <button type="button" class="btn btn-danger" onClick={() => void remove()}>
                Delete theme
              </button>
            </div>
          )}
        </section>

        <section class="editor-preview" aria-label="Live preview">
          <div class="row-between">
            <h2 class="card-title">Preview</h2>
            {!s.isNew && <Link href={examplesHref(s.id)}>Open in examples</Link>}
          </div>
          <Segmented
            label="Preview mode"
            options={[
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ]}
            value={phoneMode}
            onChange={setPhoneMode}
            class="seg-fill phone-only"
          />
          <div class={`preview-grid show-${phoneMode}`}>
            {MODES.map((m) => (
              <PreviewPane key={m} mode={m} colors={colors[m]} radius={radiusCss} handmade={!seeded} />
            ))}
          </div>
          <p class="hint">Apps get every palette the theme has. Each app decides light or dark with its own switch.</p>
          {example !== undefined && (
            <div class="stack-sm">
              <h2 class="card-title">On an example</h2>
              <Segmented
                label="Example"
                options={EXAMPLES.map((e) => ({ id: e.id, label: e.name }))}
                value={example.id}
                onChange={setExampleId}
                class="tabs"
              />
              <ExampleFrame
                example={example}
                theme={draft}
                mode={phoneMode === "dark" || !draft.modes.includes("light") ? "dark" : "light"}
                scale="fit"
                label={`${example.name} with this draft`}
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function EditorPage(props: { id: string | null }) {
  const snap = useSnap();
  const theme: Theme | undefined = props.id === null ? undefined : themeById(snap.themes, props.id);
  // Built once per theme: a later read of the data never replaces a draft.
  const initial = useMemo(() => (props.id === null ? newEditorState() : theme === undefined ? null : editorFromTheme(theme)), [props.id, theme === undefined]);
  if (initial === null) {
    return (
      <section class="card pad empty">
        <PageTitle title="Not found">No theme with this ID</PageTitle>
        <p class="muted">"{props.id}" doesn't exist. It may have been deleted.</p>
        <Link href="/themes" class="btn">
          Back to themes
        </Link>
      </section>
    );
  }
  return <EditorForm key={props.id ?? "new"} initial={initial} />;
}
