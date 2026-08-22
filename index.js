/**
 * Max Reasoning Default — host plugin for the DeepSeek Harness web profile.
 *
 * Listens on the `agent/request` waterfall. After the downstream chain
 * resolves the conversation's call configuration, an UNSET `reasoningEffort`
 * is raised to the highest level the resolved model reports through the
 * standard `resolveModel` seam (`ctx.llm.resolveModelInfo`, efforts in
 * adapter escalation order, so the last entry is the model's own maximum).
 *
 * Semantics:
 * - An explicitly chosen effort (composer pick recorded with the agent)
 *   always wins; this only fills the default.
 * - A model exposing no selectable levels (or only `off`) is left untouched,
 *   which also keeps a deployment-wide `thinking: disabled` posture intact.
 * - Unresolvable model metadata never fails the turn: the request keeps the
 *   route's own default behavior.
 *
 * Works identically for pi-ai routes (OpenRouter and other OpenAI-compatible
 * gateways), the direct DeepSeek adapter ([off, low, high, max] → max), and
 * any future adapter implementing the same capability seam.
 */

/** Highest entry of one ordered effort list, or undefined when not raisable. */
function highestEffort(info) {
  const efforts = info?.reasoning?.efforts
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  const highest = efforts[efforts.length - 1]
  if (highest === undefined || highest.id === 'off') return undefined
  return highest.id
}

export default {
  inject: ['llm'],
  apply(ctx) {
    ctx.on('agent/request', async (payload, next) => {
      const config = await next()
      if (config.reasoningEffort !== undefined) return config
      let info
      try {
        info = await ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal)
      } catch (error) {
        // Model metadata is advisory: an unresolvable lookup must never fail
        // the turn, so the request proceeds on its route's default behavior.
        return config
      }
      const effort = highestEffort(info)
      return effort === undefined ? config : { ...config, reasoningEffort: effort }
    })
  },
}
