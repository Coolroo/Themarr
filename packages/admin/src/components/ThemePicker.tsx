// The swatch theme picker (the owner's decision: no dropdowns). The button
// shows the current choice; it opens a popover with Inherit and None (where
// allowed), the favourites, and every theme as a grid of swatches. Hovering
// or focusing a swatch grows it and opens a details card: both modes, the
// accent and style, the apps that use it, a favourite star, "Use this
// theme" and "See examples". Escape or a click outside closes it.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Theme } from "@themarr/tokens";
import { useData, useSnap } from "../data.tsx";
import { favouriteThemes, moveInGrid, sortedThemes, specialsFor, triggerFor, type Trigger } from "../logic/picker.ts";
import { examplesHref } from "../logic/routes.ts";
import { swatchOf, styleLabel, themeAccent, themeById, usedBy } from "../logic/themes.ts";
import { Link } from "../router.tsx";
import { Half, SwatchChip, swatchStyle } from "./common.tsx";
import { IconChevron, IconStar } from "./icons.tsx";

export interface PickerProps {
  /** A theme id, "inherit", "none", or null (none). */
  value: string | null;
  onPick: (value: string) => void;
  /** Says what the picker sets, such as "Theme for vibe-kanban". */
  label: string;
  allowInherit?: boolean;
  allowNone?: boolean;
  disabled?: boolean;
}

const COLUMNS = 6;

export function TriggerFace(props: { t: Trigger }) {
  const { t } = props;
  return (
    <>
      <SwatchChip swatch={t.swatch} kind={t.kind} class="chip-34" />
      <span class="picker-text">
        <span class="picker-title">{t.title}</span>
        <span class="picker-sub">{t.sub}</span>
      </span>
    </>
  );
}

function Details(props: { theme: Theme; onUse: () => void; onLeave: () => void }) {
  const { theme } = props;
  const data = useData();
  const snap = useSnap();
  const fav = snap.favourites.includes(theme.id);
  const used = usedBy(theme.id, snap.apps, snap.assignments);
  return (
    <div class="picker-details" role="group" aria-label={`${theme.name} details`}>
      <div class="picker-details-card">
      <div class="halves halves-sm">
        <Half tokens={theme.tokens.light} mode="light" />
        <Half tokens={theme.tokens.dark} mode="dark" />
      </div>
      <div class="picker-details-body">
        <div class="row-between">
          <span class="details-name">{theme.name}</span>
          <button
            type="button"
            class={`icon-btn star ${fav ? "is-on" : ""}`}
            aria-pressed={fav}
            aria-label={fav ? "Remove from favourites" : "Add to favourites"}
            onClick={() => void data.toggleFavourite(theme.id)}
          >
            <IconStar filled={fav} />
          </button>
        </div>
        <div class="meta">
          <span class="mono">{themeAccent(theme)}</span>
          <span>· {styleLabel(theme)}</span>
        </div>
        <div class="used">
          <span class="muted">Used by</span>
          {used.length === 0 ? <span class="muted">no app yet</span> : used.map((id) => <span key={id} class="tag-chip mono">{id}</span>)}
        </div>
        <div class="row gap-8">
          <button type="button" class="btn btn-strong grow" onClick={props.onUse}>
            Use this theme
          </button>
          <Link href={examplesHref(theme.id)} class="btn grow" onClick={props.onLeave}>
            See examples
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}

export function ThemePicker(props: PickerProps) {
  const snap = useSnap();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const themes = sortedThemes(snap.themes);
  const favs = favouriteThemes(snap.favourites, snap.themes);
  const t = triggerFor(props.value, snap.themes, snap.assignments.global);
  const specials = specialsFor(
    { allowInherit: props.allowInherit ?? false, allowNone: props.allowNone ?? false },
    props.value,
    snap.themes,
    snap.assignments.global,
  );

  const close = (focus: boolean) => {
    setOpen(false);
    setHover(null);
    if (focus) trigger.current?.focus();
  };
  const choose = (v: string) => {
    close(true);
    if (v !== props.value) props.onPick(v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current !== null && !root.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    const first = pop.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? pop.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onGridKey = (e: KeyboardEvent) => {
    const grid = e.currentTarget as HTMLElement;
    const buttons = [...grid.querySelectorAll<HTMLButtonElement>("button")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = moveInGrid(i, e.key, buttons.length, COLUMNS);
    if (j !== i) {
      e.preventDefault();
      buttons[j]?.focus();
    }
  };

  const swatchButton = (theme: Theme, big: boolean) => (
    <button
      type="button"
      key={theme.id}
      class={`sw ${big ? "sw-big" : ""}`}
      aria-label={theme.name}
      aria-pressed={theme.id === props.value}
      style={swatchStyle(swatchOf(theme))}
      onMouseEnter={() => setHover(theme.id)}
      onFocus={() => setHover(theme.id)}
      onClick={() => choose(theme.id)}
    >
      <span class="sw-band" />
    </button>
  );

  const hovered = themeById(snap.themes, hover);

  return (
    <div class={`picker ${open ? "is-open" : ""}`} ref={root} onMouseLeave={() => setHover(null)}>
      <button
        type="button"
        ref={trigger}
        class="picker-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${props.label}: ${t.title}. ${t.sub}`}
        disabled={props.disabled === true || (snap.themes.length === 0 && specials.length === 0)}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <TriggerFace t={t} />
        <IconChevron />
      </button>
      {open && (
        <div class="picker-pop" role="dialog" aria-label={`${props.label}: choose a theme`} ref={pop}>
          {specials.length > 0 && (
            <div class="picker-specials">
              {specials.map((s) => (
                <button type="button" key={s.value} class="special" aria-pressed={s.on} onClick={() => choose(s.value)} onMouseEnter={() => setHover(null)}>
                  <SwatchChip swatch={s.swatch} kind={s.value === "none" ? "none" : "inherit"} class="chip-22" />
                  <span class="special-text">
                    <span class="special-title">{s.title}</span>
                    <span class="special-sub">{s.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div class="picker-section">
            <span class="picker-label">
              <IconStar filled size={13} /> Favourites
            </span>
            <div class="picker-favs" onKeyDown={onGridKey}>
              {favs.length === 0 ? <span class="muted small">Star a theme to pin it here.</span> : favs.map((f) => swatchButton(f, true))}
            </div>
          </div>
          <div class="picker-section">
            <span class="picker-label">All themes</span>
            {themes.length === 0 ? (
              <span class="muted small">No themes yet.</span>
            ) : (
              <div class="picker-grid" onKeyDown={onGridKey}>
                {themes.map((th) => swatchButton(th, false))}
              </div>
            )}
          </div>
          <div class="picker-foot">
            <span class="muted">Hover a swatch for details</span>
            <Link href="/editor/new" onClick={() => close(false)}>
              New theme
            </Link>
          </div>
          {hovered !== undefined && <Details theme={hovered} onUse={() => choose(hovered.id)} onLeave={() => close(false)} />}
        </div>
      )}
    </div>
  );
}
