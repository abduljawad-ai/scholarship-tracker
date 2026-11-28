// Gemini: generateContent with a JSON response MIME type. Free tier is used
// for long pages and second-model verification.
import { ProviderRequestError, postJson, type FetchLike } from "../http"
import type { AiRequest, Provider, ProviderSettings } from "../types"

export function createGeminiProvider(
  settings: ProviderSettings,
  fetchImpl?: FetchLike,
): Provider {
  return {
    id: "gemini",
    model: settings.model,
    async complete(request: AiRequest, signal: AbortSignal): Promise<string> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent`

      const body = (await postJson(
        url,
        {
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            responseMimeType: "application/json",
          },
        },
        { headers: { "x-goog-api-key": settings.apiKey }, signal, fetchImpl },
      )) as {
        candidates?: { content?: { parts?: { text?: unknown }[] } }[]
      }

      const text = body.candidates?.[0]?.content?.parts?.[0]?.text
      if (typeof text !== "string" || text.length === 0) {
        throw new ProviderRequestError("Gemini returned no candidate text")
      }
      return text
    },
  }
}
