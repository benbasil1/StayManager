// Powers the AI Assistant tab with a real language model. The API key stays on the server.
// Pick ONE provider by setting its secret (free options first):
//   Google Gemini (free tier):  supabase secrets set GEMINI_API_KEY=...     (key: https://aistudio.google.com/apikey)
//   Groq (free tier):           supabase secrets set GROQ_API_KEY=...       (key: https://console.groq.com/keys)
//   Claude (paid):              supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Deploy:  supabase functions deploy assistant      Then set VITE_USE_AI_FUNCTION=true in .env.local
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM =
  'You are StayManager AI, an assistant for a PG (paying guest accommodation) owner in India. ' +
  'Answer ONLY from the JSON data provided. Be brief and practical. Use plain text, short lines, and ₹ for money. ' +
  'If the data does not contain the answer, say so.'

type Ctx = { question: string; context: unknown }
const prompt = ({ question, context }: Ctx) => `PG data (JSON):\n${JSON.stringify(context)}\n\nQuestion: ${question}`
const env = (k: string) => Deno.env.get(k) ?? ''

async function gemini(c: Ctx) {
  const model = env('GEMINI_MODEL') || 'gemini-2.5-flash'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt(c) }] }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.3 },
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Gemini request failed')
  return (json.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('\n')
}

async function groq(c: Ctx) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env('GROQ_API_KEY')}` },
    body: JSON.stringify({
      model: env('GROQ_MODEL') || 'llama-3.3-70b-versatile',
      max_tokens: 800,
      temperature: 0.3,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt(c) }],
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Groq request failed')
  return json.choices?.[0]?.message?.content ?? ''
}

async function claude(c: Ctx) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5',
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt(c) }],
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'AI request failed')
  return (json.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json()
    const c: Ctx = { question: String(body.question ?? '').slice(0, 1000), context: body.context }
    let answer: string
    if (env('GEMINI_API_KEY')) answer = await gemini(c)
    else if (env('GROQ_API_KEY')) answer = await groq(c)
    else if (env('ANTHROPIC_API_KEY')) answer = await claude(c)
    else throw new Error('No AI key set. Run: supabase secrets set GEMINI_API_KEY=...')
    return new Response(JSON.stringify({ answer: answer.trim() }), { headers: { ...cors, 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...cors, 'content-type': 'application/json' },
    })
  }
})
