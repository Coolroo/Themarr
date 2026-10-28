// The admin UI's entry. Themarr themes its own UI: boot the SDK for the app
// id "themarr" before drawing (decision 0010), as any app does. The page's
// CSS reads the --themarr-* variables with its own defaults, so with no
// theme (or no answer within a second) it keeps its own look, and dark mode
// follows the system.

import { render } from "preact";
import { boot, type BootResult } from "@themarr/web";
import { App } from "./app.tsx";
import "./styles.css";

async function start(): Promise<void> {
  let theme: BootResult | undefined;
  try {
    theme = await boot({ app: "themarr", url: location.origin, dark: "media" });
  } catch {
    theme = undefined;
  }
  const root = document.getElementById("app");
  if (root === null) return;
  root.textContent = "";
  // After a save, ask again at once: the admin may have changed themarr's own theme.
  render(<App onChanged={() => void theme?.refresh()} />, root);
}

void start();
