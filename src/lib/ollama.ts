const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'

/** Embed a single string with the given model. Returns the raw vector. */
export async function embed(text: string, model: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  })
  if (!res.ok) {
    throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { embeddings: number[][] }
  return data.embeddings[0]
}

/**
 * Resolve a stable provenance identifier for a model: its content digest, via /api/tags.
 * Matches by exact name or the ':latest' suffix. NOTE: a model pulled under an explicit tag
 * (e.g. 'nomic-embed-text:v1.5') must be passed with that full tag, or this throws.
 */
export async function getModelDigest(model: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' })
  if (!res.ok) {
    throw new Error(`Ollama tags failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { models: { name: string; digest: string }[] }
  const match = data.models.find((m) => m.name === model || m.name === `${model}:latest`)
  if (!match) {
    throw new Error(`Model not found in Ollama: ${model}`)
  }
  return match.digest
}
