// OpenRouter: optional overflow provider. Attribution headers are required by
// their terms. No response_format here, because free models vary in support.
import { ProviderRequestError, postJson, type FetchLike } from "../http"
import type { AiRequest, Provider, ProviderSettings } from "../types"

const REFERER = "https://scholarships-pk.pages.dev"
const TITLE = "Scholarship Tracker"

export function createOpenRouterProvider(
  settings: ProviderSettings,
  fetchImpl?: FetchLike,
): Provider {
  return {
    id: "openrouter",
    model: settings.model,
    async complete(request: AiRequest, signal: AbortSignal): Promise<string> {
      const body = (await postJson(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: settings.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
        },
        {
          headers: {
            authorization: `Bearer ${settings.apiKey}`,
            "HTTP-Referer": REFERER,
            "X-Title": TITLE,
          },
          signal,
          fetchImpl,
        },
      )) as { choices?: { message?: { content?: unknown } }[] }

      const content = body.choices?.[0]?.message?.content
      if (typeof content !== "string" || content.length === 0) {
        throw new ProviderRequestError("OpenRouter returned no message content")
      }
      return content
    },
  }
}
