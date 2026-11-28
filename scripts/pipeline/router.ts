// Quota-aware router. It walks the configured order for a task, skips
// excluded, cooling, or over-cap providers, records every successful call, and
// cools a provider down after a quota or auth failure. A paused run is the
// normal outcome when every provider is exhausted, not a crash.
import { todayInPakistan } from "../../src/lib/cycle-status"
import { ProviderAuthError, ProviderQuotaError, type FetchLike } from "./http"
import { createProvider } from "./providers"
import {
  callsOn,
  providerReady,
  recordProviderCall,
  setProviderCooldown,
  type StateStore,
} from "./state"
import type {
  AiRequest,
  AiResponse,
  PipelineConfig,
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
  store: StateStore
  fetchImpl?: FetchLike
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_QUOTA_COOLDOWN_MS = 15 * 60_000
const AUTH_COOLDOWN_MS = 24 * 60 * 60_000
// A per-minute token limit clears quickly. Wait it out in place instead of
// cooling the provider down for fifteen minutes and pausing the whole run.
const INLINE_RETRY_MAX_MS = 30_000
const INLINE_RETRY_ATTEMPTS = 2

export function createRouter(deps: RouterDeps): Router {
  const {
    config,
    store,
    fetchImpl,
    now = () => new Date(),
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = deps

  const providers: Partial<Record<ProviderId, Provider>> = {}
  for (const id of Object.keys(config.providers) as ProviderId[]) {
    const settings = config.providers[id]
    if (settings) providers[id] = createProvider(id, settings, fetchImpl)
  }

  function ready(id: ProviderId, date: Date): boolean {
    if (!providers[id]) return false
    const state = store.get()
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
          let retries = 0

          for (;;) {
            try {
              const text = await provider.complete(
                request,
                AbortSignal.timeout(config.requestTimeoutMs),
              )

              store.set(recordProviderCall(store.get(), id, todayInPakistan(date)))
              return { text, providerId: id, model: provider.model }
            } catch (err) {
              const wait = err instanceof ProviderQuotaError ? err.retryAfterMs : null
              if (
                wait !== null &&
                wait <= INLINE_RETRY_MAX_MS &&
                retries < INLINE_RETRY_ATTEMPTS
              ) {
                retries += 1
                await sleep(wait + 250)
                continue
              }
              throw err
            }
          }
        } catch (err) {
          if (err instanceof ProviderQuotaError) {
            const until = new Date(
              date.getTime() + (err.retryAfterMs ?? DEFAULT_QUOTA_COOLDOWN_MS),
            ).toISOString()
            store.set(
              setProviderCooldown(store.get(), id, until, err.message),
            )
            lastError = err
            continue
          }

          if (err instanceof ProviderAuthError) {
            const until = new Date(date.getTime() + AUTH_COOLDOWN_MS).toISOString()
            store.set(
              setProviderCooldown(store.get(), id, until, err.message),
            )
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
