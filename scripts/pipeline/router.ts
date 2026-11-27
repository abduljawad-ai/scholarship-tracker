// Quota-aware router. It walks the configured order for a task, skips
// excluded, cooling, or over-cap providers, records every successful call, and
// cools a provider down after a quota or auth failure. A paused run is the
// normal outcome when every provider is exhausted, not a crash.
import { todayInPakistan } from "../../src/lib/cycle-status"
import { ProviderAuthError, ProviderQuotaError, type FetchLike } from "./http"
import { createProvider } from "./providers"
import { callsOn, providerReady, recordProviderCall, setProviderCooldown } from "./state"
import type {
  AiRequest,
  AiResponse,
  PipelineConfig,
  PipelineState,
  Provider,
  ProviderId,
  Router,
} from "./types"

export class ProvidersExhaustedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProvidersExhaustedError"
  }
}

export interface RouterDeps {
  config: PipelineConfig
  state: PipelineState
  /** Persist the updated state (usage counts, cooldowns) exactly when it changes. */
  persist: (state: PipelineState) => void
  fetchImpl?: FetchLike
  now?: () => Date
}

const DEFAULT_QUOTA_COOLDOWN_MS = 15 * 60_000
const AUTH_COOLDOWN_MS = 24 * 60 * 60_000

export function createRouter(deps: RouterDeps): Router {
  const { config, persist, fetchImpl, now = () => new Date() } = deps
  let state = deps.state

  const providers: Partial<Record<ProviderId, Provider>> = {}
  for (const id of Object.keys(config.providers) as ProviderId[]) {
    const settings = config.providers[id]
    if (settings) providers[id] = createProvider(id, settings, fetchImpl)
  }

  function ready(id: ProviderId, date: Date): boolean {
    if (!providers[id]) return false
    if (!providerReady(state, id, date)) return false
    return callsOn(state, todayInPakistan(date)) < config.dailyCallLimit
  }

  return {
    available(task, exclude = []) {
      const date = now()
      return config.routing[task].filter((id) => !exclude.includes(id) && ready(id, date))
    },

    async complete(request: AiRequest, options = {}): Promise<AiResponse> {
      const exclude = options.exclude ?? []
      let lastError: Error | null = null

      for (const id of config.routing[request.task]) {
        if (exclude.includes(id)) continue
        if (!providers[id]) continue

        const date = now()
        if (!ready(id, date)) continue

        try {
          const provider = providers[id]!
          const text = await provider.complete(
            request,
            AbortSignal.timeout(config.requestTimeoutMs),
          )

          state = recordProviderCall(state, id, todayInPakistan(date))
          persist(state)
          return { text, providerId: id, model: provider.model }
        } catch (err) {
          if (err instanceof ProviderQuotaError) {
            const until = new Date(
              date.getTime() + (err.retryAfterMs ?? DEFAULT_QUOTA_COOLDOWN_MS),
            ).toISOString()
            state = setProviderCooldown(state, id, until, err.message)
            persist(state)
            lastError = err
            continue
          }

          if (err instanceof ProviderAuthError) {
            const until = new Date(date.getTime() + AUTH_COOLDOWN_MS).toISOString()
            state = setProviderCooldown(state, id, until, err.message)
            persist(state)
            lastError = err
            continue
          }

          // Network and server errors are transient: try the next provider
          // without disabling this one for the rest of the day.
          lastError = err instanceof Error ? err : new Error(String(err))
        }
      }

      throw new ProvidersExhaustedError(lastError?.message ?? "No AI provider is available")
    },
  }
}
