// The drawer's own look, inside its shadow root: neutral (it never takes the
// app's theme), so it reads the same on every app and every theme.

export const DRAWER_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: auto;
  z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: #18191d;
  --line: #dcdbd3;
  --soft: #ecebe5;
  --muted: #5c5d64;
  --paper: #ffffff;
  --ink: #18191d;
  --wash: #f0f0ec;
}
@media (prefers-color-scheme: dark) {
  :host { color: #ececef; --line: #3a3b42; --soft: #2a2b31; --muted: #a4a5ad; --paper: #18191d; --ink: #ececef; --wash: #24252b; }
}
[hidden] { display: none !important; }
*, *::before, *::after { box-sizing: border-box; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, a:focus-visible, .panel:focus-visible { outline: 2px solid #5146d9; outline-offset: 2px; }
.logo { position: relative; display: inline-block; width: 28px; height: 28px; flex: 0 0 auto; }
.logo i { position: absolute; width: 14px; height: 14px; border-radius: 50%; }
.logo i:nth-child(1) { left: 3px; top: 4px; background: #5146d9; }
.logo i:nth-child(2) { left: 11px; top: 4px; background: #e0662f; opacity: 0.85; }
.logo i:nth-child(3) { left: 7px; top: 11px; background: #3f8f5a; opacity: 0.8; }
.launcher {
  position: fixed; bottom: 20px; width: 52px; height: 52px; padding: 0;
  border-radius: 26px; border: 1px solid var(--line); background: var(--paper);
  box-shadow: 0 6px 18px rgba(24, 25, 29, 0.22);
  display: flex; align-items: center; justify-content: center;
}
.tab {
  position: fixed; top: 50%; width: 14px; height: 64px; margin-top: -32px; padding: 0;
  border: 1px solid var(--line); background: var(--paper);
}
.right .launcher { right: 20px; }
.left .launcher { left: 20px; }
.right .tab { right: 0; border-right: 0; border-radius: 8px 0 0 8px; }
.left .tab { left: 0; border-left: 0; border-radius: 0 8px 8px 0; }
.panel {
  position: fixed; top: 0; bottom: 0; width: min(360px, 100vw);
  display: flex; flex-direction: column; background: var(--paper);
  box-shadow: -10px 0 28px rgba(24, 25, 29, 0.14);
}
.right .panel { right: 0; border-left: 1px solid var(--line); }
.left .panel { left: 0; border-right: 1px solid var(--line); }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; border-bottom: 1px solid var(--soft); }
.title { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hide { min-height: 40px; padding: 0 8px; border-radius: 8px; border: 0; background: transparent; font-size: 12px; }
.close { width: 40px; height: 40px; padding: 0; border-radius: 8px; border: 0; background: transparent; font-size: 20px; line-height: 1; }
.hide:hover, .close:hover { background: var(--wash); }
.body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.frame { flex: 1; width: 100%; height: 100%; border: 0; background: var(--paper); }
.fallback, .guest { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.note { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--wash); font-size: 13px; }
.now { font-size: 13px; color: var(--muted); }
.now b { color: var(--ink); }
.bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; background: #fff6e5; color: #6b3a00; font-size: 13px; }
.bar span { flex: 1; }
.bar button { min-height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid #e8c98f; background: #ffffff; color: #6b3a00; }
.label { font-size: 12px; font-weight: 600; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.tile {
  position: relative; width: 100%; height: 60px; padding: 0; overflow: hidden;
  border-radius: 10px; border: 2px solid transparent; background: var(--t-bg, #888888);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.tile:hover, .tile:focus-visible { transform: scale(1.06); box-shadow: 0 6px 14px rgba(24, 25, 29, 0.26); }
.tile[aria-pressed="true"] { border-color: var(--ink); }
.tile span {
  position: absolute; left: 0; right: 0; bottom: 0; height: 22px; padding: 0 7px;
  display: flex; align-items: center; background: var(--t-band, #18191d); color: var(--t-band-fg, #ffffff);
  font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.foot { padding: 10px 16px 14px; border-top: 1px solid var(--soft); display: flex; flex-direction: column; gap: 8px; }
.keep { min-height: 44px; border-radius: 10px; border: 0; background: var(--ink); color: var(--paper); font-weight: 600; }
.keep[disabled] { opacity: 0.45; cursor: default; }
.forget { min-height: 40px; border-radius: 10px; border: 1px solid var(--line); background: transparent; }
.status { min-height: 16px; font-size: 12px; color: var(--muted); }
.fallback a { color: inherit; font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .tile { transition: none; } .tile:hover, .tile:focus-visible { transform: none; } }
`;
