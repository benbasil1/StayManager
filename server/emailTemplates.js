// Professional, email-client-safe HTML emails for StayManager.
// Table layout + inline CSS (Gmail, Outlook and Apple Mail ignore most <style> blocks).
// Every builder returns { subject, html, text } so each email also has a plain-text version,
// which improves spam scoring and helps accessibility.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const BRAND = '#1f8a4c'
const INK = '#14201a'
const MUTED = '#5f6b64'
const BG = '#f3f6f4'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function button(href, label) {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td align="center" bgcolor="${BRAND}" style="border-radius:999px">` +
    `<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${esc(label)}</a>` +
    `</td></tr></table>`
  )
}

function layout({ preheader, heading, bodyHtml, env, reason }) {
  const support = env.SUPPORT_EMAIL || env.MAIL_REPLY_TO || ''
  const year = new Date().getUTCFullYear()
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BG}">` +
    // hidden preview text shown next to the subject in the inbox
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG}"><tr><td align="center" style="padding:32px 12px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">` +
    // header
    `<tr><td style="padding:0 8px 16px;font-family:${FONT};font-size:22px;font-weight:800;color:${BRAND};letter-spacing:-0.3px">StayManager</td></tr>` +
    // card
    `<tr><td style="background:#ffffff;border-radius:16px;border:1px solid #e3e9e5;padding:36px 32px;font-family:${FONT};color:${INK};font-size:16px;line-height:1.6">` +
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:800;color:${INK}">${esc(heading)}</h1>` +
    bodyHtml +
    `</td></tr>` +
    // footer
    `<tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">` +
    `${esc(reason)}<br>` +
    (support ? `Need help? Write to <a href="mailto:${esc(support)}" style="color:${MUTED}">${esc(support)}</a>.<br>` : '') +
    `&copy; ${year} StayManager &middot; PG &amp; hostel management` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  )
}

const p = (html) => `<p style="margin:0 0 14px">${html}</p>`
const small = (html) => `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${MUTED}">${html}</p>`

// ───────────── welcome (sent once, right after the account is created) ─────────────
export function welcomeEmail({ env, appUrl }) {
  const step = (n, title, body) =>
    `<tr><td valign="top" style="padding:0 14px 14px 0;width:34px"><div style="width:30px;height:30px;line-height:30px;text-align:center;border-radius:50%;background:#e7f4ec;color:${BRAND};font-weight:800;font-size:14px">${n}</div></td>` +
    `<td valign="top" style="padding:3px 0 14px;font-size:15px;line-height:1.5"><strong>${esc(title)}</strong><br><span style="color:${MUTED}">${esc(body)}</span></td></tr>`
  const html = layout({
    env,
    preheader: 'Your account is ready. Here is how to set up your PG in a few minutes.',
    heading: 'Welcome to StayManager',
    reason: 'You are receiving this email because an account was created with this address on StayManager.',
    bodyHtml:
      p('Hi,') +
      p('Your account is ready. StayManager keeps your rooms, tenants, rent, complaints and calls in one place, so running your PG takes less time.') +
      p('<strong>Get set up in three steps</strong>') +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0">` +
      step(1, 'Add your PG and rooms', 'Enter the name, floors and beds once.') +
      step(2, 'Add your tenants', 'Record rent, deposit and ID proof for each person.') +
      step(3, 'Print the complaint QR poster', 'Tenants scan it to raise a complaint straight to you and your attender.') +
      `</table>` +
      button(appUrl, 'Open StayManager') +
      small('If the button does not work, copy this link into your browser:<br>' + `<a href="${esc(appUrl)}" style="color:${BRAND};word-break:break-all">${esc(appUrl)}</a>`) +
      small('Just reply to this email if you need a hand. We read every message.'),
  })
  const text =
    `Welcome to StayManager\n\n` +
    `Your account is ready. StayManager keeps your rooms, tenants, rent, complaints and calls in one place.\n\n` +
    `Get set up in three steps:\n` +
    `1. Add your PG and rooms\n2. Add your tenants\n3. Print the complaint QR poster\n\n` +
    `Open StayManager: ${appUrl}\n\n` +
    `Just reply to this email if you need a hand.\n\n` +
    `You are receiving this email because an account was created with this address on StayManager.`
  return { subject: 'Welcome to StayManager', html, text }
}

// ───────────── 6-digit verification code ─────────────
export function codeEmail({ env, code, why, minutes }) {
  const html = layout({
    env,
    preheader: `Your StayManager code is ${code}. It expires in ${minutes} minutes.`,
    heading: 'Your verification code',
    reason: 'You are receiving this email because a code was requested for this address on StayManager.',
    bodyHtml:
      p(esc(why)) +
      `<div style="margin:22px 0;padding:18px 0;text-align:center;background:#f1f5f0;border-radius:12px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:34px;font-weight:800;letter-spacing:10px;color:${INK}">${esc(code)}</div>` +
      small(`This code expires in ${minutes} minutes and works once. StayManager will never ask you for it by phone, SMS or WhatsApp. If you did not request it, you can safely ignore this email.`),
  })
  const text = `Your StayManager verification code: ${code}\n\n${why}\n\nIt expires in ${minutes} minutes and works once. We never ask for this code by phone, SMS or WhatsApp. If you did not request it, ignore this email.`
  return { subject: `${code} is your StayManager code`, html, text }
}

// ───────────── password reset link ─────────────
export function resetEmail({ env, link, minutes }) {
  const html = layout({
    env,
    preheader: 'Choose a new password for your StayManager account.',
    heading: 'Reset your password',
    reason: 'You are receiving this email because a password reset was requested for this address on StayManager.',
    bodyHtml:
      p('Someone asked to reset the password for your StayManager account. Select the button below to choose a new one.') +
      button(link, 'Choose a new password') +
      small(`The link works once and expires in ${minutes} minutes.<br>If the button does not work, copy this link into your browser:<br><a href="${esc(link)}" style="color:${BRAND};word-break:break-all">${esc(link)}</a>`) +
      small('If you did not ask for this, ignore this email. Your password stays the same.'),
  })
  const text = `Reset your StayManager password\n\nSomeone asked to reset the password for your account. Open this link to choose a new one (works once, expires in ${minutes} minutes):\n${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`
  return { subject: 'Reset your StayManager password', html, text }
}
