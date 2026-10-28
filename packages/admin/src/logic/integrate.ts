// "Add themarr to an app": the three steps, with a snippet and a token map
// per app. Known apps get the call the design worked out for them; any other
// app gets the plain one (no map: every token as --themarr-<token>).

export interface Guide {
  id: string;
  label: string;
  /** Where the SDK file goes in the app's repo. */
  vendor: string;
  /** Where the call goes. */
  where: string;
  snippet: string;
  mapNote: string;
  rows: readonly (readonly [token: string, target: string, format: string])[];
}

const PLAIN_ID = "plain";

function vibeKanban(url: string): Guide {
  return {
    id: "vibe-kanban",
    label: "vibe-kanban",
    vendor: "packages/local-web/vendor/themarr/themarr.js",
    where: "In packages/local-web/src/main.tsx, before the React root renders. A theme variant the user picked still wins.",
    snippet: [
      "import * as themarr from '../vendor/themarr/themarr.js';",
      "",
      "const theme = await themarr.boot({",
      "  app: 'vibe-kanban',",
      `  url: '${url}',`,
      "  timeoutMs: 1000,",
      "  selector: 'html:not([data-theme-variant])',",
      "  dark: { class: 'dark' },",
      "  map: VIBE_KANBAN_MAP,",
      "});",
      "",
      "createRoot(document.getElementById('root')!).render(<App />);",
    ].join("\n"),
    mapNote: "vibe-kanban keeps its colours as bare HSL numbers, so the SDK writes them in that format.",
    rows: [
      ["background", "--_background", "hsl-triple"],
      ["foreground", "--text-high", "hsl-triple"],
      ["muted-foreground", "--text-low", "hsl-triple"],
      ["card", "--_bg-secondary-default", "hsl-triple"],
      ["muted", "--_bg-panel-default", "hsl-triple"],
      ["primary", "--brand", "hsl-triple"],
      ["primary-foreground", "--text-on-brand", "hsl-triple"],
    ],
  };
}

function seerrGames(url: string): Guide {
  return {
    id: "seerr-games",
    label: "seerr-games",
    vendor: "src/vendor/themarr/themarr.js",
    where: "Server side, in src/pages/_document.tsx. The theme CSS is in the first HTML the browser gets.",
    snippet: [
      "import * as themarr from '../vendor/themarr/themarr.js';",
      "",
      "MyDocument.getInitialProps = async (ctx) => {",
      "  const initial = await Document.getInitialProps(ctx);",
      "  const theme = await themarr.boot({",
      "    app: 'seerr-games',",
      `    url: '${url}',`,
      "    timeoutMs: 1000,",
      "    mode: 'dark', // Seerr has no light mode",
      "    map: SEERR_MAP,",
      "  });",
      "  return { ...initial, themeCss: themarr.renderCss(theme) };",
      "};",
      "",
      "// in render(): put props.themeCss in a <style id=\"themarr\"> in <Head>",
    ].join("\n"),
    mapNote: "Seerr uses Tailwind colour classes; point its Tailwind colours at CSS variables first. The names below follow that change.",
    rows: [
      ["background", "--color-gray-900", "rgb-triplet"],
      ["card", "--color-gray-800", "rgb-triplet"],
      ["foreground", "--color-gray-100", "rgb-triplet"],
      ["primary", "--color-indigo-600", "rgb-triplet"],
      ["ring", "--color-indigo-500", "rgb-triplet"],
    ],
  };
}

function generic(id: string, label: string, url: string): Guide {
  return {
    id,
    label,
    vendor: "vendor/themarr/themarr.js",
    where: "In the app's entry, before it draws anything. With no map, the SDK sets --themarr-* variables: point the app's own variables at them, each with its old value as the fallback.",
    snippet: [
      "/* app.css */",
      ":root {",
      "  --brand: var(--themarr-primary, #E0662F);",
      "  --page-bg: var(--themarr-background, #FAFAF7);",
      "  --text: var(--themarr-foreground, #1A1A1A);",
      "}",
      "",
      "// app entry",
      "import * as themarr from './vendor/themarr/themarr.js';",
      "",
      `await themarr.boot({ app: '${id}', url: '${url}' });`,
    ].join("\n"),
    mapNote: "No map needed. Every token arrives as --themarr-<token>, light under :root and dark for prefers-color-scheme: dark.",
    rows: [
      ["background", "--themarr-background", "oklch"],
      ["foreground", "--themarr-foreground", "oklch"],
      ["primary", "--themarr-primary", "oklch"],
      ["tag (optional)", "--themarr-tag", "oklch"],
      ["success", "--themarr-success", "oklch"],
    ],
  };
}

/** One guide per registered app, then the plain one for any app. */
export function guides(apps: readonly { id: string; name: string }[], url: string): Guide[] {
  const out = apps.map((a) => {
    if (a.id === "vibe-kanban") return vibeKanban(url);
    if (a.id === "seerr-games") return seerrGames(url);
    return generic(a.id, a.name, url);
  });
  out.push({ ...generic("my-app", "Any app (plain CSS)", url), id: PLAIN_ID });
  return out;
}

/** The console line an app writes when themarr doesn't answer in time. */
export function warnLine(url: string, appId: string): string {
  return `[themarr] unreachable (${url}, ${appId === PLAIN_ID ? "my-app" : appId}): timeout after 1000 ms; using app defaults`;
}
