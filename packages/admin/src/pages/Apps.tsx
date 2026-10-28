// Apps: the global default and each app's theme (its own, inherit or none),
// what it boots with, when it last asked, and a form to register an app.

import { useEffect, useState } from "preact/hooks";
import { PageTitle } from "../components/common.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import type { App, LastCheck } from "../api.ts";
import { useData, useSnap } from "../data.tsx";
import { addHref } from "../logic/routes.ts";
import { appHost, bootsWith } from "../logic/themes.ts";
import { Link } from "../router.tsx";

const APP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;

function checkLabel(c: LastCheck | null | undefined): { text: string; cls: string; when: string } {
  if (c === undefined) return { text: "…", cls: "", when: "" };
  if (c === null) return { text: "No request yet", cls: "", when: "" };
  const when = new Date(c.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return c.result === "applied" ? { text: "Applied", cls: "pill-ok", when } : { text: "Unset (204)", cls: "pill-warn", when };
}

/** Origins as typed: one per line or separated by spaces or commas. */
export function parseOrigins(text: string): { origins: string[]; bad: string[] } {
  const parts = text.split(/[\s,]+/).map((p) => p.trim().toLowerCase().replace(/\/+$/, "")).filter((p) => p !== "");
  const origins = [...new Set(parts.filter((p) => ORIGIN.test(p)))];
  return { origins, bad: parts.filter((p) => !ORIGIN.test(p)) };
}

function AppRow(props: { app: App; check: LastCheck | null | undefined }) {
  const data = useData();
  const snap = useSnap();
  const { app } = props;
  const value = snap.assignments.perApp[app.id] ?? "inherit";
  const [editing, setEditing] = useState(false);
  const [origins, setOrigins] = useState(app.origins.join("\n"));
  const check = checkLabel(props.check);
  const saveOrigins = async () => {
    const p = parseOrigins(origins);
    if (p.bad.length > 0) {
      window.alert(`Not an https origin: ${p.bad.join(", ")}`);
      return;
    }
    if (await data.putApp({ ...app, origins: p.origins })) setEditing(false);
  };
  const remove = async () => {
    if (window.confirm(`Remove ${app.name} (${app.id})? Its assignment goes too; the app then gets the global default.`)) await data.deleteApp(app.id);
  };
  return (
    <div class="app-row">
      <div class="app-id">
        <span class="app-name">{app.name}</span>
        <span class="mono small muted">
          {app.id} · {appHost(app)}
        </span>
      </div>
      <ThemePicker label={`Theme for ${app.name}`} value={value} allowInherit allowNone onPick={(v) => void data.setAppTheme(app.id, v)} />
      <div class="app-stat">
        <span class="muted xsmall">Boots with</span>
        <span class="strong-500">{bootsWith(app.id, snap.assignments, snap.themes)}</span>
      </div>
      <div class="app-stat">
        <span class="muted xsmall">Last check</span>
        <span class="row gap-8">
          <span class={`pill ${check.cls}`}>{check.text}</span>
          <span class="small muted">{check.when}</span>
        </span>
      </div>
      <div class="row gap-8 wrap app-actions">
        <Link href={addHref(app.id)} class="link-44">
          Set up
        </Link>
        <button type="button" class="btn btn-sm btn-ghost" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          Origins
        </button>
        <button type="button" class="btn btn-sm btn-ghost" onClick={() => void remove()}>
          Remove
        </button>
      </div>
      {editing && (
        <div class="app-origins">
          <label class="field">
            <span class="field-label">
              Origins <span class="muted normal">· the https addresses its pages run on, one per line; for people's own themes</span>
            </span>
            <textarea class="input textarea mono" rows={3} value={origins} onInput={(e) => setOrigins((e.currentTarget as HTMLTextAreaElement).value)} />
          </label>
          <div class="row gap-8">
            <button type="button" class="btn btn-sm btn-strong" onClick={() => void saveOrigins()}>
              Save origins
            </button>
            <button type="button" class="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppsPage() {
  const data = useData();
  const snap = useSnap();
  const [checks, setChecks] = useState<Record<string, LastCheck | null>>({});
  const [draftId, setDraftId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftOrigin, setDraftOrigin] = useState("");
  const [formError, setFormError] = useState("");
  const appIds = snap.apps.map((a) => a.id).join(",");

  useEffect(() => {
    let live = true;
    void Promise.all(snap.apps.map(async (a) => [a.id, await data.lastCheck(a.id)] as const)).then((pairs) => {
      if (live) setChecks(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [appIds]);

  const add = async (e: Event) => {
    e.preventDefault();
    const id = draftId.trim();
    if (!APP_ID.test(id) || id.length > 64) return setFormError("The app ID is lower-case letters, digits and single dashes.");
    if (snap.apps.some((a) => a.id === id)) return setFormError("An app with this ID is registered.");
    const p = parseOrigins(draftOrigin);
    if (p.bad.length > 0) return setFormError(`Not an https origin: ${p.bad.join(", ")}`);
    setFormError("");
    const name = draftName.trim() === "" ? id : draftName.trim().slice(0, 80);
    if (await data.putApp({ id, name, origins: p.origins })) {
      setDraftId("");
      setDraftName("");
      setDraftOrigin("");
    }
  };

  return (
    <>
      <header class="page-head">
        <PageTitle title="Apps">Apps</PageTitle>
        <p class="lead">
          Each app gets its own theme, the global default (inherit), or none. With none, the app boots on its own look. Click a swatch to choose; hover a
          theme for details.
        </p>
      </header>

      <section class="card bar layer-top" aria-label="Global default">
        <div class="bar-text grow">
          <span class="bar-title">Global default</span>
          <span class="small muted">Every app set to inherit gets this. Choose none to leave those apps on their defaults.</span>
        </div>
        <ThemePicker label="Global default" value={snap.assignments.global ?? "none"} allowNone onPick={(v) => void data.setGlobal(v === "none" ? null : v)} />
      </section>

      <section class="card list" aria-label="Apps">
        {snap.apps.length === 0 && <p class="muted pad">No apps yet. Register the first one below.</p>}
        {snap.apps.map((a) => (
          <AppRow key={a.id} app={a} check={checks[a.id]} />
        ))}
        <form class="add-form" onSubmit={(e) => void add(e)}>
          <label class="field">
            <span class="field-label small muted">App id</span>
            <input
              type="text"
              class="input mono input-200"
              placeholder="e.g. singarr"
              value={draftId}
              maxLength={64}
              spellcheck={false}
              onInput={(e) => setDraftId((e.currentTarget as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
          </label>
          <label class="field">
            <span class="field-label small muted">Name</span>
            <input type="text" class="input input-220" placeholder="Shown here only" value={draftName} maxLength={80} onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span class="field-label small muted">Origin (optional)</span>
            <input
              type="text"
              class="input mono input-260"
              placeholder="the https address of its pages"
              value={draftOrigin}
              spellcheck={false}
              onInput={(e) => setDraftOrigin((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button type="submit" class="btn">
            Add app
          </button>
          <span class="small muted grow">Lower case, digits and dashes. It goes in the app's SDK call and in the theme URL.</span>
          {formError !== "" && (
            <span class="form-error" role="alert">
              {formError}
            </span>
          )}
        </form>
      </section>

      <section class="chain" aria-label="How a theme is chosen">
        <span class="strong">How an app's theme is chosen:</span>
        <span class="chain-step">its own theme</span>
        <span aria-hidden="true">→</span>
        <span class="chain-step">global default</span>
        <span aria-hidden="true">→</span>
        <span class="chain-step">app's own defaults</span>
        <span class="small muted">
          People's own choices and admin policies come first: see <Link href="/people">People</Link>.
        </span>
      </section>
    </>
  );
}
