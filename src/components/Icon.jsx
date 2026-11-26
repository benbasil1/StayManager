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
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
}

// Brand marks are filled, not stroked, and keep their own colours. Rendered separately below.
const brand = {
  google: (
    <>
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.41 13.91a6 6 0 0 1 0-3.82V7.5H3.06a10 10 0 0 0 0 9l3.35-2.59z" />
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.35 2.59C7.2 7.71 9.4 5.95 12 5.95z" />
    </>
  ),
  apple: (
    <path
      fill="currentColor"
      d="M16.36 12.7c.02 2.45 2.15 3.26 2.18 3.28-.02.06-.34 1.17-1.13 2.32-.68.99-1.39 1.98-2.5 2-.1.02-1.05.02-1.16.02-1.08 0-1.42-.16-2.18-.16-.77 0-1.15.16-2.2.16-.11 0-1.07 0-1.18-.02-1.09-.02-1.82-1.08-2.51-2.06-.96-1.39-1.62-3.66-1.62-5.87 0-3.36 2.18-5.15 4.32-5.15.9 0 1.66.17 2.11.17.44 0 1.25-.2 2.28-.2.77 0 2.24.08 3.34 1.71-.09.06-1.99 1.17-1.97 3.49zM14.6 4.55c.5-.6.83-1.44.74-2.27-.74.03-1.63.49-2.16 1.1-.46.53-.86 1.38-.75 2.19.82.06 1.66-.42 2.17-1.02z"
    />
  ),
}

export default function Icon({ name, size = 22, stroke = 1.8, className = '' }) {
  if (brand[name]) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {brand[name]}
      </svg>
    )
  }
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
