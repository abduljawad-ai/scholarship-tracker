// Quota-aware router. It walks the configured order for a task, skips
// excluded, cooling, or over-cap providers, records every successful call, and
// cools a provider down after a quota or auth failure. A paused run is the
// normal outcome when every provider is exhausted, not a crash.
import { todayInPakistan } from "../../src/lib/cycle-status"
import { ProviderAuthError, ProviderQuotaError, type FetchLike } from "./http"
import { createProvider } from "./providers"
import {
  callsOn,
  keyReady,
  recordProviderCall,
  setKeyCooldown,
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

interface ProviderKeyInstance {
  label: string
  provider: Provider
}

export function createRouter(deps: RouterDeps): Router {
  const {
    config,
    store,
    fetchImpl,
    now = () => new Date(),
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = deps

  const keyPools: Partial<Record<ProviderId, ProviderKeyInstance[]>> = {}
  const rotationIndex: Partial<Record<ProviderId, number>> = {}

  for (const id of Object.keys(config.providers) as ProviderId[]) {
    const settings = config.providers[id]
    if (!settings) continue

    const keys =
      settings.keys && settings.keys.length > 0
        ? settings.keys
        : [{ label: `${id}:1`, apiKey: settings.apiKey }]

    keyPools[id] = keys.map((key) => ({
      label: key.label,
      provider: createProvider(id, { ...settings, apiKey: key.apiKey }, fetchImpl),
    }))
    rotationIndex[id] = 0
  }

  let timeShift = 0
  function currentTime(): Date {
    return new Date(now().getTime() + timeShift)
  }

  function ready(id: ProviderId, date: Date): boolean {
    const pool = keyPools[id]
    if (!pool || pool.length === 0) return false
    const state = store.get()
    const hasReadyKey = pool.some((k) => keyReady(state, id, k.label, date, pool.length > 1))
    if (!hasReadyKey) return false
    return callsOn(state, todayInPakistan(date)) < config.dailyCallLimit
  }

  return {
    available(task, exclude = []) {
      const date = currentTime()
      return config.routing[task].filter((id) => !exclude.includes(id) && ready(id, date))
    },

    async complete(request: AiRequest, options = {}): Promise<AiResponse> {
      const exclude = options.exclude ?? []
      let lastError: Error | null = null

      for (const id of config.routing[request.task]) {
        if (exclude.includes(id)) continue
        const pool = keyPools[id]
        if (!pool || pool.length === 0) continue

        const callDay = todayInPakistan(currentTime())
        if (callsOn(store.get(), callDay) >= config.dailyCallLimit) continue

        let inlineRetries = 0

        for (;;) {
          const date = currentTime()
          const start = rotationIndex[id] ?? 0
          let earliestCooldownMs: number | null = null

          // Single-key provider: inline retry without permanent cooldown
          if (pool.length === 1) {
            const keyInst = pool[0]!
            const state = store.get()
            if (!keyReady(state, id, keyInst.label, date)) {
              break
            }

            let singleKeyRetries = 0
            let succeeded = false
            let singleKeyText = ""

            while (!succeeded) {
              try {
                singleKeyText = await keyInst.provider.complete(
                  request,
                  AbortSignal.timeout(config.requestTimeoutMs),
                )
                succeeded = true
              } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err))
                const wait = err instanceof ProviderQuotaError ? err.retryAfterMs : null

                if (
                  wait !== null &&
                  wait <= INLINE_RETRY_MAX_MS &&
                  singleKeyRetries < INLINE_RETRY_ATTEMPTS
                ) {
                  singleKeyRetries += 1
                  await sleep(wait + 250)
                  timeShift += wait + 250
                  continue
                }

                if (err instanceof ProviderQuotaError) {
                  const cooldownWait = wait ?? DEFAULT_QUOTA_COOLDOWN_MS
                  const until = new Date(date.getTime() + cooldownWait).toISOString()
                  store.set(setProviderCooldown(store.get(), id, until, err.message))
                  store.set(setKeyCooldown(store.get(), id, keyInst.label, until, err.message))
                } else if (err instanceof ProviderAuthError) {
                  const until = new Date(date.getTime() + AUTH_COOLDOWN_MS).toISOString()
                  store.set(setProviderCooldown(store.get(), id, until, err.message))
                  store.set(setKeyCooldown(store.get(), id, keyInst.label, until, err.message))
                }
                break
              }
            }

            if (succeeded) {
              store.set(
                recordProviderCall(store.get(), id, todayInPakistan(currentTime()), keyInst.label),
              )
              return {
                text: singleKeyText,
                providerId: id,
                model: keyInst.provider.model,
                keyLabel: keyInst.label,
              }
            }
            break
          }

          // Multi-key pool rotation loop
          for (let step = 0; step < pool.length; step++) {
            const idx = (start + step) % pool.length
            const keyInst = pool[idx]!
            const state = store.get()

            if (!keyReady(state, id, keyInst.label, date, true)) {
              const until = state.providers[id]?.keys?.[keyInst.label]?.cooldownUntil
              if (until) {
                const untilMs = Date.parse(until)
                if (!Number.isNaN(untilMs) && untilMs > date.getTime()) {
                  const remaining = untilMs - date.getTime()
                  if (earliestCooldownMs === null || remaining < earliestCooldownMs) {
                    earliestCooldownMs = remaining
                  }
                }
              }
              continue
            }

            try {
              const text = await keyInst.provider.complete(
                request,
                AbortSignal.timeout(config.requestTimeoutMs),
              )

              rotationIndex[id] = (idx + 1) % pool.length

              store.set(
                recordProviderCall(store.get(), id, todayInPakistan(date), keyInst.label),
              )
              return {
                text,
                providerId: id,
                model: keyInst.provider.model,
                keyLabel: keyInst.label,
              }
            } catch (err) {
              lastError = err instanceof Error ? err : new Error(String(err))

              if (err instanceof ProviderQuotaError) {
                const wait = err.retryAfterMs ?? DEFAULT_QUOTA_COOLDOWN_MS
                const until = new Date(date.getTime() + wait).toISOString()
                store.set(
                  setKeyCooldown(store.get(), id, keyInst.label, until, err.message),
                )
                if (earliestCooldownMs === null || wait < earliestCooldownMs) {
                  earliestCooldownMs = wait
                }
                continue
              }

              if (err instanceof ProviderAuthError) {
                const until = new Date(date.getTime() + AUTH_COOLDOWN_MS).toISOString()
                store.set(
                  setKeyCooldown(store.get(), id, keyInst.label, until, err.message),
                )
                continue
              }

              continue
            }
          }

          if (
            earliestCooldownMs !== null &&
            earliestCooldownMs <= INLINE_RETRY_MAX_MS &&
            inlineRetries < INLINE_RETRY_ATTEMPTS
          ) {
            inlineRetries += 1
            await sleep(earliestCooldownMs + 250)
            timeShift += earliestCooldownMs + 250
            continue
          }

          // Never promote one key's cooldown to the whole provider: a bad key
          // cooled for 24h would otherwise lock out every healthy key in the pool.
          break
        }
      }

      throw new ProvidersExhaustedError(lastError?.message ?? "No AI provider is available")
    },
  }
}
