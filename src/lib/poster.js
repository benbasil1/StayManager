// The printable "Scan to report a problem" poster (A4). Opens in a new window and prints itself.
// Numbers are only shown when the owner has entered them in Settings; an empty number leaves its card off.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const showPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : ''
}

export function posterHtml({ name, qrImage, link, ownerPhone, attenderPhone }) {
  const pg = String(name || '').trim() || 'Your PG'
  const nameSize = pg.length > 34 ? 28 : pg.length > 26 ? 36 : pg.length > 18 ? 46 : 54
  const owner = showPhone(ownerPhone)
  const attender = showPhone(attenderPhone)
  const phone = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z"/></svg>'
  const card = (label, num) => `<div class="call"><div class="ic">${phone}</div><div><div class="lab">${label}</div><div class="num">${esc(num)}</div></div></div>`
  const calls = [owner && card('OWNER', owner), attender && card('ATTENDER', attender)].filter(Boolean)
  const step = (n, t, a, b) => `<div class="step"><div class="sh"><span class="n">${n}</span><span class="t">${t}</span></div><p>${a}<br>${b}</p></div>`

  return `<!doctype html><html><head><meta charset="utf-8"><title>Complaint QR - ${esc(pg)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;700&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact }
html, body { width: 794px; height: 1123px; background: #fff; font-family: 'Poppins','Segoe UI',Arial,sans-serif; color: #16201b }
.page { position: relative; width: 794px; height: 1123px; overflow: hidden; display: flex; flex-direction: column; align-items: center }
.hd { position: relative; width: 100%; height: 238px; background: #1f8a4c; overflow: hidden; display: flex; flex-direction: column; align-items: center; padding-top: 24px }
.hd:before, .hd:after { content: ''; position: absolute; border-radius: 50%; background: #34a062 }
.hd:before { width: 288px; height: 288px; right: -80px; top: -122px }
.hd:after { width: 218px; height: 218px; left: -90px; top: 150px }
.logo { position: relative; z-index: 1; width: 77px; height: 77px; border-radius: 19px; background: #fff; display: flex; align-items: center; justify-content: center }
.pg { position: relative; z-index: 1; margin-top: 14px; max-width: 700px; text-align: center; font-weight: 700; color: #fff; line-height: 1.12; font-size: ${nameSize}px }
.tag { position: relative; z-index: 1; margin-top: 12px; font-weight: 500; font-size: 21px; color: #d6f0e0 }
h1 { margin-top: 26px; font-size: 41px; font-weight: 700; line-height: 1.15 }
.sub { margin-top: 4px; font-size: 19px; color: #5f7066 }
.qrbox { position: relative; margin-top: 22px; width: 304px; height: 304px; border: 6px solid #1f8a4c; border-radius: 36px; background: #fff; box-shadow: 5px 8px 0 #d6e4db; display: flex; align-items: center; justify-content: center }
.qrbox img { width: 240px; height: 240px; display: block }
.scan { position: absolute; left: 50%; bottom: -24px; transform: translateX(-50%); width: 270px; height: 46px; border-radius: 23px; background: #1f8a4c; color: #fff; font-weight: 700; font-size: 22px; display: flex; align-items: center; justify-content: center; letter-spacing: .5px }
.how { margin-top: 42px; font-size: 16px; color: #5f7066 }
.steps { margin-top: 18px; display: flex; gap: 26px; align-items: stretch }
.step { position: relative; width: 218px; height: 108px; border-radius: 18px; background: #ecf6f0; padding: 14px 16px }
.step:not(:last-child):after { content: ''; position: absolute; right: -19px; top: 46px; border-left: 11px solid #1f8a4c; border-top: 7px solid transparent; border-bottom: 7px solid transparent }
.sh { display: flex; align-items: center; gap: 10px }
.n { width: 36px; height: 36px; border-radius: 50%; background: #1f8a4c; color: #fff; font-weight: 700; font-size: 20px; display: flex; align-items: center; justify-content: center }
.t { font-weight: 700; font-size: 21px; color: #123c26 }
.step p { margin-top: 10px; font-size: 15px; line-height: 1.35; color: #5f7066 }
.urgent { margin-top: 24px; font-weight: 700; font-size: 22px }
.calls { margin-top: 12px; display: flex; gap: 26px }
.call { width: 346px; height: 86px; border-radius: 19px; background: #123c26; display: flex; align-items: center; gap: 16px; padding: 0 20px }
.ic { width: 44px; height: 44px; border-radius: 50%; background: #1f8a4c; display: flex; align-items: center; justify-content: center; flex: none }
.lab { font-weight: 500; font-size: 14px; color: #aad7bc; letter-spacing: .6px }
.num { font-weight: 700; font-size: 26px; color: #fff; line-height: 1.2 }
.foot { position: absolute; left: 64px; right: 64px; bottom: 16px; border-top: 1.5px solid #d6e4db; padding-top: 8px; text-align: center; font-size: 13px; color: #5f7066; line-height: 1.5 }
.foot .u { word-break: break-all; font-size: 12px }
.foot b { color: #1f8a4c }
</style></head><body><div class="page">
<div class="hd">
  <div class="logo"><svg width="46" height="46" viewBox="0 0 46 46"><rect x="6" y="8" width="3.4" height="32" fill="#1f8a4c"/><rect x="6" y="28" width="36" height="3.6" fill="#1f8a4c"/><rect x="38.6" y="28" width="3.4" height="12" fill="#1f8a4c"/><rect x="14" y="16" width="11" height="8" rx="4" fill="#1f8a4c"/><rect x="28" y="17" width="14" height="11" rx="3" fill="none" stroke="#1f8a4c" stroke-width="3"/></svg></div>
  <div class="pg">${esc(pg)}</div>
  <div class="tag">Welcome home &nbsp;·&nbsp; We’re here to help</div>
</div>
<h1>Scan to report a problem</h1>
<div class="sub">Water, power, Wi-Fi, cleaning, repairs, anything.</div>
<div class="qrbox"><img src="${qrImage}" alt="QR code"><div class="scan">SCAN ME</div></div>
<div class="how">Open your phone camera and point it at the code. No app needed.</div>
<div class="steps">${step(1, 'Scan', 'Point your camera', 'at the code')}${step(2, 'Describe', 'Tell us what', 'the problem is')}${step(3, 'We fix it', 'Our team gets', 'the alert at once')}</div>
${calls.length ? `<div class="urgent">Urgent?&nbsp; Call us directly</div><div class="calls">${calls.join('')}</div>` : ''}
<div class="foot">Can’t scan?&nbsp; Type this link in your browser:<br><span class="u">${esc(link)}</span><br>Complaints managed with <b>StayManager</b></div>
</div>
<script>window.addEventListener('load', function () {
  var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  Promise.race([ready, new Promise(function (r) { setTimeout(r, 2500) })]).then(function () { setTimeout(function () { window.focus(); window.print() }, 250) })
})</script>
</body></html>`
}
