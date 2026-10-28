// A small history router: links push a path, the back button pops one, and
// every page reads the route from useRoute(). The server answers every UI
// path with index.html (internal/webui).

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { parseRoute, type Route } from "./logic/routes.ts";

const EVENT = "themarr:navigate";

/** A page with unsaved changes asks before a link takes the admin away. */
let leaveGuard: (() => boolean) | null = null;

export function setLeaveGuard(fn: (() => boolean) | null): void {
  leaveGuard = fn;
}

/** True after the first navigation inside the page (pages then move focus to their heading). */
export let navigated = false;

export function navigate(href: string, opts: { replace?: boolean } = {}): void {
  if (leaveGuard !== null && !leaveGuard()) return;
  navigated = true;
  if (opts.replace === true) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(EVENT));
}

function current(): Route {
  return parseRoute(location.pathname, location.search);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const update = () => setRoute(current());
    const pop = () => {
      navigated = true;
      update();
    };
    window.addEventListener(EVENT, update);
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("popstate", pop);
    };
  }, []);
  return route;
}

type LinkProps = Omit<JSX.HTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  href: string;
  children?: ComponentChildren;
  /** Runs before the navigation (closing a popover, say). */
  onClick?: () => void;
};

/** An <a> that navigates inside the page (a new tab still works). */
export function Link({ href, children, onClick: before, ...rest }: LinkProps) {
  const onClick = (e: MouseEvent) => {
    before?.();
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
