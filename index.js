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
 * Additionally, on first encounter of an undeclared model, the plugin
 * auto-completes its settings.yaml entry (contextWindow, input modalities,
 * reasoningEfforts) from the OpenRouter catalog — asynchronously, so it never
 * blocks the current request but ensures all subsequent requests and UI
 * surfaces see full metadata.
 *
 * Explicit picks differing from the default are always respected.
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const SETTINGS_PATH = join(homedir(), '.dsh', 'settings.yaml')

/** @type {Map<string, {efforts: Array<{id: string}>} | null>} */
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
      ? {
          efforts: AUTO_EFFORTS,
          contextWindow: match.context_length,
          input: match.architecture?.input_modalities?.filter(m => m === 'text' || m === 'image') ?? ['text'],
        }
      : null
    capabilityCache.set(modelId, result)
    return result
  } catch {
    capabilityCache.set(modelId, result)
    return null
  }
}

/**
 * Auto-complete a hand-declared model entry in settings.yaml with metadata
 * fetched from OpenRouter. Fire-and-forget: failures are silently swallowed
 * because the current request already proceeded correctly.
 */
function persistModelMetadata(modelId, caps) {
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf8')
    const doc = parseYaml(raw)
    const route = doc?.['llm-pi-ai']?.providers?.openrouter
    if (!route || !Array.isArray(route.models)) return
    const entry = route.models.find(m => m.id === modelId)
    if (!entry) return

    let changed = false
    if (caps.contextWindow && !entry.contextWindow) {
      entry.contextWindow = caps.contextWindow
      changed = true
    }
    if (Array.isArray(caps.input) && caps.input.length > 0 && !entry.input) {
      entry.input = [...caps.input]
      changed = true
    }
    if (!entry.reasoningEfforts) {
      entry.reasoningEfforts = {}
      for (const e of caps.efforts) {
        entry.reasoningEfforts[e.id] = e.id === 'off' ? 'low' : e.id
      }
      // Remove keys not in our ladder (e.g. minimal/medium/xhigh if absent)
      for (const key of Object.keys(entry.reasoningEfforts)) {
        if (!caps.efforts.some(e => e.id === key)) delete entry.reasoningEfforts[key]
      }
      changed = true
    }

    if (changed) writeFileSync(SETTINGS_PATH, stringifyYaml(doc), 'utf8')
  } catch {
    // Settings persistence is best-effort; the in-memory cache still governs
    // this process lifetime, so a failed write is invisible at request time.
  }
}

/**
 * Decide the effort one resolved call configuration should carry.
 * Pure function over leaf values; separated from the listener for testing.
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

        let efforts = info.reasoning !== undefined ? info.reasoning.efforts : undefined
        let defaultEffort = info.reasoning?.defaultEffort

        if ((efforts === undefined || efforts.length === 0) && config.model.includes('/')) {
          const caps = await fetchCapabilities(config.model)
          if (caps !== null) {
            efforts = caps.efforts
            defaultEffort = undefined
            // Fire-and-forget: auto-complete the settings entry so future
            // requests AND the UI see the full metadata without restarts.
            persistModelMetadata(config.model, caps)
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
