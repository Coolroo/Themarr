// People: the layer order, and the policies an admin sets for a user or a
// group: a default they may change, or an enforced theme they can't.

import { useState } from "preact/hooks";
import { PageTitle, Segmented } from "../components/common.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import type { PolicyKind } from "../api.ts";
import { useData, useSnap } from "../data.tsx";
import { KINDS, LAYERS, NAME_PATTERN, policyRows, type Scope } from "../logic/people.ts";
import { sortedThemes } from "../logic/picker.ts";

const SCOPES = [
  { id: "users", label: "User" },
  { id: "groups", label: "Group" },
] as const;

export function PeoplePage() {
  const data = useData();
  const snap = useSnap();
  const rows = policyRows(snap.policies, snap.themes);
  const [scope, setScope] = useState<Scope>("users");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const firstTheme = snap.assignments.global ?? sortedThemes(snap.themes)[0]?.id ?? null;

  const add = async (e: Event) => {
    e.preventDefault();
    const n = name.trim();
    if (!NAME_PATTERN.test(n)) return setFormError("A name is 1 to 128 of letters, digits, dot, underscore, @ and dash, as in Authelia.");
    if (snap.policies[scope][n] !== undefined) return setFormError(`${n} has a policy already.`);
    if (firstTheme === null) return setFormError("Make a theme first.");
    setFormError("");
    if (await data.putPolicy(scope, n, { theme: firstTheme, kind: "default" })) setName("");
  };

  return (
    <>
      <header class="page-head">
        <PageTitle title="People">People</PageTitle>
        <p class="lead">
          Give a person or a group a default theme they may change, or an enforced one they can't. People pick their own themes in each app's drawer.
        </p>
      </header>

      <section class="card pad stack-sm" aria-label="Which theme a person gets">
        <span class="strong">Which theme a person gets: the first one set, from left to right</span>
        <ol class="layers">
          {LAYERS.map((l, i) => (
            <li key={l.label}>
              <span class={`layer ${l.admin ? "is-admin" : ""}`}>
                <span class="layer-n mono">{i + 1}</span>
                {l.label}
              </span>
              {i < LAYERS.length - 1 && (
                <span class="muted" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section class="card list layer-top" aria-label="Policies">
        <div class="row-between list-head wrap gap-8">
          <h2 class="card-title">Policies</h2>
          <span class="small muted">Apply to every app. A person's own policy beats their group's; among groups, the name that sorts first wins.</span>
        </div>
        {rows.length === 0 && <p class="muted pad">No policies yet. People get each app's theme, or pick their own.</p>}
        {rows.map((r) => (
          <div class="policy-row" key={`${r.scope}/${r.name}`}>
            <div class="policy-who">
              <span class="badge" aria-hidden="true">
                {r.badge}
              </span>
              <div class="col">
                <span class="mono strong">{r.name}</span>
                <span class="xsmall muted">{r.kindLabel}</span>
              </div>
            </div>
            <ThemePicker label={`Theme for ${r.name}`} value={r.policy.theme} onPick={(v) => void data.putPolicy(r.scope, r.name, { ...r.policy, theme: v })} />
            <Segmented<PolicyKind>
              label={`Policy for ${r.name}`}
              options={KINDS}
              value={r.policy.kind}
              onChange={(kind) => void data.putPolicy(r.scope, r.name, { ...r.policy, kind })}
            />
            <span class="small muted policy-note">{r.note}</span>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              onClick={() => {
                if (window.confirm(`Remove the policy for ${r.name}?`)) void data.deletePolicy(r.scope, r.name);
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <form class="add-form" onSubmit={(e) => void add(e)}>
          <Segmented label="Kind" options={SCOPES} value={scope} onChange={setScope} />
          <label class="field">
            <span class="field-label small muted">Name in Authelia</span>
            <input
              type="text"
              class="input mono input-220"
              placeholder="user or group"
              value={name}
              maxLength={128}
              spellcheck={false}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button type="submit" class="btn">
            Add policy
          </button>
          <span class="small muted grow">It starts as a default with the global default theme; change both in its row.</span>
          {formError !== "" && (
            <span class="form-error" role="alert">
              {formError}
            </span>
          )}
        </form>
      </section>

      <section class="card bar" aria-label="Identity">
        <div class="bar-text grow">
          <span class="strong">Who people are</span>
          <span class="small muted">
            Themarr asks an identity module. It keeps the choices and policies itself; the module only says who someone is and which groups they are in.
          </span>
        </div>
        <span class="pill pill-ok">Authelia · in use</span>
        <span class="pill pill-dashed">More modules later</span>
      </section>
    </>
  );
}
