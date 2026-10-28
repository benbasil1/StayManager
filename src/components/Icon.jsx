const paths = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  bed: <><path d="M3 18V6" /><path d="M3 14h18v4" /><path d="M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.6" /></>,
  inbox: <><path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M3 14h5l1.5 2.5h5L16 14h5" /></>,
  bot: <><rect x="4" y="8" width="16" height="11" rx="3.5" /><path d="M12 8V5" /><circle cx="12" cy="4" r="1" /><circle cx="9" cy="13" r="1" fill="currentColor" /><circle cx="15" cy="13" r="1" fill="currentColor" /><path d="M9.5 16.2c1.5.8 3.5.8 5 0" /></>,
  door: <><path d="M6 3h12v18H6z" /><circle cx="14.5" cy="12" r=".9" fill="currentColor" /></>,
  phone: <><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6" /><circle cx="12" cy="16.5" r=".8" fill="currentColor" /></>,
  logout: <><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" /><path d="M16 8l4 4-4 4" /><path d="M20 12H9" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  pencil: <><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14 4l2-2" /><path d="M20 20v-5h-5" /></>,
  send: <><path d="M4 12l16-8-6 16-2.5-6.5z" /></>,
  check: <><path d="M5 12l5 5 9-10" /></>,
  chevron: <><path d="M9 6l6 6-6 6" /></>,
  settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  switch: <><path d="M4 8h14l-3-3" /><path d="M20 16H6l3 3" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
}

export default function Icon({ name, size = 22, stroke = 1.8, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
