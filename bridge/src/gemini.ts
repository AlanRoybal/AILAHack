import { config } from './config.ts'

interface Turn {
  role: 'user' | 'model'
  text: string
}

/** One JSON-mode Gemini call with minimal thinking: about 0.6-1 s on flash models. */
export async function geminiJson<T>(model: string, system: string, turns: Turn[] | string, signal?: AbortSignal): Promise<T> {
  const contents = (typeof turns === 'string' ? [{ role: 'user' as const, text: turns }] : turns).map(t => ({ role: t.role, parts: [{ text: t.text }] }))
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } },
    }),
  })
  if (!res.ok) throw new Error(`gemini ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = body.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T
}
