// One example screen drawn with one mode of a theme (mountExample, decision
// 0008), scaled to fit. The screen is a picture here: it is inert (no tab
// stops inside) and named for screen readers.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { mountExample, type Example, type MountStatus } from "@themarr/examples";
import type { Mode } from "@themarr/tokens";
import type { WireTheme } from "@themarr/web";

export interface FrameProps {
  example: Example;
  theme: WireTheme | undefined;
  mode: Mode;
  /** A fixed scale, or "fit" to the width of the frame's parent (at most 1). */
  scale: number | "fit";
  label: string;
  /** Shown as the caption; the default is the label and the mode note. */
  caption?: string;
}

export function missingNote(status: MountStatus, mode: Mode): string {
  if (status === "missing-mode") return `no ${mode} palette: apps keep their own look in ${mode}`;
  if (status === "no-theme") return "no theme";
  return "";
}

export function ExampleFrame(props: FrameProps) {
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.5);
  const [status, setStatus] = useState<MountStatus>("applied");
  const { width, height } = props.example.size;

  useLayoutEffect(() => {
    if (host.current === null) return;
    setStatus(mountExample(host.current, props.example, props.theme, props.mode).status);
  }, [props.example, props.theme, props.mode]);

  useEffect(() => {
    if (props.scale !== "fit" || box.current === null) return;
    const el = box.current;
    const measure = () => setFit(Math.min(1, Math.max(0.1, el.clientWidth / width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.scale, width]);

  const s = props.scale === "fit" ? fit : props.scale;
  const note = missingNote(status, props.mode);
  return (
    <figure class={`ex-frame ${props.scale === "fit" ? "ex-fit" : ""}`}>
      <div class="ex-box" ref={box}>
        <div
          class="ex-viewport"
          role="img"
          aria-label={`${props.label}${note === "" ? "" : ` (${note})`}`}
          style={{ width: `${Math.round(width * s)}px`, height: `${Math.round(height * s)}px` }}
        >
          <div
            class="ex-host"
            ref={host}
            inert
            aria-hidden="true"
            style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${s})` }}
          />
        </div>
      </div>
      <figcaption class="ex-caption">
        {props.caption ?? props.label}
        {note !== "" && <span class="ex-note"> ({note})</span>}
      </figcaption>
    </figure>
  );
}
