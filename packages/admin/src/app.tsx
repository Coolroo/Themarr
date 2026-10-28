// The shell: the side navigation (a bottom bar on a phone), the notice line,
// and the page for the route.

import { useMemo, useState } from "preact/hooks";
import { Api } from "./api.ts";
import { PageTitle } from "./components/common.tsx";
import { IconApps, IconClose, IconCode, IconExamples, IconPeople, IconThemes, Logo } from "./components/icons.tsx";
import { DataProvider, useData } from "./data.tsx";
import { navOf, type Route } from "./logic/routes.ts";
import { AppsPage } from "./pages/Apps.tsx";
import { EditorPage } from "./pages/Editor.tsx";
import { ExamplesPage } from "./pages/Examples.tsx";
import { IntegratePage } from "./pages/Integrate.tsx";
import { PeoplePage } from "./pages/People.tsx";
import { ThemesPage } from "./pages/Themes.tsx";
import { Link, useRoute } from "./router.tsx";

const NAV = [
  { id: "themes", href: "/themes", label: "Themes", Icon: IconThemes },
  { id: "apps", href: "/apps", label: "Apps", Icon: IconApps },
  { id: "people", href: "/people", label: "People", Icon: IconPeople },
  { id: "examples", href: "/examples", label: "Examples", Icon: IconExamples },
  { id: "add", href: "/add", label: "Add to an app", Icon: IconCode },
] as const;

function Nav(props: { current: string | null }) {
  return (
    <nav class="nav" aria-label="Themarr">
      <Link href="/themes" class="brand" aria-label="Themarr, themes">
        <Logo />
        <span class="brand-name">themarr</span>
      </Link>
      <ul class="nav-list">
        {NAV.map(({ id, href, label, Icon }) => (
          <li key={id}>
            <Link href={href} class="nav-item" aria-current={props.current === id ? "page" : undefined}>
              <Icon />
              <span class="nav-label">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div class="nav-foot">Admins only · signed in with Authelia</div>
    </nav>
  );
}

function Notice() {
  const { notice, dismiss } = useData();
  if (notice === null) return <div class="notice-slot" role="status" aria-live="polite" />;
  return (
    <div class="notice-slot" role={notice.kind === "error" ? "alert" : "status"} aria-live={notice.kind === "error" ? "assertive" : "polite"}>
      <div class={`notice ${notice.kind === "error" ? "notice-error" : "notice-ok"}`} key={notice.id}>
        <span class="grow">{notice.text}</span>
        <button type="button" class="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={dismiss}>
          <IconClose />
        </button>
      </div>
    </div>
  );
}

function Page(props: { route: Route }) {
  const { route } = props;
  switch (route.page) {
    case "themes":
      return <ThemesPage />;
    case "editor":
      return <EditorPage key={route.id ?? "new"} id={route.id} />;
    case "apps":
      return <AppsPage />;
    case "people":
      return <PeoplePage />;
    case "examples":
      return <ExamplesPage theme={route.theme} example={route.example} />;
    case "add":
      return <IntegratePage key={route.app ?? ""} app={route.app} />;
    case "not-found":
      return (
        <section class="card pad empty">
          <PageTitle title="Not found">Page not found</PageTitle>
          <p class="muted">Nothing lives at {route.path}.</p>
          <Link href="/themes" class="btn">
            Go to themes
          </Link>
        </section>
      );
  }
}

function Shell() {
  const route = useRoute();
  const data = useData();
  let body;
  if (data.snap !== null) body = <Page route={route} />;
  else if (data.fatal !== null)
    body = (
      <section class="card pad empty" role="alert">
        <h1 class="page-title">Themarr can't load its data</h1>
        <p>{data.fatal}</p>
        <button type="button" class="btn btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
      </section>
    );
  else body = <p class="loading muted">Loading…</p>;
  return (
    <div class="shell">
      <a class="skip" href="#main">
        Skip to content
      </a>
      <Nav current={navOf(route)} />
      <main id="main" class="main">
        <Notice />
        {body}
      </main>
    </div>
  );
}

export function App(props: { onChanged?: () => void }) {
  const [down, setDown] = useState(false);
  const api = useMemo(() => new Api({ onUnreachable: () => setDown(true) }), []);
  return (
    <DataProvider api={api} {...(props.onChanged === undefined ? {} : { onChanged: props.onChanged })}>
      {down && (
        <div class="down" role="alert">
          Themarr can't be reached. The page shows what it had; try again in a moment.
        </div>
      )}
      <Shell />
    </DataProvider>
  );
}
