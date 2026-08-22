/**
 * Max Reasoning Default — host plugin for the DeepSeek Harness web profile.
 *
 * Ensures every conversation request defaults to the HIGHEST reasoning effort
 * the selected model supports, whatever route or entry point it comes from.
 *
 * Three tiers of capability detection:
 * 1. Adapter-reported efforts (resolveModelInfo): declared models and catalog
 *    models report their supported levels directly.
 * 2. OpenRouter public API fallback: for hand-declared models with no
 *    declared reasoningEfforts, the plugin queries OpenRouter's public model
 *    catalog once, caches the answer, and fills max if the model supports
 *    reasoning. This makes newly added models work with zero manual steps.
 * 3. Neither source reports capability -> untouched (non-reasoning models,
 *    disabled-thinking postures).
 *
 * Explicit picks differing from the default are always respected.
 */

/** @type {Map<string, {efforts: Array<{id: string, name: string}>} | null>} */
const capabilityCache = new Map()

/** Standard escalation ladder sent for models confirmed to support reasoning. */
const AUTO_EFFORTS = [
  { id: 'off', name: 'Off' },
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]

/**
 * Query OpenRouter's public model catalog for one model id.
 * Results cached for the process lifetime; failures cached as null.
 */
async function fetchCapabilities(modelId) {
  if (capabilityCache.has(modelId)) return capabilityCache.get(modelId)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = await res.json()
    const match = (data.data ?? []).find(m => m.id === modelId)
    const result = match?.supported_parameters?.includes('reasoning')
      ? { efforts: AUTO_EFFORTS }
      : null
    capabilityCache.set(modelId, result)
    return result
  } catch {
    capabilityCache.set(modelId, null)
    return null
  }
}

/**
 * Decide the effort one resolved call configuration should carry.
 * Pure function over leaf values; separated from the listener for testing.
 * @param current - the effort arriving from downstream, if any.
 * @param efforts - ordered effort list (adapter-reported or auto-detected).
 * @param defaultEffort - the adapter-configured default, if any.
 * @returns the effort to send, or undefined to leave the config untouched.
 */
export function decideEffort(current, efforts, defaultEffort) {
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  const highest = efforts[efforts.length - 1]
  if (highest === undefined || highest.id === 'off') return undefined
  if (current === highest.id) return current
  if (current !== undefined && current !== (defaultEffort ?? null)) return current
  return highest.id
}

export default {
  inject: ['llm'],
  apply(ctx) {
    ctx.on(
      'agent/request',
      async (payload, next) => {
        const config = await next()
        let info
        try {
          info = await ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal)
        } catch {
          return config
        }

        // Tier 1: adapter-reported efforts.
        let efforts = info.reasoning !== undefined ? info.reasoning.efforts : undefined
        let defaultEffort = info.reasoning?.defaultEffort

        // Tier 2: OpenRouter public API fallback for undeclared hand-models.
        if ((efforts === undefined || efforts.length === 0) && config.model.includes('/')) {
          const caps = await fetchCapabilities(config.model)
          if (caps !== null) {
            efforts = caps.efforts
            defaultEffort = undefined
          }
        }

        const effort = decideEffort(
          config.reasoningEffort === undefined ? undefined : config.reasoningEffort,
          efforts,
          defaultEffort,
        )
        if (effort === undefined || effort === config.reasoningEffort) return config
        return { ...config, reasoningEffort: effort }
      },
      true,
    )
  },
}
