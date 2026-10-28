import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateTheme, type Theme } from "@themarr/tokens";
import type { App, Assignments } from "../src/api.ts";
import { contrastRows, contrastSummary } from "../src/logic/contrast.ts";
import { applyLabel, scopes, seeNow, tiles } from "../src/logic/drawer.ts";
import {
  buildTheme,
  draftColors,
  editorFromTheme,
  formatOverride,
  idProblem,
  newEditorState,
  overrideCountText,
  parseOverride,
  parseRadius,
  sameState,
  slugify,
  tokenGroups,
  withSource,
} from "../src/logic/editor.ts";
import { guides, warnLine } from "../src/logic/integrate.ts";
import { policyRows } from "../src/logic/people.ts";
import { favouriteThemes, moveInGrid, specialsFor, toggleFavourite, triggerFor } from "../src/logic/picker.ts";
import { editorHref, examplesHref, navOf, parseRoute } from "../src/logic/routes.ts";
import { bootsWith, previewVars, resolvedThemeId, styleLabel, swatchOf, themeSub, usedBy, withAppAssignment } from "../src/logic/themes.ts";

function fixture(name: string): Theme {
  return JSON.parse(readFileSync(new URL(`../../tokens/fixtures/valid/${name}.json`, import.meta.url), "utf8")) as Theme;
}

const indigo = fixture("seeded-indigo");
const coral = fixture("seeded-with-tag");
const synth = fixture("handmade-synth-dark");
const themes = [indigo, coral, synth];
const apps: App[] = [
  { id: "board", name: "Board", origins: ["https://board.example.org"] },
  { id: "games", name: "Games", origins: [] },
  { id: "plain", name: "Plain", origins: [] },
];
const assignments: Assignments = { global: "indigo", perApp: { games: "ocean-coral", plain: "none" } };

describe("resolution display", () => {
  it("follows inherit to the global default, and none to the app's own look", () => {
    assert.deepEqual(resolvedThemeId("board", assignments), { id: "indigo", inherited: true });
    assert.deepEqual(resolvedThemeId("games", assignments), { id: "ocean-coral", inherited: false });
    assert.deepEqual(resolvedThemeId("plain", assignments), { id: null, inherited: false });
    assert.equal(bootsWith("board", assignments, themes), "Indigo (inherited)");
    assert.equal(bootsWith("games", assignments, themes), "Ocean with coral tags");
    assert.equal(bootsWith("plain", assignments, themes), "App defaults");
    assert.equal(bootsWith("board", { global: null, perApp: {} }, themes), "App defaults");
  });

  it("lists the apps a theme reaches", () => {
    assert.deepEqual(usedBy("indigo", apps, assignments), ["board"]);
    assert.deepEqual(usedBy("synth-fixture", apps, assignments), []);
  });

  it("sets one app's assignment; inherit removes it", () => {
    assert.deepEqual(withAppAssignment(assignments, "board", "synth-fixture").perApp, { games: "ocean-coral", plain: "none", board: "synth-fixture" });
    assert.deepEqual(withAppAssignment(assignments, "games", "inherit").perApp, { plain: "none" });
    assert.equal(assignments.perApp["games"], "ocean-coral", "the input is not changed");
  });

  it("describes a theme", () => {
    assert.equal(themeSub(indigo), "#5146D9 · Tonal spot");
    assert.equal(styleLabel(synth), "Hand-made · dark only");
    assert.match(swatchOf(synth).fill, /^linear-gradient\(90deg, #4FE3D0 0 34%/);
    assert.equal(swatchOf(indigo).fill, "#5146D9");
    assert.equal(previewVars(synth.tokens.light), null);
    const v = previewVars(indigo.tokens.light);
    assert.equal(v?.["--t-background"], indigo.tokens.light?.background?.$value.hex);
    assert.equal(v?.["--t-radius"], "0.5rem");
  });
});

describe("contrast check rows", () => {
  it("has a row per pair, light and dark, and 'none' for a missing mode", () => {
    const rows = contrastRows(draftColors(editorFromTheme(synth)));
    assert.equal(rows.length, 12);
    const text = rows.find((r) => r.foreground === "foreground");
    assert.equal(text?.label, "Text on background");
    assert.equal(text?.light, null);
    assert.ok(text?.dark?.ok);
    assert.match(text?.dark?.text ?? "", /^\d+\.\d:1$/);
  });

  it("flags a pair below 4.5:1 and never rounds a failure up to a pass", () => {
    const rows = contrastRows({ light: { foreground: "#777777", background: "#FFFFFF" } });
    const r = rows.find((x) => x.foreground === "foreground")?.light;
    assert.equal(r?.ok, false);
    assert.equal(r?.text, "4.4:1");
    const sum = contrastSummary(rows);
    assert.equal(sum.failing, 1);
    assert.equal(sum.total, 1);
    assert.match(sum.text, /1 of 1 contrast check is below/);
  });
});

describe("picker state", () => {
  it("shows the choice on its button", () => {
    assert.equal(triggerFor("none", themes, "indigo").title, "None");
    assert.equal(triggerFor(null, themes, "indigo").kind, "none");
    assert.equal(triggerFor("inherit", themes, "indigo").sub, "Global default: Indigo");
    assert.equal(triggerFor("inherit", themes, null).sub, "Global default: none");
    assert.equal(triggerFor("ocean-coral", themes, null).title, "Ocean with coral tags");
    assert.equal(triggerFor("gone", themes, null).kind, "missing");
  });

  it("offers Inherit and None only where allowed", () => {
    assert.deepEqual(specialsFor({ allowInherit: true, allowNone: true }, "inherit", themes, "indigo").map((s) => [s.value, s.on]), [["inherit", true], ["none", false]]);
    assert.deepEqual(specialsFor({ allowInherit: false, allowNone: true }, null, themes, null).map((s) => [s.value, s.on]), [["none", true]]);
    assert.deepEqual(specialsFor({ allowInherit: false, allowNone: false }, "indigo", themes, null), []);
  });

  it("keeps favourites in order, skips deleted ones, and toggles", () => {
    assert.deepEqual(favouriteThemes(["synth-fixture", "gone", "indigo"], themes).map((t) => t.id), ["synth-fixture", "indigo"]);
    assert.deepEqual(toggleFavourite(["a", "b"], "a"), ["b"]);
    assert.deepEqual(toggleFavourite(["a"], "b"), ["a", "b"]);
  });

  it("moves through the grid with the arrow keys", () => {
    assert.equal(moveInGrid(0, "ArrowRight", 13, 6), 1);
    assert.equal(moveInGrid(0, "ArrowLeft", 13, 6), 0);
    assert.equal(moveInGrid(2, "ArrowDown", 13, 6), 8);
    assert.equal(moveInGrid(8, "ArrowDown", 13, 6), 8);
    assert.equal(moveInGrid(8, "ArrowUp", 13, 6), 2);
    assert.equal(moveInGrid(5, "End", 13, 6), 12);
    assert.equal(moveInGrid(5, "Home", 13, 6), 0);
  });
});

describe("the editor model", () => {
  it("opens a stored seeded theme with no overrides, and saves it unchanged", () => {
    const s = editorFromTheme(indigo);
    assert.equal(s.source, "seeded");
    assert.deepEqual(s.overrides, {});
    assert.equal(overrideCountText(s), "All automatic");
    const b = buildTheme(s, themes.map((t) => t.id));
    assert.deepEqual(b.problems, []);
    assert.deepEqual(b.theme, indigo);
  });

  it("finds a stored override and keeps it", () => {
    const changed = structuredClone(coral);
    const border = { $type: "color" as const, $value: { colorSpace: "srgb" as const, components: [0, 0, 0] as [number, number, number], hex: "#000000" } };
    changed.tokens.dark!.border = border;
    const s = editorFromTheme(changed);
    assert.equal(s.overrides.border, "auto #000000");
    assert.equal(overrideCountText(s), "1 override");
    assert.deepEqual(buildTheme(s, []).theme, changed);
  });

  it("opens a hand-made dark-only theme and saves it unchanged", () => {
    const s = editorFromTheme(synth);
    assert.deepEqual(s.handModes, { light: false, dark: true });
    assert.equal(s.handTag, true);
    assert.deepEqual(buildTheme(s, []).theme, synth);
  });

  it("parses and formats override fields", () => {
    assert.deepEqual(parseOverride(""), { ok: true });
    assert.deepEqual(parseOverride("#abcdef"), { ok: true, light: "#ABCDEF", dark: "#ABCDEF" });
    assert.deepEqual(parseOverride("#111111 #eeeeee"), { ok: true, light: "#111111", dark: "#EEEEEE" });
    assert.deepEqual(parseOverride("auto, #eeeeee"), { ok: true, dark: "#EEEEEE" });
    assert.deepEqual(parseOverride("red"), { ok: false });
    assert.deepEqual(parseOverride("#111111 #222222 #333333"), { ok: false });
    assert.equal(formatOverride("#111111", "#111111"), "#111111");
    assert.equal(formatOverride("#111111", undefined), "#111111 auto");
    assert.equal(formatOverride(undefined, undefined), "");
  });

  it("refuses to save what isn't a theme yet", () => {
    const s = { ...newEditorState(), name: "", id: "none", overrides: { border: "blue" } };
    const b = buildTheme(s, []);
    assert.equal(b.theme, null);
    assert.ok(b.problems.some((p) => p.includes("reserved")));
    assert.ok(b.problems.some((p) => p.includes("name")));
    assert.ok(b.problems.some((p) => p.includes("border")));
    assert.equal(idProblem("indigo", true, ["indigo"]), "A theme with this ID exists. Choose another.");
    assert.equal(idProblem("indigo", false, ["indigo"]), null);
    assert.equal(idProblem("Bad Id", true, []), "An ID is lower-case letters, digits and single dashes, at most 64.");
  });

  it("makes a new seeded theme that validates, with the tag seed in its source", () => {
    const s = { ...newEditorState(), id: "ocean", name: "Ocean", primary: "#0B7A75", tag: "#FF6F59", schemeStyle: "vibrant" as const, contrast: 2 as const };
    const b = buildTheme(s, []);
    assert.ok(b.theme);
    assert.ok(validateTheme(b.theme).ok);
    assert.deepEqual(b.theme.source, { kind: "seeded", seeds: { primary: "#0B7A75", tag: "#FF6F59" }, schemeStyle: "vibrant", contrast: 2 });
  });

  it("switches to hand-made from the colours shown, and can drop a mode and the tag", () => {
    const seeded = { ...newEditorState(), id: "x", name: "X" };
    const shown = draftColors(seeded);
    let s = withSource(seeded, "handmade");
    assert.deepEqual(draftColors(s), shown);
    s = { ...s, handModes: { light: false, dark: true }, handTag: false };
    const b = buildTheme(s, []);
    assert.ok(b.theme);
    assert.deepEqual(b.theme.modes, ["dark"]);
    assert.equal(b.theme.tokens.dark?.tag, undefined);
    assert.deepEqual(b.theme.source, { kind: "handmade" });
  });

  it("groups the tokens as the manifest does", () => {
    const g = tokenGroups(newEditorState());
    assert.deepEqual(g.map((x) => x.label), ["Surfaces", "Text", "Brand", "Second accent", "Status", "Charts"]);
    assert.equal(g.flatMap((x) => x.rows).length, 35);
  });

  it("derives ids, reads radii, and notices changes", () => {
    assert.equal(slugify("Ocean Night!"), "ocean-night");
    assert.equal(slugify("Café au lait"), "cafe-au-lait");
    assert.equal(slugify("None"), "none-theme");
    assert.deepEqual(parseRadius("10px")?.$value, { value: 10, unit: "px" });
    assert.deepEqual(parseRadius(" .5rem ")?.$value, { value: 0.5, unit: "rem" });
    assert.equal(parseRadius("10"), null);
    const a = newEditorState();
    assert.ok(sameState(a, { ...a, idTouched: true }));
    assert.ok(!sameState(a, { ...a, primary: "#000000" }));
  });
});

describe("people", () => {
  it("lists groups, then users, by byte order, with notes", () => {
    const rows = policyRows(
      {
        users: { bob: { theme: "indigo", kind: "default" } },
        groups: { family: { theme: "gone", kind: "enforced" }, Zed: { theme: "indigo", kind: "default" } },
      },
      themes,
    );
    assert.deepEqual(rows.map((r) => `${r.badge} ${r.name}`), ["G Zed", "G family", "U bob"]);
    assert.equal(rows[1]?.note, "Everyone in family sees gone (deleted) in every app. Their drawer only previews.");
    assert.equal(rows[2]?.note, "Starts on Indigo. They may pick their own.");
  });
});

describe("routes", () => {
  it("maps paths to pages", () => {
    assert.deepEqual(parseRoute("/"), { page: "themes" });
    assert.deepEqual(parseRoute("/themes/"), { page: "themes" });
    assert.deepEqual(parseRoute("/editor/new"), { page: "editor", id: null });
    assert.deepEqual(parseRoute("/editor/ocean-2"), { page: "editor", id: "ocean-2" });
    assert.equal(parseRoute("/editor/Bad--id").page, "not-found");
    assert.deepEqual(parseRoute("/examples", "?theme=harbor&example=gamarr-library"), { page: "examples", theme: "harbor", example: "gamarr-library" });
    assert.deepEqual(parseRoute("/examples", "?theme=<x>"), { page: "examples", theme: null, example: null });
    assert.deepEqual(parseRoute("/add", "?app=board"), { page: "add", app: "board" });
    assert.equal(navOf(parseRoute("/editor/x")), "themes");
    assert.equal(examplesHref("harbor", "gamarr-library"), "/examples?theme=harbor&example=gamarr-library");
    assert.equal(editorHref(null), "/editor/new");
  });
});

describe("integrate", () => {
  it("has a guide per app, then one for any app", () => {
    const g = guides(apps, "https://themarr.test");
    assert.deepEqual(g.map((x) => x.id), ["board", "games", "plain", "plain"]);
    assert.match(g[0]?.snippet ?? "", /app: 'board', url: 'https:\/\/themarr.test'/);
    assert.match(guides([{ id: "vibe-kanban", name: "vk" }], "https://t.test")[0]?.snippet ?? "", /hsl|VIBE_KANBAN_MAP/);
    assert.equal(warnLine("https://t.test", "board"), "[themarr] unreachable (https://t.test, board): timeout after 1000 ms; using app defaults");
  });
});

describe("drawer", () => {
  const catalog = {
    themes: [
      { id: "a", name: "A", version: 1, modes: ["light", "dark"] as ("light" | "dark")[], swatch: { light: { primary: "#111111", background: "#FFFFFF", foreground: "#000000" }, dark: { primary: "#222222", background: "#000000", foreground: "#FFFFFF" } } },
      { id: "b", name: "B", version: 2, modes: ["dark"] as ("light" | "dark")[], swatch: { dark: { primary: "#333333", background: "#101010", foreground: "#EEEEEE" } } },
    ],
    favourites: ["b", "gone"],
  };

  it("puts favourites first, with the name on the dark strip", () => {
    const t = tiles(catalog);
    assert.deepEqual(t.favourites.map((x) => x.id), ["b"]);
    assert.deepEqual(t.others.map((x) => x.id), ["a"]);
    assert.deepEqual([t.others[0]?.fill, t.others[0]?.band, t.others[0]?.bandFg], ["#111111", "#000000", "#FFFFFF"]);
    assert.equal(t.favourites[0]?.modes, "dark only");
  });

  it("offers no scope while locked, and the app scope only to admins", () => {
    assert.deepEqual(scopes({ locked: true, canSaveMe: true, admin: true, app: "board" }), []);
    assert.deepEqual(scopes({ locked: false, canSaveMe: true, admin: false, app: "board" }).map((s) => s.id), ["browser", "me"]);
    assert.deepEqual(scopes({ locked: false, canSaveMe: false, admin: true, app: "board" }).map((s) => s.label), ["This browser", "Everyone on board"]);
    assert.equal(applyLabel("app", "board"), "Assign to board");
  });

  it("says what the person sees now", () => {
    assert.deepEqual(seeNow({ source: "local", local: "a" }, { local: "A" }), { name: "A", from: "this browser" });
    assert.deepEqual(seeNow({ source: "enforced", version: 3 }, {}), { name: "A theme (version 3)", from: "set by an admin" });
    assert.deepEqual(seeNow({ source: "none" }, {}), { name: "No theme", from: "the app's own look" });
  });
});
