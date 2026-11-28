// Provider factory. The router builds only the providers that have keys.
import type { FetchLike } from "../http"
import type { Provider, ProviderId, ProviderSettings } from "../types"
import { createCloudflareProvider } from "./cloudflare"
import { createGeminiProvider } from "./gemini"
import { createGroqProvider } from "./groq"
import { createOpenRouterProvider } from "./openrouter"

export function createProvider(
  id: ProviderId,
  settings: ProviderSettings,
  fetchImpl?: FetchLike,
): Provider {
  switch (id) {
    case "gemini":
      return createGeminiProvider(settings, fetchImpl)
    case "groq":
      return createGroqProvider(settings, fetchImpl)
    case "cloudflare":
      return createCloudflareProvider(settings, fetchImpl)
    case "openrouter":
      return createOpenRouterProvider(settings, fetchImpl)
  }
}
