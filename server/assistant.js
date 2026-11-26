// AI Assistant: runs on Cloudflare Pages (same place as the rest of the API). The key never reaches the browser.
// Secrets (Cloudflare > Pages > your project > Settings > Variables and Secrets):
//   GEMINI_API_KEY   free key from https://aistudio.google.com/apikey   (enough on its own)
//   GROQ_API_KEY     optional second choice, used only if Gemini is missing or fails
// Optional: GEMINI_MODEL (default gemini-3.8-flash), GROQ_MODEL (default llama-3.3-70b-versatile)

const SYSTEM =
  'You are StayManager AI, a friendly assistant for a PG (paying guest accommodation) owner in India. ' +
  'You can chat normally (greetings, "how are you", general questions) and you answer questions about the PG using ONLY the JSON data provided. ' +
  'Be brief and practical. Plain text, short lines, ₹ for money. ' +
  'If the data does not contain the answer, say so instead of guessing. Do not invent tenants, rooms or numbers.'

const prompt = (question, context) =>
  `PG data (JSON):\n${JSON.stringify(context ?? {}).slice(0, 60000)}\n\nOwner's question: ${question}`

async function readJson(res) {
  try { return await res.json() } catch { return {} }
}

// Gemini 3.x uses thinkingLevel (and wants no temperature); 2.5 uses thinkingBudget. Thinking is kept minimal: this is a simple lookup task.
function genConfig(model) {
  if (/gemini-3/.test(model)) return { maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: 'low' } }
  if (/gemini-2\.5/.test(model)) return { maxOutputTokens: 1200, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } }
  return { maxOutputTokens: 1200, temperature: 0.3 }
}

async function gemini(env, question, context, model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt(question, context) }] }],
      generationConfig: genConfig(model),
    }),
  })
  const json = await readJson(res)
  if (!res.ok) throw Object.assign(new Error(`Gemini (${model}): ${json?.error?.message || res.status}`), { status: res.status })
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n').trim()
  if (!text) throw new Error('Gemini returned an empty answer')
  return text
}

// Google's newest model can be briefly overloaded (503/429), so: retry once, then fall back to the previous Gemini model.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function geminiWithFallback(env, question, context) {
  const models = [...new Set([env.GEMINI_MODEL || 'gemini-3.8-flash', 'gemini-3.7-flash'])]
  let last
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await gemini(env, question, context, model) } catch (e) {
        last = e
        const busy = e.status === 503 || e.status === 429 || e.status === 500
        if (!busy) break // wrong model / bad key: retrying will not help, try the next model
        if (attempt === 0) await sleep(1200)
      }
    }
  }
  throw last
}

async function groq(env, question, context) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      max_tokens: 1000,
      temperature: 0.3,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt(question, context) }],
    }),
  })
  const json = await readJson(res)
  if (!res.ok) throw new Error(`Groq: ${json?.error?.message || res.status}`)
  const text = (json.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('Groq returned an empty answer')
  return text
}

// Returns { ai: true, answer } or { ai: false, reason } (never throws, so the app can fall back to its built-in answers).
export async function assistantRoute({ env, body }) {
  const question = String(body?.question ?? '').trim().slice(0, 1000)
  if (!question) return { ai: false, reason: 'Please type a question.' }
  if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
    return { ai: false, reason: 'The AI is not switched on yet: GEMINI_API_KEY is missing on the server. Add it in Cloudflare > Pages > Settings > Variables and Secrets, then redeploy.' }
  }
  const errors = []
  for (const [name, key, fn] of [['Gemini', env.GEMINI_API_KEY, geminiWithFallback], ['Groq', env.GROQ_API_KEY, groq]]) {
    if (!key) continue
    try { return { ai: true, answer: await fn(env, question, body?.context) } } catch (e) { errors.push(String(e?.message || e)); console.error(name, e?.message || e) }
  }
  return { ai: false, reason: `The AI service returned an error. ${errors.join(' | ')}` }
}
