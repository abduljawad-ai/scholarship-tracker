// Cloudflare Workers AI: account-scoped endpoint. Used only when the owner
// configures an explicit model, because free catalog ids change.
import { ProviderRequestError, postJson, type FetchLike } from "../http"
import type { AiRequest, Provider, ProviderSettings } from "../types"

export function createCloudflareProvider(
  settings: ProviderSettings,
  fetchImpl?: FetchLike,
): Provider {
  if (!settings.accountId) {
    throw new ProviderRequestError("Cloudflare provider requires CLOUDFLARE_ACCOUNT_ID")
  }

  return {
    id: "cloudflare",
    model: settings.model,
    async complete(request: AiRequest, signal: AbortSignal): Promise<string> {
      const url = `https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/ai/run/${settings.model}`

      const body = (await postJson(
        url,
        {
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
        },
        { headers: { authorization: `Bearer ${settings.apiKey}` }, signal, fetchImpl },
      )) as { result?: { response?: unknown } }

      const text = body.result?.response
      if (typeof text !== "string" || text.length === 0) {
        throw new ProviderRequestError("Cloudflare returned no result.response")
      }
      return text
    },
  }
}
