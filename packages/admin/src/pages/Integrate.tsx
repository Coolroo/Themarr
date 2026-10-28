// "Add themarr to an app": copy the SDK file in, call boot before the app
// draws, and map themarr's tokens to the app's own colours.

import { useState } from "preact/hooks";
import { VERSION } from "@themarr/web";
import { PageTitle, Segmented } from "../components/common.tsx";
import { IconDownload } from "../components/icons.tsx";
import { useSnap } from "../data.tsx";
import { guides, warnLine } from "../logic/integrate.ts";

export function IntegratePage(props: { app: string | null }) {
  const snap = useSnap();
  const url = location.origin;
  const all = guides(snap.apps, url);
  const [id, setId] = useState(all.some((g) => g.id === props.app) ? (props.app ?? "") : (all[0]?.id ?? "plain"));
  const [copied, setCopied] = useState(false);
  const g = all.find((x) => x.id === id) ?? all[all.length - 1];
  if (g === undefined) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(g.snippet);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <header class="page-head">
        <PageTitle title="Add to an app">Add themarr to an app</PageTitle>
        <p class="lead">The app asks themarr for its theme while it boots, before it draws anything. It waits at most one second, then starts on its own look.</p>
      </header>

      <Segmented
        label="App"
        options={all.map((x) => ({ id: x.id, label: x.label }))}
        value={g.id}
        onChange={(v) => {
          setId(v);
          setCopied(false);
        }}
        class="tabs"
      />

      <div class="integrate">
        <div class="stack grow-2">
          <section class="card pad stack-sm">
            <div class="step">
              <span class="step-n">1</span>
              <h2 class="card-title">Copy the SDK into the app</h2>
            </div>
            <p class="text">One file with no dependencies. It lives in the app's repo, so the app still boots when themarr is down.</p>
            <div class="row gap-12 wrap">
              <a href="/sdk/themarr.js" download="themarr.js" class="btn btn-primary">
                <IconDownload /> Download themarr.js {VERSION}
              </a>
              <a href="/sdk/themarr.d.ts" download="themarr.d.ts" class="btn">
                Types (.d.ts)
              </a>
              <span class="mono small">→ {g.vendor}</span>
            </div>
          </section>

          <section class="card pad stack-sm">
            <div class="row-between wrap gap-12">
              <div class="step">
                <span class="step-n">2</span>
                <h2 class="card-title">Call the boot hook</h2>
              </div>
              <button type="button" class="btn btn-sm" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p class="text">{g.where}</p>
            <pre class="code">{g.snippet}</pre>
          </section>

          <section class="card pad stack-sm">
            <div class="step">
              <span class="step-n">3</span>
              <h2 class="card-title">Map themarr's tokens to the app's colours</h2>
            </div>
            <p class="text">{g.mapNote}</p>
            <div class="table-scroll">
              <table class="map">
                <thead>
                  <tr>
                    <th scope="col">themarr token</th>
                    <th scope="col">App variable</th>
                    <th scope="col">Format</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(([token, target, format]) => (
                    <tr key={token}>
                      <td class="mono">{token}</td>
                      <td class="mono">{target}</td>
                      <td class="mono muted">{format}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside class="stack-sm grow-1" aria-label="What the app does">
          <h2 class="card-title">What happens at boot</h2>
          <div class="card pad-sm stack-xs">
            <span class="pill pill-ok self-start">applied</span>
            <span class="text">A theme is assigned. The app starts already in it.</span>
          </div>
          <div class="card pad-sm stack-xs">
            <span class="pill self-start">unset</span>
            <span class="text">Nothing is assigned. The app starts on its own defaults, with no warning.</span>
          </div>
          <div class="card pad-sm stack-xs">
            <span class="pill pill-warn self-start">unreachable</span>
            <span class="text">Themarr is down, slow or refused. After at most one second the app starts on its defaults and warns:</span>
            <code class="warn-line mono">{warnLine(url, g.id)}</code>
          </div>
          <p class="small muted">When the tab gets focus again, the app checks for changes and follows them.</p>
        </aside>
      </div>
    </>
  );
}
