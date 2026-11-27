// Groq: OpenAI-compatible chat completions with JSON mode. Free tier is the
// high-volume extraction workhorse.
import { ProviderRequestError, postJson, type FetchLike } from "../http"
import type { AiRequest, Provider, ProviderSettings } from "../types"

export function createGroqProvider(
  settings: ProviderSettings,
  fetchImpl?: FetchLike,
): Provider {
  return {
    id: "groq",
    model: settings.model,
    async complete(request: AiRequest, signal: AbortSignal): Promise<string> {
      const body = (await postJson(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: settings.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          response_format: { type: "json_object" },
        },
        { headers: { authorization: `Bearer ${settings.apiKey}` }, signal, fetchImpl },
      )) as { choices?: { message?: { content?: unknown } }[] }

      const content = body.choices?.[0]?.message?.content
      if (typeof content !== "string" || content.length === 0) {
        throw new ProviderRequestError("Groq returned no message content")
      }
      return content
    },
  }
}
