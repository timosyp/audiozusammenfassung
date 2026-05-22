// Vercel Edge Function: Audio → Transkript → 3 Zusammenfassungen
// Verwendet die kostenlose Groq-API (Whisper Large v3 + Llama 3.3 70B).

export const config = {
  runtime: "edge",
};

const GROQ_BASE = "https://api.groq.com/openai/v1";
const TRANSCRIPTION_MODEL = "whisper-large-v3";
const SUMMARY_MODEL = "llama-3.3-70b-versatile";

const SUMMARY_SYSTEM_PROMPT = `Du erhältst das Transkript einer gesprochenen Nachricht (z. B. WhatsApp-Sprachnachricht oder Apple-Watch-Aufnahme).

Erstelle drei verschieden tiefe Zusammenfassungen.

REGELN:
- Sprache: dieselbe Sprache wie das Transkript (typischerweise Deutsch).
- Schreibe klar, sachlich, ohne Füllwörter und Floskeln.
- Bleibe streng beim Inhalt — keine Interpretation, keine Spekulation, keine Erfindungen.
- Wenn das Transkript sehr kurz oder unklar ist: ehrlich kurz halten, nicht künstlich strecken.

ANTWORTFORMAT: Gib AUSSCHLIESSLICH ein JSON-Objekt zurück mit genau diesen Schlüsseln:

{
  "detailed": "Ein zusammenhängender Fließtext mit 4–7 Sätzen. Erfasst alle relevanten Aussagen, Kontext und konkrete Handlungspunkte, sofern vorhanden.",
  "compact": "Maximal 2–3 prägnante Sätze. Das Wichtigste in einem Atemzug.",
  "bullets": ["Stichpunkt 1", "Stichpunkt 2", "Stichpunkt 3"]
}

bullets enthält MAXIMAL 3 Einträge — gerne weniger, falls nicht mehr Kerngedanken vorhanden sind.
Jeder Stichpunkt ist ein knapper Halbsatz oder Satz, max. ~12 Wörter, OHNE Aufzählungszeichen am Anfang.`;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function transcribe(audioFile, apiKey) {
  const fd = new FormData();
  fd.append("file", audioFile, audioFile.name || "audio");
  fd.append("model", TRANSCRIPTION_MODEL);
  fd.append("response_format", "json");
  // Sprachhinweis verbessert Erkennung bei kurzen Aufnahmen
  fd.append("language", "de");
  fd.append("temperature", "0");

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: fd,
  });

  if (!res.ok) {
    const text = await safeText(res);
    throw new ApiError(
      `Transkription fehlgeschlagen (HTTP ${res.status}). ${cleanGroqError(text)}`,
      res.status === 401 ? 401 : 502
    );
  }

  const data = await res.json();
  const transcript = (data.text || "").trim();
  if (!transcript) {
    throw new ApiError("Es wurde keine gesprochene Sprache im Audio erkannt.", 422);
  }
  return transcript;
}

async function summarize(transcript, apiKey) {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Transkript:\n\n"""\n${transcript}\n"""\n\nGib jetzt das JSON zurück.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await safeText(res);
    throw new ApiError(
      `Zusammenfassung fehlgeschlagen (HTTP ${res.status}). ${cleanGroqError(text)}`,
      502
    );
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Manchmal kommt JSON in einem Markdown-Block — robust extrahieren.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new ApiError("Modellantwort konnte nicht gelesen werden.", 502);
    parsed = JSON.parse(match[0]);
  }

  const detailed = typeof parsed.detailed === "string" ? parsed.detailed.trim() : "";
  const compact = typeof parsed.compact === "string" ? parsed.compact.trim() : "";
  const bulletsRaw = Array.isArray(parsed.bullets) ? parsed.bullets : [];
  const bullets = bulletsRaw
    .map((b) => String(b).trim().replace(/^[-•·*]\s*/, ""))
    .filter(Boolean)
    .slice(0, 3);

  if (!detailed && !compact && bullets.length === 0) {
    throw new ApiError("Die Zusammenfassung war leer.", 502);
  }

  return { detailed, compact, bullets };
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function cleanGroqError(text) {
  if (!text) return "";
  try {
    const j = JSON.parse(text);
    return j?.error?.message || j?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Nur POST." }, 405);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          "Server ist nicht konfiguriert: GROQ_API_KEY fehlt. Lege ihn in den Vercel-Projekteinstellungen unter „Environment Variables“ an.",
      },
      500
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return jsonResponse({ error: "Die Datei konnte nicht gelesen werden." }, 400);
  }

  const audio = formData.get("audio");
  if (!audio || typeof audio === "string") {
    return jsonResponse({ error: "Es wurde keine Audio-Datei gefunden." }, 400);
  }

  // Vercel-Limit kommunizieren (Hobby ~ 4.5 MB)
  const MAX_BYTES = 25 * 1024 * 1024; // Groq limit
  if (audio.size > MAX_BYTES) {
    return jsonResponse(
      {
        error: `Die Datei ist zu groß (${(audio.size / 1024 / 1024).toFixed(
          1
        )} MB). Maximum: 25 MB.`,
      },
      413
    );
  }

  try {
    const transcript = await transcribe(audio, apiKey);
    const summary = await summarize(transcript, apiKey);
    return jsonResponse({
      transcript,
      ...summary,
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err?.message || "Unbekannter Fehler.";
    return jsonResponse({ error: message }, status);
  }
}
