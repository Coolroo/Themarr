// Small shared pieces: segmented buttons, a theme's swatch, its light and
// dark preview halves, the page heading, and a modal dialog.
//
// Colours from data (a theme's tokens) go in through CSS custom properties
// set with CSSOM (Preact's style object calls style.setProperty), which the
// UI's CSP allows; the markup never carries a style attribute.

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Mode, ModeTokens } from "@themarr/tokens";
import { navigated } from "../router.tsx";
import { previewVars, type Swatch } from "../logic/themes.ts";

export interface Option<T extends string> {
  id: T;
  label: string;
}

/** A row of toggle buttons (one pressed). */
export function Segmented<T extends string>(props: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (v: T) => void;
  class?: string;
}) {
  return (
    <div role="group" aria-label={props.label} class={`seg ${props.class ?? ""}`}>
      {props.options.map((o) => (
        <button type="button" key={o.id} aria-pressed={o.id === props.value} onClick={() => props.onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The CSS variables of a swatch. */
export function swatchStyle(s: Swatch | null): Record<string, string> {
  return s === null ? {} : { "--sw-fill": s.fill, "--sw-band": s.band };
}

/** A swatch: the accent, with the dark background as a strip at the bottom. */
export function SwatchChip(props: { swatch: Swatch | null; kind?: "theme" | "inherit" | "none" | "missing"; class?: string }) {
  const kind = props.kind ?? "theme";
  return (
    <span class={`chip chip-${kind} ${props.class ?? ""}`} style={swatchStyle(props.swatch)} aria-hidden="true">
      <span class="chip-band" />
    </span>
  );
}

/** One mode of a theme as a tiny screen: text lines, a card, a button and two dots. */
export function Half(props: { tokens: ModeTokens | undefined; mode: Mode; colors?: Record<string, string> | null }) {
  const vars = props.colors !== undefined ? props.colors : previewVars(props.tokens);
  if (vars === null) {
    return (
      <div class="half half-none">
        <span>No {props.mode} palette</span>
      </div>
    );
  }
  return (
    <div class="half" style={vars}>
      <div class="half-l1" />
      <div class="half-l2" />
      <div class="half-card">
        <span class="half-btn" />
        <span class="half-dot half-tag" />
        <span class="half-dot half-warn" />
      </div>
    </div>
  );
}

/** A page's heading. After an in-page navigation it takes the focus, for screen readers. */
export function PageTitle(props: { children: ComponentChildren; title: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${props.title} · Themarr`;
    if (navigated) ref.current?.focus();
  }, [props.title]);
  return (
    <h1 ref={ref} tabIndex={-1} class="page-title">
      {props.children}
    </h1>
  );
}

/**
 * A modal dialog on the native <dialog> element: the browser traps the
 * focus, Escape closes it, and the focus returns to what opened it.
 */
export function Modal(props: { label: string; onClose: () => void; children: ComponentChildren; class?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose.current();
    };
    d.addEventListener("cancel", cancel);
    return () => {
      d.removeEventListener("cancel", cancel);
      if (d.open) d.close();
      opener?.focus();
    };
  }, []);
  const onClick = (e: MouseEvent) => {
    // A click on the backdrop (the dialog element itself, outside its box) closes it.
    if (e.target === ref.current) props.onClose();
  };
  return (
    <dialog ref={ref} aria-label={props.label} class={`modal ${props.class ?? ""}`} onClick={onClick}>
      {props.children}
    </dialog>
  );
}
