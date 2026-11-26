// AI Assistant: answers owner questions about their PG using a FREE language model.
// Runs inside the Cloudflare Pages Function, so the API key never reaches the browser.
//
// Set ONE or BOTH of these as Secrets in Cloudflare > Pages > Settings > Variables and Secrets:
//   GEMINI_API_KEY   free key from https://aistudio.google.com/apikey   (tried first)
//   GROQ_API_KEY     free key from https://console.groq.com/keys        (used if Gemini fails or is rate limited)
// Optional: GEMINI_MODEL (default gemini-2.5-flash), GROQ_MODEL (default llama-3.3-70b-versatile)

import { HttpError } from './errors.js'

const MAX_CONTEXT_CHARS = 60000
const MAX_HISTORY = 8
const TIMEOUT_MS = 25000

const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)

function systemPrompt(context) {
  let data = JSON.stringify(context ?? {})
  if (data.length > MAX_CONTEXT_CHARS) data = data.slice(0, MAX_CONTEXT_CHARS) + '…(data truncated)'
  return [
    'You are StayManager AI, a smart, friendly assistant for the owner of a PG (paying guest hostel) in India.',
    `Today is ${todayIST()}. Money is in Indian rupees: write it as ₹ with Indian digit grouping (₹12,500).`,
    '',
    'RULES',
    '- Answer ONLY from the PG data below. Never invent tenants, rooms, amounts or dates.',
    '- If the data does not contain the answer, say so plainly and say what is missing.',
    '- Count and add carefully. For lists, give names and room numbers so the owner can act on it.',
    '- Understand loose, misspelled or Hinglish questions ("kitne bed khali hai", "kon rent nahi diya").',
    '- Answer the question that was asked first, in 1-2 short sentences, then add details as short lines starting with "• ".',
    '- Plain text only: no markdown, no asterisks, no tables, no headings. Keep it under about 150 words.',
    '- You can suggest what to do next (for example whom to remind about rent), but you cannot change any data yourself.',
    '- Reply in the language the owner wrote in (English, Hindi, Hinglish, Malayalam, Tamil, etc.).',
    '',
    'DATA NOTES',
    '- rooms[].beds shows each bed: "occupied" true/false; vacant beds are the ones with occupied false.',
    '- tenants[] are current tenants. rent_due is what they still owe in total; unpaid_months is how many months are unpaid; rent_status is paid, due (not late yet) or overdue.',
    '- complaints[] have status open, in_progress or resolved. calls[] are AI voice-agent call logs with an intent.',
    '',
    'PG DATA (JSON):',
    data,
  ].join('\n')
}

async function postJson(url, headers, body, label) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new Error(`${label} did not respond in time`)
  }
  let json = null
  try { json = await res.json() } catch { /* empty */ }
  if (!res.ok) throw new Error(`${label}: ${json?.error?.message || res.status}`)
  return json
}

async function askGemini({ key, model, system, history, question }) {
  const contents = [...history.map((m) => ({ role: m.from === 'me' ? 'user' : 'model', parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: question }] }]
  const generationConfig = { maxOutputTokens: 1024, temperature: 0.2 }
  // gemini-2.5 "thinking" tokens eat the output budget and can cut answers short; this is a simple lookup task, so turn it off
  if (/2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 }
  const json = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig },
    'Gemini'
  )
  const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim()
  if (!text) throw new Error('Gemini returned an empty answer')
  return text
}

async function askGroq({ key, model, system, history, question }) {
  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text })),
    { role: 'user', content: question },
  ]
  const json = await postJson(
    'https://api.groq.com/openai/v1/chat/completions',
    { authorization: `Bearer ${key}` },
    { model, messages, max_tokens: 1024, temperature: 0.2 },
    'Groq'
  )
  const text = (json?.choices?.[0]?.message?.content || '').trim()
  if (!text) throw new Error('Groq returned an empty answer')
  return text
}

// Keep the last few turns so follow-ups like "and on floor 2?" make sense.
function cleanHistory(raw) {
  if (!Array.isArray(raw)) return []
  const turns = raw
    .filter((m) => m && (m.from === 'me' || m.from === 'bot') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ from: m.from, text: m.text.trim().slice(0, 700) }))
    .slice(-MAX_HISTORY)
  while (turns.length && turns[0].from !== 'me') turns.shift() // models want the conversation to start with the user
  const merged = [] // and to alternate roles
  for (const t of turns) {
    if (merged.length && merged[merged.length - 1].from === t.from) merged[merged.length - 1] = t
    else merged.push(t)
  }
  if (merged.length && merged[merged.length - 1].from === 'me') merged.pop() // the new question follows
  return merged
}

export async function askAssistant({ env, body }) {
  const question = String(body?.question || '').trim().slice(0, 1000)
  if (!question) throw new HttpError(400, 'Please type a question.')

  const args = { system: systemPrompt(body?.context), history: cleanHistory(body?.history), question }
  const providers = []
  if (env.GEMINI_API_KEY) providers.push(() => askGemini({ key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', ...args }))
  if (env.GROQ_API_KEY) providers.push(() => askGroq({ key: env.GROQ_API_KEY, model: env.GROQ_MODEL || 'llama-3.3-70b-versatile', ...args }))
  if (!providers.length) throw new HttpError(503, 'The AI is not switched on yet. Add GEMINI_API_KEY (free) in Cloudflare settings.', 'no_ai_key')

  let lastError = ''
  for (const run of providers) {
    try {
      return { answer: await run() }
    } catch (e) {
      lastError = String(e?.message || e)
      console.error('Assistant provider failed:', lastError)
    }
  }
  throw new HttpError(502, 'The AI service is busy right now. Please try again in a moment.', 'ai_unavailable')
}
