// functions/api/voice-webhook.js
// Cloudflare Pages Function -> https://<your-domain>/api/voice-webhook?k=<VOICE_WEBHOOK_KEY>
// One URL serves all 9 ElevenLabs tools. The tool name arrives in body.function.
// Talks to Turso over its HTTP API (no npm dependency needed).
//
// Environment variables (Cloudflare Pages -> Settings -> Environment variables):
//   VOICE_WEBHOOK_KEY      secret that must be sent as ?k=...
//   TURSO_DATABASE_URL     libsql://xxxx.turso.io
//   TURSO_AUTH_TOKEN       Turso auth token

const TZ_MIN = 330; // IST
const SHARING = { 1: 'single', 2: 'double', 3: 'triple', 4: 'four' };
const FAIL_MSG =
  "I couldn't complete that right now. Tell the caller the CK Co-Live team will confirm the details and follow up.";

// ---------------------------------------------------------------- HTTP entry

export async function onRequestGet() {
  return json({ ok: true, service: 'voice-webhook' });
}

export async function onRequestPost({ request, env }) {
  const expected = env.VOICE_WEBHOOK_KEY;
  if (!expected) return json({ error: 'VOICE_WEBHOOK_KEY is not configured' }, 500);

  const url = new URL(request.url);
  const supplied = url.searchParams.get('k') || request.headers.get('x-webhook-key') || '';
  if (!safeEqual(supplied, expected)) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return ok({ ok: false, message: 'Invalid request body.' });
  }

  const fn = str(body.function);
  const handler = HANDLERS[fn];
  if (!handler) return ok({ ok: false, message: `Unknown function: ${fn || '(none)'}` });

  try {
    return ok(await handler(env, body));
  } catch (e) {
    console.error('voice-webhook error in', fn, e && e.message ? e.message : e);
    return ok({ ok: false, message: FAIL_MSG });
  }
}

const HANDLERS = {
  get_property_info,
  check_beds,
  get_visit_slots,
  book_visit,
  reserve_bed,
  log_complaint,
  lookup_resident,
  report_leaving,
  check_complaint_status,
};

// ---------------------------------------------------------------- small utils

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
// ElevenLabs is configured to read only the "results" key of the response.
const ok = (data) => json({ results: data });

const newId = () => crypto.randomUUID();
const nowUtc = () => new Date().toISOString();
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const compact = (s) => str(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (s) => str(s).replace(/\D/g, '');
const last10 = (s) => digits(s).slice(-10);
const dcol = (c) =>
  `replace(replace(replace(replace(replace(${c},' ',''),'-',''),'+',''),'(',''),')','')`;

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- Turso client

function encArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  return { type: 'text', value: String(v) };
}
function decVal(c) {
  if (!c || c.type === 'null') return null;
  if (c.type === 'integer') return Number(c.value);
  if (c.type === 'float') return Number(c.value);
  return c.value;
}

async function sql(env, stmt, args = []) {
  const rawUrl = env.TURSO_DATABASE_URL || env.TURSO_URL;
  const token = env.TURSO_AUTH_TOKEN || env.TURSO_TOKEN;
  if (!rawUrl || !token) throw new Error('Turso env vars missing');
  const base = rawUrl.replace(/^libsql:\/\//, 'https://').replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '');
  const res = await fetch(base + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      requests: [{ type: 'execute', stmt: { sql: stmt, args: args.map(encArg) } }, { type: 'close' }],
    }),
  });
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}`);
  const data = await res.json();
  const first = data.results && data.results[0];
  if (!first) throw new Error('Turso: empty response');
  if (first.type === 'error') throw new Error('Turso: ' + (first.error && first.error.message));
  const r = first.response.result;
  const cols = r.cols.map((c) => c.name);
  return r.rows.map((row) => {
    const o = {};
    row.forEach((cell, i) => (o[cols[i]] = decVal(cell)));
    return o;
  });
}

// ---------------------------------------------------------------- date helpers (IST)

function todayIST() {
  return new Date(Date.now() + TZ_MIN * 60000).toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function validYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const hm = (t) => str(t).slice(0, 5) || '09:00';
const atIST = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);

function fmt12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONS[d.getUTCMonth()]}`;
}
function fmtDateTimeIST(date) {
  const s = new Date(date.getTime() + TZ_MIN * 60000);
  const ymd = s.toISOString().slice(0, 10);
  const t = s.toISOString().slice(11, 16);
  return `${fmtDay(ymd)}, ${fmt12(t)}`;
}
// Stored visit_at may be UTC/offset ISO, or a naive local (IST) string.
function parseVisit(s) {
  const v = str(s).replace(' ', 'T');
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) return Date.parse(v);
  return Date.parse(v.length === 16 ? v + ':00+05:30' : v + '+05:30');
}

// ---------------------------------------------------------------- PG resolution

function splitAliases(a) {
  return str(a).split(/[,;|\n]+/).map((x) => x.trim()).filter(Boolean);
}

async function resolvePg(env, pgName) {
  const props = await sql(env, 'SELECT * FROM properties ORDER BY name');
  if (!props.length) return { ask: 'No PG is set up in the system. Tell the caller the team will follow up.' };
  const list = props.map((p) => `"${p.name}"`).join(' or ');
  const input = compact(pgName);

  if (!input) {
    if (props.length === 1) return { prop: props[0] };
    return { ask: `Ask the caller which PG they mean: ${list}. Then call this tool again with pg_name.` };
  }

  const keys = (p) =>
    [p.name, p.voice_number, ...splitAliases(p.voice_aliases)].map(compact).filter(Boolean);

  // 1) exact match on name / alias
  let hit = props.filter((p) => keys(p).includes(input));
  if (hit.length === 1) return { prop: hit[0] };

  if (hit.length === 0) {
    // 2) caller text contains a PG name/alias: take the longest one
    let best = null;
    let bestLen = 0;
    let tie = false;
    for (const p of props) {
      for (const k of keys(p)) {
        if (input.includes(k)) {
          if (k.length > bestLen) { best = p; bestLen = k.length; tie = false; }
          else if (k.length === bestLen && best !== p) tie = true;
        }
      }
    }
    if (best && !tie) return { prop: best };

    // 3) a PG name/alias contains the caller text, only if unique
    hit = props.filter((p) => keys(p).some((k) => k.includes(input)));
    if (hit.length === 1) return { prop: hit[0] };

    // 4) gender words
    const low = str(pgName).toLowerCase();
    if (/\b(ladies|women|woman|girls|female)\b/.test(low)) {
      const c = props.filter((p) => compact(p.name).includes('ladies'));
      if (c.length === 1) return { prop: c[0] };
    } else if (/\b(gents|boys|mixed|men|male)\b/.test(low)) {
      const c = props.filter((p) => !compact(p.name).includes('ladies'));
      if (c.length === 1) return { prop: c[0] };
    }

    if (props.length === 1) return { prop: props[0] };
    return { ask: `I couldn't match "${pgName}". Ask the caller whether they mean ${list}, then call this tool again.` };
  }

  return { ask: `More than one PG matches "${pgName}". Ask the caller whether they mean ${list}, then call this tool again.` };
}

// ---------------------------------------------------------------- beds

async function loadFreeBeds(env, propertyId) {
  const rows = await sql(
    env,
    `SELECT r.room_no, r.floor, r.price, b.id AS bed_id, b.label, b.occupied,
       (SELECT COUNT(*) FROM beds b2 WHERE b2.room_id = r.id) AS total_beds,
       EXISTS (SELECT 1 FROM bed_reservations br
               WHERE br.bed_id = b.id AND br.status IN ('pending','confirmed')
                 AND (br.expires_at IS NULL OR br.expires_at > ?)) AS held,
       EXISTS (SELECT 1 FROM tenants t WHERE t.bed_id = b.id AND t.status = 'active') AS has_tenant
     FROM rooms r JOIN beds b ON b.room_id = r.id
     WHERE r.property_id = ?
     ORDER BY r.price, r.floor, r.room_no, b.label`,
    [new Date().toISOString(), propertyId]
  );
  return rows.filter((x) => x.occupied === 0 && !x.held && !x.has_tenant);
}

const sharingName = (n) => (SHARING[n] ? `${SHARING[n]} sharing` : `${n}-bed room`);

async function check_beds(env, body) {
  const r = await resolvePg(env, body.pg_name);
  if (r.ask) return { ok: false, needs_pg: true, message: r.ask };
  const free = await loadFreeBeds(env, r.prop.id);

  if (!free.length) {
    return {
      ok: true,
      pg: r.prop.name,
      free_beds: 0,
      message: `No beds are free right now at ${r.prop.name}. Tell the caller the CK Co-Live team will confirm when a bed opens up. Do not invent availability.`,
    };
  }

  const rooms = new Map();
  for (const b of free) {
    if (!rooms.has(b.room_no)) {
      rooms.set(b.room_no, {
        room_no: b.room_no,
        floor: b.floor,
        sharing: sharingName(b.total_beds),
        price_per_bed_per_month: b.price,
        free_beds: 0,
      });
    }
    rooms.get(b.room_no).free_beds += 1;
  }
  const list = [...rooms.values()];
  const prices = free.map((b) => b.price).filter((p) => p > 0);
  return {
    ok: true,
    pg: r.prop.name,
    free_beds: free.length,
    lowest_price: prices.length ? Math.min(...prices) : null,
    highest_price: prices.length ? Math.max(...prices) : null,
    rooms: list.slice(0, 15),
    message: `${free.length} bed(s) free at ${r.prop.name}. Prices are per bed per month in rupees. Quote only what is listed here.`,
  };
}

// ---------------------------------------------------------------- property info

async function get_property_info(env, body) {
  const r = await resolvePg(env, body.pg_name);
  if (r.ask) return { ok: false, needs_pg: true, message: r.ask };
  const p = r.prop;
  const info = { pg: p.name };
  const add = (k, v) => { if (str(v)) info[k] = str(v); };
  add('address', p.address);
  add('locality', p.locality);
  add('amenities', p.amenities);
  add('food_details', p.food_details);
  add('house_rules', p.house_rules);
  add('deposit_note', p.deposit_note);
  info.visit_hours = `${fmt12(hm(p.visit_start))} to ${fmt12(hm(p.visit_end))}`;
  info.message =
    'Approved details for this PG. If something the caller asks about is not listed here, say the CK Co-Live team will confirm it.';
  return { ok: true, ...info };
}

// ---------------------------------------------------------------- visits

async function slotsForDay(env, prop, ymd) {
  const slot = Math.max(10, Number(prop.visit_slot_minutes) || 30);
  const start = atIST(ymd, hm(prop.visit_start)).getTime();
  const end = atIST(ymd, hm(prop.visit_end)).getTime();
  const booked = await sql(
    env,
    `SELECT visit_at, duration_minutes, visitor_phone FROM visits
     WHERE property_id = ? AND status = 'scheduled' AND visit_at >= ?`,
    [prop.id, addDays(ymd, -1)]
  );
  const busy = booked
    .map((v) => ({ s: parseVisit(v.visit_at), d: (Number(v.duration_minutes) || slot) * 60000, phone: v.visitor_phone }))
    .filter((v) => !isNaN(v.s));
  const nowMs = Date.now() + 15 * 60000; // small buffer
  const out = [];
  for (let t = start; t + slot * 60000 <= end; t += slot * 60000) {
    if (t <= nowMs) continue;
    if (busy.some((b) => t < b.s + b.d && t + slot * 60000 > b.s)) continue;
    const label = new Date(t + TZ_MIN * 60000).toISOString().slice(11, 16);
    out.push(label);
  }
  return { slots: out, slot, start, end, busy };
}

async function get_visit_slots(env, body) {
  const r = await resolvePg(env, body.pg_name);
  if (r.ask) return { ok: false, needs_pg: true, message: r.ask };
  const prop = r.prop;
  const date = str(body.date);

  if (date) {
    if (!validYmd(date)) return { ok: false, message: 'The date must be YYYY-MM-DD. Ask the caller for the date again.' };
    if (date < todayIST()) return { ok: false, message: 'That date has already passed. Ask the caller for a later date.' };
    const d = await slotsForDay(env, prop, date);
    if (!d.slots.length) {
      return { ok: true, pg: prop.name, date, slots: [], message: `No visit slots are open on ${fmtDay(date)}. Offer another date.` };
    }
    return {
      ok: true,
      pg: prop.name,
      date,
      slots: d.slots.slice(0, 16).map((s) => `${s} (${fmt12(s)})`),
      message: `Open visit times on ${fmtDay(date)} (IST). Use the HH:MM value when booking.`,
    };
  }

  // no date: show the next two days that have openings
  const days = [];
  for (let i = 0; i < 7 && days.length < 2; i++) {
    const ymd = addDays(todayIST(), i);
    const d = await slotsForDay(env, prop, ymd);
    if (d.slots.length) days.push({ date: ymd, day: fmtDay(ymd), slots: d.slots.slice(0, 10).map((s) => `${s} (${fmt12(s)})`) });
  }
  if (!days.length) return { ok: true, pg: prop.name, days: [], message: 'No visit slots are open in the next week. Tell the caller the team will confirm a time.' };
  return { ok: true, pg: prop.name, days, message: 'Nearest open visit times (IST). Ask which day and time suits the caller.' };
}

async function book_visit(env, body) {
  const r = await resolvePg(env, body.pg_name);
  if (r.ask) return { ok: false, needs_pg: true, message: r.ask };
  const prop = r.prop;

  const name = str(body.caller_name);
  const phone = str(body.caller_phone);
  if (!name || last10(phone).length < 10) {
    return { ok: false, message: "Need the visitor's name and full 10-digit phone number. Ask the caller." };
  }
  const m = str(body.visit_datetime).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m || !validYmd(m[1])) return { ok: false, message: 'Visit date and time must look like 2026-10-21T11:00. Confirm the time with the caller.' };

  const ymd = m[1];
  const time = `${m[2]}:${m[3]}`;
  const when = atIST(ymd, time);
  if (isNaN(when)) return { ok: false, message: 'That visit time is not valid. Confirm it with the caller.' };
  if (when.getTime() <= Date.now()) return { ok: false, message: 'That time has already passed. Ask for a later time.' };

  const d = await slotsForDay(env, prop, ymd);
  const slotMs = d.slot * 60000;
  const t = when.getTime();
  if (t < d.start || t + slotMs > d.end) {
    return { ok: false, message: `Visits are between ${fmt12(hm(prop.visit_start))} and ${fmt12(hm(prop.visit_end))}. Ask for a time in that window.` };
  }
  // same person already booked at this time
  const mine = d.busy.find((b) => b.s === t && last10(b.phone) === last10(phone));
  if (mine) {
    return { ok: true, already_booked: true, pg: prop.name, when: fmtDateTimeIST(when), message: `This visit is already booked for ${fmtDateTimeIST(when)}. Confirm it to the caller.` };
  }
  if (!d.slots.includes(time)) {
    const alt = d.slots.slice(0, 8).map((s) => `${s} (${fmt12(s)})`);
    return {
      ok: false,
      message: alt.length
        ? `That time is not available. Offer one of these open times.`
        : `No slots are open on ${fmtDay(ymd)}. Offer another date.`,
      open_slots: alt,
    };
  }

  const ins = await sql(
    env,
    `INSERT INTO visits (id, property_id, visitor_name, visitor_phone, visit_at, duration_minutes, status, source, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 'voice', ?, ?) RETURNING id`,
    [newId(), prop.id, name, phone, when.toISOString(), d.slot, str(body.notes), nowUtc()]
  );
  return {
    ok: true,
    booked: true,
    visit_id: ins[0] && ins[0].id,
    pg: prop.name,
    visitor: name,
    when: fmtDateTimeIST(when),
    message: `Visit booked at ${prop.name} for ${fmtDateTimeIST(when)} (IST). Read the details back to the caller.`,
  };
}

// ---------------------------------------------------------------- bed reservation

async function reserve_bed(env, body) {
  const r = await resolvePg(env, body.pg_name);
  if (r.ask) return { ok: false, needs_pg: true, message: r.ask };
  const prop = r.prop;

  const name = str(body.caller_name);
  const phone = str(body.caller_phone);
  if (!name || last10(phone).length < 10) {
    return { ok: false, message: "Need the customer's name and full 10-digit phone number. Ask the caller." };
  }
  const nowIso = new Date().toISOString();

  // already holding a bed for this phone?
  const existing = await sql(
    env,
    `SELECT br.id, br.expires_at, r.room_no, b.label, r.price
     FROM bed_reservations br
     LEFT JOIN beds b ON b.id = br.bed_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE br.property_id = ? AND br.status IN ('pending','confirmed')
       AND (br.expires_at IS NULL OR br.expires_at > ?)
       AND ${dcol('br.guest_phone')} LIKE ?`,
    [prop.id, nowIso, '%' + last10(phone)]
  );
  if (existing.length) {
    const e = existing[0];
    return {
      ok: true,
      already_reserved: true,
      pg: prop.name,
      room_no: e.room_no,
      bed: e.label,
      message: `A bed is already on hold for this number (room ${e.room_no || '-'}). Tell the caller; do not create another hold.`,
    };
  }

  let free = await loadFreeBeds(env, prop.id);
  const wantRoom = compact(body.room_no);
  if (wantRoom) free = free.filter((b) => compact(b.room_no) === wantRoom);
  const maxPrice = Number(digits(body.max_price));
  if (maxPrice > 0) free = free.filter((b) => b.price <= maxPrice);

  if (!free.length) {
    return {
      ok: false,
      message: wantRoom || maxPrice > 0
        ? 'No free bed matches that room or budget. Run check_beds and offer what is available.'
        : `No bed is free at ${prop.name} right now. Tell the caller the team will confirm when one opens.`,
    };
  }

  const moveIn = validYmd(str(body.move_in_date)) ? str(body.move_in_date) : null;
  const notes = [str(body.notes), maxPrice > 0 ? `Budget up to ${maxPrice}` : '', !moveIn && str(body.move_in_date) ? `Move-in: ${str(body.move_in_date)}` : '']
    .filter(Boolean)
    .join('. ');
  const holdHours = Math.max(1, Number(prop.reservation_hold_hours) || 48);
  const expires = new Date(Date.now() + holdHours * 3600000);

  for (const bed of free.slice(0, 3)) {
    const ins = await sql(
      env,
      `INSERT INTO bed_reservations
         (id, property_id, bed_id, guest_name, guest_phone, move_in_date, status, source, notes, expires_at, created_at)
       SELECT ?, ?, ?, ?, ?, ?, 'pending', 'voice', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM bed_reservations
                         WHERE bed_id = ? AND status IN ('pending','confirmed')
                           AND (expires_at IS NULL OR expires_at > ?))
         AND EXISTS (SELECT 1 FROM beds WHERE id = ? AND occupied = 0)
       RETURNING id`,
      [newId(), prop.id, bed.bed_id, name, phone, moveIn, notes, expires.toISOString(), nowIso, bed.bed_id, nowIso, bed.bed_id]
    );
    if (ins.length) {
      return {
        ok: true,
        reserved: true,
        reservation_id: ins[0].id,
        pg: prop.name,
        room_no: bed.room_no,
        bed: bed.label,
        sharing: sharingName(bed.total_beds),
        price_per_bed_per_month: bed.price,
        held_until: fmtDateTimeIST(expires),
        message: `Bed held at ${prop.name}, room ${bed.room_no}, until ${fmtDateTimeIST(expires)} (IST). Tell the caller the team will confirm the booking and advance details. Do not promise anything else.`,
      };
    }
  }
  return { ok: false, message: 'That bed was just taken. Run check_beds again and offer another.' };
}

// ---------------------------------------------------------------- residents

async function findTenants(env, phone10) {
  return sql(
    env,
    `SELECT t.id, t.property_id, t.name, t.phone, t.rent_amount, t.deposit, t.move_in, t.due_day, t.leaving_on,
            p.name AS pg_name, r.room_no, b.label AS bed_label
     FROM tenants t
     JOIN properties p ON p.id = t.property_id
     LEFT JOIN beds b ON b.id = t.bed_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE t.status = 'active'
       AND (${dcol('t.phone')} LIKE ? OR ${dcol('t.whatsapp')} LIKE ?)`,
    ['%' + phone10, '%' + phone10]
  );
}

async function pickTenant(env, body) {
  const l = last10(body.caller_phone);
  if (l.length < 10) return { msg: "Ask the caller for their full 10-digit registered phone number." };
  let rows = await findTenants(env, l);
  if (rows.length > 1 && str(body.pg_name)) {
    const r = await resolvePg(env, body.pg_name);
    if (r.prop) {
      const f = rows.filter((x) => x.property_id === r.prop.id);
      if (f.length) rows = f;
    }
  }
  if (!rows.length) return { none: true };
  const pgs = [...new Set(rows.map((x) => x.property_id))];
  if (pgs.length > 1) {
    const names = [...new Set(rows.map((x) => `"${x.pg_name}"`))].join(' or ');
    return { msg: `This number is registered at more than one PG (${names}). Ask which PG the resident lives in and call again with pg_name.` };
  }
  return { tenant: rows[0] };
}

async function lookup_resident(env, body) {
  const p = await pickTenant(env, body);
  if (p.msg) return { ok: false, message: p.msg };
  if (p.none) {
    return { ok: true, found: false, message: 'No active resident found with that phone number. Ask the caller to confirm the number, or say the team will check.' };
  }
  const t = p.tenant;
  const month = todayIST().slice(0, 7);
  const paid = await sql(
    env,
    `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE tenant_id = ? AND for_month LIKE ?`,
    [t.id, month + '%']
  );
  const last = await sql(
    env,
    `SELECT amount, paid_on, for_month FROM payments WHERE tenant_id = ? ORDER BY paid_on DESC, created_at DESC LIMIT 1`,
    [t.id]
  );
  const paidTotal = (paid[0] && paid[0].total) || 0;
  const rent = t.rent_amount || 0;
  let status;
  if (rent > 0 && paidTotal >= rent) status = 'paid';
  else if (paidTotal > 0) status = 'partially paid';
  else status = 'not paid yet';

  const dueDate = `${month}-${String(t.due_day).padStart(2, '0')}`;
  const overdue = status !== 'paid' && todayIST() > dueDate;

  return {
    ok: true,
    found: true,
    name: t.name,
    pg: t.pg_name,
    room_no: t.room_no || null,
    bed: t.bed_label || null,
    monthly_rent: rent,
    due_day_of_month: t.due_day,
    this_month_status: status,
    this_month_paid_amount: paidTotal,
    overdue,
    last_payment: last[0] ? { amount: last[0].amount, paid_on: last[0].paid_on, for_month: last[0].for_month } : null,
    planned_leaving_on: t.leaving_on || null,
    message: 'Read this back naturally. For older dues or exact balances, say the CK Co-Live team will confirm.',
  };
}

async function report_leaving(env, body) {
  const date = str(body.leaving_date);
  if (!validYmd(date)) return { ok: false, message: 'The leaving date must be YYYY-MM-DD. Confirm the date with the resident.' };
  if (date < todayIST()) return { ok: false, message: 'That date has already passed. Confirm the leaving date with the resident.' };

  const p = await pickTenant(env, body);
  if (p.msg) return { ok: false, message: p.msg };
  if (p.none) return { ok: true, found: false, message: 'No active resident found with that phone number. Ask the caller to confirm the number.' };
  const t = p.tenant;

  if (t.leaving_on === date) {
    return { ok: true, already_recorded: true, message: `The leaving date ${fmtDay(date)} is already recorded. Confirm it to the resident.` };
  }
  await sql(env, `UPDATE tenants SET leaving_on = ? WHERE id = ?`, [date, t.id]);
  await sql(
    env,
    `INSERT INTO complaints (id, property_id, tenant_name, message, category, priority, kind, status, caller_phone, created_at)
     VALUES (?, ?, ?, ?, 'Leaving', 'medium', 'request', 'open', ?, ?)`,
    [newId(), t.property_id, t.name, `Resident plans to leave on ${date}${t.room_no ? ` (Room ${t.room_no})` : ''}. Reported by phone.`, str(body.caller_phone), nowUtc()]
  );
  return {
    ok: true,
    recorded: true,
    name: t.name,
    pg: t.pg_name,
    leaving_on: date,
    message: `Leaving date ${fmtDay(date)} recorded and the team is informed. Do not discuss deposit refunds; say the team will contact them.`,
  };
}

// ---------------------------------------------------------------- complaints

async function log_complaint(env, body) {
  const phone = str(body.caller_phone);
  let propertyId = null;
  let pgName = '';

  const r = await resolvePg(env, body.pg_name);
  if (r.prop) {
    propertyId = r.prop.id;
    pgName = r.prop.name;
  } else if (last10(phone).length === 10) {
    const rows = await findTenants(env, last10(phone));
    const pgs = [...new Set(rows.map((x) => x.property_id))];
    if (pgs.length === 1) {
      propertyId = pgs[0];
      pgName = rows[0].pg_name;
    }
  }
  if (!propertyId) return { ok: false, needs_pg: true, message: r.ask || 'Ask the caller which PG they mean, then call again.' };

  const summary = str(body.summary);
  const name = str(body.caller_name) || 'Unknown caller';
  if (!summary) return { ok: false, message: 'Need a short description of the issue. Ask the caller.' };

  const kind = ['request', 'query', 'complaint'].includes(str(body.kind)) ? str(body.kind) : 'complaint';
  const priority = ['low', 'medium', 'high'].includes(str(body.urgency)) ? str(body.urgency) : 'medium';
  const room = str(body.room_number);
  const message = room ? `${summary} (Room ${room})` : summary;
  const category = str(body.category) || 'General';

  // avoid duplicate logs of the same thing from the same caller in the last 15 minutes
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const dup = await sql(
    env,
    `SELECT id FROM complaints WHERE property_id = ? AND message = ? AND COALESCE(caller_phone,'') = ? AND created_at > ? LIMIT 1`,
    [propertyId, message, phone, since]
  );
  if (dup.length) {
    return { ok: true, already_logged: true, message: 'This was already logged a moment ago. Tell the caller the team has it.' };
  }

  const ins = await sql(
    env,
    `INSERT INTO complaints (id, property_id, tenant_name, message, category, priority, kind, status, caller_phone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?) RETURNING id`,
    [newId(), propertyId, name, message, category, priority, kind, phone || null, nowUtc()]
  );
  return {
    ok: true,
    logged: true,
    id: ins[0] && ins[0].id,
    pg: pgName,
    priority,
    kind,
    message: `Logged for the CK Co-Live team (${priority} priority). Do not promise a fix time.`,
  };
}

const STATUS_WORDS = {
  open: 'open: the team has received it',
  in_progress: 'in progress: the team is working on it',
  resolved: 'resolved',
};

async function check_complaint_status(env, body) {
  const l = last10(body.caller_phone);
  if (l.length < 10) return { ok: false, message: 'Ask the caller for their full 10-digit registered phone number.' };

  const tenants = await findTenants(env, l);
  const names = [...new Set(tenants.map((t) => str(t.name).toLowerCase()).filter(Boolean))];
  const pids = [...new Set(tenants.map((t) => t.property_id))];

  let sqlText = `SELECT c.message, c.category, c.priority, c.kind, c.status, c.created_at, p.name AS pg_name
                 FROM complaints c JOIN properties p ON p.id = c.property_id
                 WHERE (${dcol("COALESCE(c.caller_phone,'')")} LIKE ?`;
  const args = ['%' + l];
  if (names.length && pids.length) {
    sqlText += ` OR (c.property_id IN (${pids.map(() => '?').join(',')}) AND lower(c.tenant_name) IN (${names.map(() => '?').join(',')}))`;
    args.push(...pids, ...names);
  }
  sqlText += `) ORDER BY c.created_at DESC LIMIT 5`;
  const rows = await sql(env, sqlText, args);

  if (!rows.length) {
    return { ok: true, found: false, message: 'No complaint or request found for this number. Offer to log it as a new complaint.' };
  }
  return {
    ok: true,
    found: true,
    complaints: rows.map((c) => ({
      issue: str(c.message).slice(0, 140),
      category: c.category,
      status: STATUS_WORDS[c.status] || c.status,
      raised_on: str(c.created_at).slice(0, 10),
    })),
    message: 'Tell the caller the status in plain words. Never promise a fix time. Do not log a duplicate just because they asked for an update.',
  };
}
