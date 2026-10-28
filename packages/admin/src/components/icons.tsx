// Inline SVG icons (no icon font, no request). Every icon is decorative:
// the control around it carries the words.

import type { JSX } from "preact";

function Svg(props: { size?: number; children: JSX.Element | JSX.Element[]; fill?: string; stroke?: number }) {
  const s = props.size ?? 18;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={props.fill ?? "none"}
      stroke="currentColor"
      stroke-width={props.stroke ?? 1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {props.children}
    </svg>
  );
}

export const IconThemes = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18c1.7 0 2-1.3 2-2.2 0-1.4-1.2-1.8-1.2-3.1 0-1.2 1-2.2 2.2-2.2H17a4 4 0 0 0 4-4C21 6 17 3 12 3z" />
  </Svg>
);

export const IconApps = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

export const IconPeople = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16 14.2c3 .2 5.5 2.3 5.5 5.3" />
  </Svg>
);

export const IconExamples = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M3 9h18" />
    <path d="M8 21h8" />
  </Svg>
);

export const IconCode = () => (
  <Svg>
    <path d="M8 7l-5 5 5 5" />
    <path d="M16 7l5 5-5 5" />
  </Svg>
);

export const IconPlus = () => (
  <Svg size={16} stroke={2.2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconClose = () => (
  <Svg size={20} stroke={2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconChevron = () => (
  <Svg size={16} stroke={2}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const IconBack = () => (
  <Svg size={20} stroke={2}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);

export const IconDownload = () => (
  <Svg size={16} stroke={2}>
    <path d="M12 4v11" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </Svg>
);

export const IconStar = (props: { filled: boolean; size?: number }) => (
  <Svg size={props.size ?? 18} fill={props.filled ? "currentColor" : "none"}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
  </Svg>
);

/** The themarr mark: three overlapping circles in the UI's own colours. */
export const Logo = () => (
  <svg class="logo" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
    <circle class="logo-a" cx="10" cy="11" r="7" />
    <circle class="logo-b" cx="18" cy="11" r="7" />
    <circle class="logo-c" cx="14" cy="18" r="7" />
  </svg>
);
