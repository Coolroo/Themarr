// Themes: every theme as a card (its light and dark halves, accent, style,
// the apps that boot with it). Clicking a card's preview opens its examples
// in a pop-up: a tab per example, Light, Dark or side by side, a link to the
// Examples page, Edit, and Make global default.

import { useState } from "preact/hooks";
import { EXAMPLES } from "@themarr/examples";
import type { Mode, Theme } from "@themarr/tokens";
import { Half, Modal, PageTitle, Segmented, SwatchChip } from "../components/common.tsx";
import { ExampleFrame } from "../components/ExampleFrame.tsx";
import { IconClose, IconExamples, IconPlus } from "../components/icons.tsx";
import { useData, useSnap } from "../data.tsx";
import { editorHref, examplesHref } from "../logic/routes.ts";
import { sortedThemes } from "../logic/picker.ts";
import { swatchOf, themeById, themeSub, usedBy } from "../logic/themes.ts";
import { Link } from "../router.tsx";

type View = Mode | "both";

const VIEWS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "both", label: "Side by side" },
] as const;

function ExamplesDialog(props: { theme: Theme; onClose: () => void }) {
  const { theme } = props;
  const data = useData();
  const snap = useSnap();
  const [exampleId, setExampleId] = useState(EXAMPLES[0]?.id ?? "");
  const [view, setView] = useState<View>(theme.modes.includes("light") ? "light" : "dark");
  const example = EXAMPLES.find((e) => e.id === exampleId) ?? EXAMPLES[0];
  const isDefault = snap.assignments.global === theme.id;
  const modes: Mode[] = view === "both" ? ["light", "dark"] : [view];
  const deepLink = examplesHref(theme.id, example?.id);
  return (
    <Modal label={`${theme.name} examples`} onClose={props.onClose} class="modal-wide">
      <div class="modal-body">
        <div class="modal-head">
          <SwatchChip swatch={swatchOf(theme)} class="chip-32" />
          <div class="modal-title">
            <span class="modal-name">{theme.name}</span>
            <span class="muted small">{themeSub(theme)}</span>
          </div>
          <Segmented label="Show" options={VIEWS} value={view} onChange={setView} class="seg-sm" />
          <button type="button" class="icon-btn" aria-label="Close" onClick={props.onClose}>
            <IconClose />
          </button>
        </div>
        <Segmented
          label="Example"
          options={EXAMPLES.map((e) => ({ id: e.id, label: e.name }))}
          value={example?.id ?? ""}
          onChange={setExampleId}
          class="tabs"
        />
        <div class={`frames ${view === "both" ? "frames-2" : ""}`}>
          {example === undefined ? (
            <p class="muted">No examples yet.</p>
          ) : (
            modes.map((m) => (
              <ExampleFrame
                key={`${example.id}-${m}`}
                example={example}
                theme={theme}
                mode={m}
                scale="fit"
                label={`${example.name}, ${theme.name}, ${m}`}
                caption={m === "light" ? "Light" : "Dark"}
              />
            ))
          )}
        </div>
        <div class="modal-foot">
          <Link href={deepLink} class="btn">
            Open on the Examples page →
          </Link>
          <span class="mono muted small deep-link">{deepLink}</span>
          <span class="grow" />
          <Link href={editorHref(theme.id)} class="btn">
            Edit theme
          </Link>
          {!isDefault && (
            <button type="button" class="btn btn-strong" onClick={() => void data.setGlobal(theme.id)}>
              Make global default
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ThemeCard(props: { theme: Theme; onOpen: () => void }) {
  const { theme } = props;
  const data = useData();
  const snap = useSnap();
  const used = usedBy(theme.id, snap.apps, snap.assignments);
  const isDefault = snap.assignments.global === theme.id;
  return (
    <article class="card theme-card">
      <button type="button" class="halves halves-lg" aria-label={`Show examples for ${theme.name}`} onClick={props.onOpen}>
        <Half tokens={theme.tokens.light} mode="light" />
        <Half tokens={theme.tokens.dark} mode="dark" />
        <span class="halves-badge">
          <IconExamples /> Examples
        </span>
      </button>
      <div class="theme-card-body">
        <div class="row-between">
          <h2 class="theme-card-name">{theme.name}</h2>
          {isDefault && <span class="pill pill-accent">Global default</span>}
        </div>
        <div class="meta">
          <SwatchChip swatch={swatchOf(theme)} class="chip-14" />
          <span>{themeSub(theme)}</span>
        </div>
        <div class="used">
          {used.length === 0 ? <span class="muted">Not assigned to any app</span> : used.map((id) => <span key={id} class="tag-chip mono">{id}</span>)}
        </div>
        <div class="row gap-8 wrap">
          <Link href={editorHref(theme.id)} class="btn btn-sm">
            Edit
          </Link>
          {!isDefault && (
            <button type="button" class="btn btn-sm btn-ghost" onClick={() => void data.setGlobal(theme.id)}>
              Make global default
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function ThemesPage() {
  const snap = useSnap();
  const [openId, setOpenId] = useState<string | null>(null);
  const global = themeById(snap.themes, snap.assignments.global);
  const open = themeById(snap.themes, openId);
  return (
    <>
      <header class="page-head page-head-row">
        <div class="page-intro">
          <PageTitle title="Themes">Themes</PageTitle>
          <p class="lead">Click a theme to see it on real app screens. Apps with nothing assigned keep their own look.</p>
        </div>
        <Link href={editorHref(null)} class="btn btn-primary">
          <IconPlus /> New theme
        </Link>
      </header>

      <section class="card bar" aria-label="Global default">
        <SwatchChip swatch={global === undefined ? null : swatchOf(global)} kind={global === undefined ? "none" : "theme"} class="chip-36" />
        <div class="bar-text">
          <span class="muted small">Global default</span>
          <span class="bar-title">{global?.name ?? "None: apps that inherit keep their own look"}</span>
        </div>
        <span class="small">Apps set to inherit get this theme.</span>
        <Link href="/apps">Change assignments</Link>
      </section>

      {snap.themes.length === 0 ? (
        <section class="card empty">
          <h2>No themes yet</h2>
          <p class="muted">Make the first one from a single accent colour.</p>
          <Link href={editorHref(null)} class="btn btn-primary">
            <IconPlus /> New theme
          </Link>
        </section>
      ) : (
        <section class="theme-grid" aria-label="All themes">
          {sortedThemes(snap.themes).map((t) => (
            <ThemeCard key={t.id} theme={t} onOpen={() => setOpenId(t.id)} />
          ))}
        </section>
      )}

      {open !== undefined && <ExamplesDialog theme={open} onClose={() => setOpenId(null)} />}
    </>
  );
}
