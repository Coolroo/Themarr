// The UI's routes: the server sends index.html for every path outside /v1/
// (internal/webui), and this maps the path to a page.

export type Route =
  | { page: "themes" }
  | { page: "editor"; id: string | null }
  | { page: "apps" }
  | { page: "people" }
  | { page: "examples"; theme: string | null; example: string | null }
  | { page: "add"; app: string | null }
  | { page: "not-found"; path: string };

export type Page = Route["page"];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugParam(q: URLSearchParams, name: string): string | null {
  const v = q.get(name);
  return v !== null && SLUG.test(v) && v.length <= 64 ? v : null;
}

export function parseRoute(pathname: string, search = ""): Route {
  const q = new URLSearchParams(search);
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/themes") return { page: "themes" };
  if (path === "/apps") return { page: "apps" };
  if (path === "/people") return { page: "people" };
  if (path === "/examples") return { page: "examples", theme: slugParam(q, "theme"), example: slugParam(q, "example") };
  if (path === "/add") return { page: "add", app: slugParam(q, "app") };
  if (path === "/editor/new") return { page: "editor", id: null };
  const m = /^\/editor\/([a-z0-9-]{1,64})$/.exec(path);
  if (m !== null && m[1] !== undefined && SLUG.test(m[1])) return { page: "editor", id: m[1] };
  return { page: "not-found", path };
}

export function examplesHref(theme?: string | null, example?: string | null): string {
  const q = new URLSearchParams();
  if (theme) q.set("theme", theme);
  if (example) q.set("example", example);
  const s = q.toString();
  return s === "" ? "/examples" : `/examples?${s}`;
}

export function editorHref(id: string | null): string {
  return id === null ? "/editor/new" : `/editor/${id}`;
}

export function addHref(app?: string | null): string {
  return app ? `/add?app=${encodeURIComponent(app)}` : "/add";
}

/** The nav item a page belongs to. */
export function navOf(route: Route): "themes" | "apps" | "people" | "examples" | "add" | null {
  switch (route.page) {
    case "themes":
    case "editor":
      return "themes";
    case "apps":
    case "people":
    case "examples":
    case "add":
      return route.page;
    default:
      return null;
  }
}
