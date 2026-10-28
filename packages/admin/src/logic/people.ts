// The People page: the layer order (decision 0007) and the policy rows.

import type { Theme } from "@themarr/tokens";
import type { Policies, Policy, PolicyKind } from "../api.ts";
import { themeById } from "./themes.ts";

/** The layers, top down; the first one set wins. Highlighted: the two an admin sets here. */
export const LAYERS: readonly { label: string; admin: boolean }[] = [
  { label: "Enforced by an admin", admin: true },
  { label: "This browser", admin: false },
  { label: "Their own choice", admin: false },
  { label: "Admin default", admin: true },
  { label: "App theme", admin: false },
  { label: "Global default", admin: false },
  { label: "App’s own look", admin: false },
];

/** A user or group name themarr accepts (contract: 1-128 of A-Za-z0-9._@-). */
export const NAME_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;

export type Scope = "users" | "groups";

export interface PolicyRow {
  scope: Scope;
  name: string;
  policy: Policy;
  badge: "U" | "G";
  kindLabel: string;
  note: string;
}

export function policyNote(scope: Scope, name: string, policy: Policy, themes: readonly Theme[]): string {
  const theme = themeById(themes, policy.theme)?.name ?? `${policy.theme} (deleted)`;
  if (policy.kind === "enforced") {
    return scope === "groups"
      ? `Everyone in ${name} sees ${theme} in every app. Their drawer only previews.`
      : `${name} sees ${theme} in every app. Their drawer only previews.`;
  }
  return `Starts on ${theme}. They may pick their own.`;
}

/** Groups first, then users; each by name (byte order, as the resolver sorts). */
export function policyRows(p: Policies, themes: readonly Theme[]): PolicyRow[] {
  const rows: PolicyRow[] = [];
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  for (const scope of ["groups", "users"] as const) {
    for (const name of Object.keys(p[scope]).sort(byName)) {
      const policy = p[scope][name];
      if (policy === undefined) continue;
      rows.push({
        scope,
        name,
        policy,
        badge: scope === "groups" ? "G" : "U",
        kindLabel: scope === "groups" ? "Group in Authelia" : "User in Authelia",
        note: policyNote(scope, name, policy, themes),
      });
    }
  }
  return rows;
}

export function policyPath(scope: Scope, name: string): string {
  return `/v1/policies/${scope}/${encodeURIComponent(name)}`;
}

export const KINDS: readonly { id: PolicyKind; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "enforced", label: "Enforced" },
];
