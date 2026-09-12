// Minimal inline line-icons (stroke = currentColor). No external dependency.
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
const svg = (children) => (props) => (
  <svg viewBox="0 0 24 24" {...P} {...props}>{children}</svg>
);

export const Icon = {
  // ── navigation / modules ──
  dashboard: svg(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  caisse: svg(<><rect x="2.5" y="6" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /><circle cx="17" cy="14.5" r="1.4" /></>),
  bon: svg(<><path d="M6 2.5h8l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" /><path d="M13.5 2.5V7h4.5" /><path d="M8.5 13h7M8.5 16.5h7M8.5 9.5h3" /></>),
  stock: svg(<><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" /><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" /></>),
  // Fournisseur = the supplier's storefront where goods originate.
  fournisseur: svg(<><path d="M4.5 10.8V20h15v-9.2" /><path d="M3 7.2 4.5 4h15L21 7.2a2.4 2.4 0 0 1-4.5 1.1 2.4 2.4 0 0 1-4 0 2.4 2.4 0 0 1-4 0A2.4 2.4 0 0 1 3 7.2Z" /><path d="M10 20v-4.5h4V20" /></>),
  // Passager = the human courier who travels with the goods (aviation theme).
  passager: svg(<><rect x="3.5" y="7.5" width="17" height="12.5" rx="2.5" /><path d="M8.5 7.5V5.6A1.6 1.6 0 0 1 10.1 4h3.8a1.6 1.6 0 0 1 1.6 1.6v1.9" /><path d="M12 7.8v11.9" /></>),
  taux: svg(<><path d="M4 8h13l-3-3M20 16H7l3 3" /></>),
  audit: svg(<><path d="M12 2.5 20 6v5c0 5-3.4 8.6-8 10.5C7.4 19.6 4 16 4 11V6l8-3.5Z" /><path d="m9 11.5 2 2 4-4" /></>),
  order: svg(<><circle cx="5.5" cy="6" r="2.2" /><circle cx="18.5" cy="18" r="2.2" /><path d="M5.5 8.2V12a4 4 0 0 0 4 4h6.8" /></>),

  // ── contact / profile ──
  phone: svg(<><path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a1.5 1.5 0 0 1-1.7 1.5C10.6 17.4 5.1 11.9 4.2 4.7A1.5 1.5 0 0 1 5.7 3Z" /></>),
  pin: svg(<><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>),
  calendar: svg(<><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  note: svg(<><rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 9h8M8 13h8M8 17h5" /></>),
  tag: svg(<><path d="M3.5 11.5V4.5a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z" /><circle cx="8" cy="8" r="1.4" /></>),

  // ── actions ──
  plus: svg(<><path d="M12 5v14M5 12h14" /></>),
  edit: svg(<><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M14.5 6.5 17.5 9.5" /></>),
  trash: svg(<><path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5" /></>),
  search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>),
  logout: svg(<><path d="M15 4.5h3a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3" /><path d="M10 8 6 12l4 4M6 12h11" /></>),
  print: svg(<><path d="M7 9V3.5h10V9" /><rect x="4" y="9" width="16" height="7" rx="2" /><path d="M7 14h10v6.5H7z" /></>),
  download: svg(<><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M4 19h16" /></>),

  // ── data / misc ──
  wallet: svg(<><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M16 12.5h2" /><path d="M3 9h15a1 1 0 0 1 1 1" /></>),
  chart: svg(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  trend: svg(<><path d="M3 16.5 9 10l4 4 8-8" /><path d="M21 6v5h-5" /></>),
  inbox: svg(<><path d="M3.5 13h4l1.5 3h6l1.5-3h4" /><path d="M5.5 4.5h13l2 8.5v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-5Z" /></>),
  box: svg(<><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" /><path d="m3.5 7.5 8.5 4.5 8.5-4.5" /></>),
  users: svg(<><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 6.2a3 3 0 0 1 0 5.6M21 19c0-2.2-1.4-3.9-3.5-4.6" /></>),
  swap: svg(<><path d="M7 4 4 7l3 3" /><path d="M4 7h11a4 4 0 0 1 4 4" /><path d="m17 20 3-3-3-3" /><path d="M20 17H9a4 4 0 0 1-4-4" /></>),

  // ── shell / topbar ──
  menu: svg(<><path d="M4 7h16M4 12h16M4 17h16" /></>),
  gear: svg(<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>),
  bell: svg(<><path d="M18 8a6 6 0 1 0-12 0c0 7-2.5 8-2.5 8h17S18 15 18 8Z" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
  help: svg(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.4-2.5 2.4" /><path d="M12 17.2h.01" /></>),
  chevronDown: svg(<><path d="m6 9.5 6 6 6-6" /></>),
  chevronLeft: svg(<><path d="m14 6-6 6 6 6" /></>),
  chevronRight: svg(<><path d="m10 6 6 6-6 6" /></>),
  collapse: svg(<><path d="m13 6-6 6 6 6" /><path d="m19 6-6 6 6 6" /></>),
  close: svg(<><path d="M6 6 18 18M18 6 6 18" /></>),
  check: svg(<><path d="m5 12.5 4.5 4.5L19 7.5" /></>),
  eye: svg(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: svg(<><path d="M10.6 6.1A8.9 8.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.7 3.4M6.3 7.8A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 3.6-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3.5 3.5 17 17" /></>),

  // ── dashboard / finance ──
  alert: svg(<><path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3l-7.8-13.5a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4M12 17h.01" /></>),
  coins: svg(<><ellipse cx="9" cy="6.5" rx="6" ry="2.8" /><path d="M3 6.5v5c0 1.6 2.7 2.9 6 2.9s6-1.3 6-2.9v-5" /><path d="M15 10.2c3 .3 6 1.5 6 3.3v4c0 1.6-2.7 2.9-6 2.9-2.4 0-4.5-.7-5.4-1.7" /></>),
  arrowIn: svg(<><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4 20h16" /></>),
  arrowOut: svg(<><path d="M12 20V9" /><path d="m7.5 13.5 4.5-4.5 4.5 4.5" /><path d="M4 4h16" /></>),
  net: svg(<><path d="M12 4v16" /><path d="M4.5 8.5h15" /><path d="M4.5 8.5 2.5 14h4l-2-5.5ZM19.5 8.5 17.5 14h4l-2-5.5Z" /></>),
  // Connection state, said with a picture: the crossed-out wifi is understood
  // without reading, which is the point of putting it in the top bar.
  wifi: svg(<><path d="M2.5 8.6a15 15 0 0 1 19 0" /><path d="M5.5 12.2a10.5 10.5 0 0 1 13 0" /><path d="M8.8 15.8a5.5 5.5 0 0 1 6.4 0" /><path d="M12 19.2h.01" /></>),
  wifiOff: svg(<><path d="M2.5 8.6a15 15 0 0 1 5.2-3.1M13.2 4.8a15 15 0 0 1 8.3 3.8" /><path d="M5.5 12.2a10.5 10.5 0 0 1 3.1-2M15.4 10.4a10.5 10.5 0 0 1 3.1 1.8" /><path d="M8.8 15.8a5.5 5.5 0 0 1 4.4-1.3" /><path d="M12 19.2h.01" /><path d="m3 3 18 18" /></>),
  refresh: svg(<><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" /><path d="M20.5 4v5h-5" /></>),
  plane: svg(<><path d="M10.5 19.5 12 22l1.5-2.5V15l7 2.5v-2L13.5 10V4.2a1.5 1.5 0 0 0-3 0V10L3.5 15.5v2L10.5 15v4.5Z" /></>),
  report: svg(<><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M8.5 12v4.5M12 8.5v8M15.5 14v2.5" /></>),
  // Le viseur d'une douchette : quatre coins et le trait de lecture.
  scan: svg(<><path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" /><path d="M3.5 12h17" /></>),
  settings: svg(<><path d="M4 7h11M19 7h1M4 17h5M13 17h7" /><circle cx="17" cy="7" r="2.2" /><circle cx="11" cy="17" r="2.2" /></>),
};

export function IconEl({ name, ...props }) {
  const C = Icon[name];
  return C ? C(props) : null;
}

// Initials for avatars ("Fourn Guangzhou" -> "FG").
export function initialsOf(name = '') {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}
