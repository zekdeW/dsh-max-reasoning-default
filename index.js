/**
 * Max Reasoning Default — host plugin for the DeepSeek Harness web profile.
 *
 * Ensures every conversation request defaults to the HIGHEST reasoning effort
 * the selected model supports, whatever route or entry point it comes from.
 *
 * Listens on the `agent/request` waterfall at the OUTERMOST position
 * (`prepend`, so its final return wins over every inner listener, including
 * the agent's own model-selection listener that re-applies recorded picks).
 *
 * Semantics per request:
 * - No effort set                      -> raised to the model's top tier.
 * - Effort equals the adapter-reported default (`defaultEffort`) -> treated
 *   as the picker's automatic attachment rather than a deliberate choice,
 *   also raised. This is what keeps future routes zero-config: an adapter
 *   whose unconfigured default is e.g. `high` can no longer clamp a switch
 *   below the model's real maximum.
 * - Any other explicitly chosen effort -> respected, untouched (a deliberate
 *   pick of exactly the default level is indistinguishable from the attached
 *   default and is raised too).
 * - Model exposes no selectable levels, or only `off` (non-reasoning models,
 *   `thinking: disabled` postures) -> untouched.
 * - Unresolvable model metadata        -> request proceeds as-is; never
 *   fails the turn.
 *
 * Works identically for pi-ai routes (OpenRouter and other OpenAI-compatible
 * gateways), the direct DeepSeek adapter ([off, low, high, max]), and any
 * future adapter implementing the standard `resolveModel` capability seam.
 */

/**
 * Decide the effort one resolved call configuration should carry.
 * Pure function over leaf values; separated from the listener for testing.
 * @param current - the effort arriving from downstream, if any.
 * @param info - the exact-route model metadata reported by the adapter.
 * @returns the effort to send, or undefined to leave the config untouched.
 */
export function decideEffort(current, info) {
  const efforts = info && info.reasoning ? info.reasoning.efforts : undefined
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  const highest = efforts[efforts.length - 1]
  if (highest === undefined || highest.id === 'off') return undefined
  if (current === highest.id) return current
  if (current !== undefined && current !== (info.reasoning.defaultEffort ?? null)) return current
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
        } catch (error) {
          // Model metadata is advisory: an unresolvable lookup must never fail
          // the turn, so the request proceeds on its route's own behavior.
          return config
        }
        const effort = decideEffort(
          config.reasoningEffort === undefined ? undefined : config.reasoningEffort,
          info,
        )
        if (effort === undefined || effort === config.reasoningEffort) return config
        return { ...config, reasoningEffort: effort }
      },
      true,
    )
  },
}
