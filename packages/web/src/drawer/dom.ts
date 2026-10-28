// Small helpers to build the drawer's elements. No innerHTML anywhere: theme
// names and other server text only ever go in as textContent.

export function el(doc: Document, tag: string, cls?: string, attrs: Record<string, string> = {}): HTMLElement {
  const e = doc.createElement(tag);
  if (cls !== undefined) e.setAttribute("class", cls);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function button(doc: Document, cls: string, text: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLElement {
  const b = el(doc, "button", cls, { type: "button", ...attrs });
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

export function show(e: Element, visible: boolean): void {
  if (visible) e.removeAttribute("hidden");
  else e.setAttribute("hidden", "");
}

/** The three-circle themarr mark. */
export function logo(doc: Document): HTMLElement {
  const l = el(doc, "span", "logo", { "aria-hidden": "true" });
  for (let i = 0; i < 3; i++) l.appendChild(el(doc, "i"));
  return l;
}
