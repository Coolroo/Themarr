// Examples: real app screens with any theme. Light, dark, side by side, or
// every theme at once (click one to pick it). The last tab says how to add
// an example (packages/examples, decision 0008).

import { useEffect, useState } from "preact/hooks";
import { EXAMPLES } from "@themarr/examples";
import type { Mode } from "@themarr/tokens";
import { PageTitle, Segmented } from "../components/common.tsx";
import { ExampleFrame } from "../components/ExampleFrame.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { useSnap } from "../data.tsx";
import { sortedThemes } from "../logic/picker.ts";
import { examplesHref } from "../logic/routes.ts";
import { firstMode, swatchOf, themeById } from "../logic/themes.ts";
import { swatchStyle } from "../components/common.tsx";

type View = Mode | "both" | "all";

const VIEWS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "both", label: "Side by side" },
  { id: "all", label: "Every theme" },
] as const;

const ADD = "add";

const TREE = [
  "packages/examples/",
  ...EXAMPLES.map((e) => `  ${e.id}/`),
  "  <your-app-screen>/      ← add a folder, then rebuild themarr",
  "    example.json   id, name, sourceApp, description, modes, size",
  "    page.html      the copied screen: static markup, sample data",
  "    page.css       colours only from var(--themarr-*)",
  "",
  "// example.json",
  '{ "id": "gamarr-library", "name": "Gamarr: library",',
  '  "sourceApp": "gamarr", "description": "…",',
  '  "modes": ["dark", "light"], "size": { "width": 1100, "height": 700 } }',
].join("\n");

const RULES = [
  "Colours come only from var(--themarr-*). No hard-coded colours, so every theme shows truly. People and tags use tag, with accent as the fallback.",
  "Plain HTML and CSS with static sample data. No scripts, no links, no images, nothing from the network.",
  "One screen per folder. Lift more screens of the same app as more folders.",
  "npm run generate -w @themarr/examples checks the folder and adds it to the registry; the admin build runs it, so nothing else changes.",
];

export function ExamplesPage(props: { theme: string | null; example: string | null }) {
  const snap = useSnap();
  const themes = sortedThemes(snap.themes);
  const fallback = snap.assignments.global ?? themes[0]?.id ?? null;
  const [themeId, setThemeId] = useState<string | null>(themeById(snap.themes, props.theme)?.id ?? fallback);
  const [tab, setTab] = useState<string>(props.example !== null && EXAMPLES.some((e) => e.id === props.example) ? props.example : (EXAMPLES[0]?.id ?? ADD));
  const theme = themeById(snap.themes, themeId);
  const [view, setView] = useState<View>(theme === undefined ? "light" : firstMode(theme));

  // Keep the address in step, so a view can be shared (the pop-up's deep link).
  useEffect(() => {
    const href = examplesHref(themeId, tab === ADD ? null : tab);
    if (location.pathname + location.search !== href) history.replaceState(null, "", href);
  }, [themeId, tab]);

  const example = EXAMPLES.find((e) => e.id === tab);
  const tabs = [...EXAMPLES.map((e) => ({ id: e.id, label: e.name })), { id: ADD, label: "+ Add an example" }];

  return (
    <>
      <header class="page-head">
        <PageTitle title="Examples">Examples</PageTitle>
        <p class="lead">
          Real app screens, copied into themarr, that show any theme before you assign it. Each example is a module; add one whenever you lift an app's
          UI out to theme it.
        </p>
      </header>

      <div class="card bar layer-top">
        <div class="field">
          <span class="field-label small muted">Theme</span>
          <ThemePicker label="Theme to show" value={themeId} onPick={(v) => setThemeId(v)} disabled={themes.length === 0} />
        </div>
        <div class="field">
          <span class="field-label small muted">Show</span>
          <Segmented label="Show" options={VIEWS} value={view} onChange={setView} />
        </div>
      </div>

      <Segmented label="Example" options={tabs} value={tab} onChange={setTab} class="tabs" />

      {example !== undefined ? (
        themes.length === 0 ? (
          <p class="muted">No themes yet: make one to see it here.</p>
        ) : view === "all" ? (
          <section class="frames frames-all" aria-label="Every theme">
            {themes.map((t) => {
              const m = firstMode(t);
              return (
                <div key={t.id} class={`frame-pick ${t.id === themeId ? "is-on" : ""}`}>
                  <ExampleFrame example={example} theme={t} mode={m} scale={0.25} label={`${example.name}, ${t.name}`} caption={t.name} />
                  <span class="frame-swatch" style={swatchStyle(swatchOf(t))} aria-hidden="true" />
                  <button
                    type="button"
                    class="frame-pick-btn"
                    aria-pressed={t.id === themeId}
                    onClick={() => {
                      setThemeId(t.id);
                      setView(m);
                    }}
                  >
                    <span class="sr-only">Show {t.name}</span>
                  </button>
                </div>
              );
            })}
          </section>
        ) : (
          <section class={`frames ${view === "both" ? "frames-2" : ""}`} aria-label="Preview">
            {(view === "both" ? (["light", "dark"] as const) : [view]).map((m) => (
              <ExampleFrame
                key={`${example.id}-${m}`}
                example={example}
                theme={theme}
                mode={m}
                scale="fit"
                label={`${example.name}, ${theme?.name ?? "no theme"}, ${m}`}
                caption={`${theme?.name ?? "No theme"} · ${m}`}
              />
            ))}
          </section>
        )
      ) : (
        <section class="add-example" aria-label="Add an example">
          <div class="card pad stack-sm grow-2">
            <h2 class="card-title">Add an example</h2>
            <p class="text">
              An example is one folder. Copy the app's screen in as plain HTML and CSS with static sample data, swap every colour for a themarr variable,
              and rebuild. Themarr picks up every folder on its own.
            </p>
            <pre class="code">{TREE}</pre>
          </div>
          <div class="stack-sm grow-1">
            <h2 class="card-title">Rules for an example</h2>
            {RULES.map((r) => (
              <div class="card rule" key={r}>
                {r}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
