Copy these 4 files into your project (same folders, replace existing):
  server/assistant.js        (new)
  server/handler.js          (adds the /api/assistant route)
  src/lib/api.js             (adds askAssistant)
  src/components/Assistant.jsx (calls the new route, sends tenant names)

Then in Cloudflare: Pages > your project > Settings > Variables and Secrets
add GEMINI_API_KEY as a Secret (Production). Push to Git so it redeploys.
