# @zekdew/dsh-max-reasoning-default

DeepSeek Harness host plugin: every conversation request whose reasoning effort
is unset is raised to the **highest level the selected model supports** —
across pi-ai routes (OpenRouter etc.), the direct DeepSeek adapter, and any
future adapter implementing the standard `resolveModel` capability seam.

## Behavior

| Situation | Result |
| --- | --- |
| No effort chosen for the request | Set to the model's top tier (e.g. `max`) |
| Effort equal to the adapter-reported default (picker auto-attachment) | Also raised — keeps future routes zero-config |
| Effort deliberately picked different from the default | Respected, untouched |
| Model exposes no selectable efforts (or only `off`) | Untouched |
| `thinking: disabled` deployment posture | Untouched (only `off` reported) |
| Model metadata unresolvable | Request proceeds on route default |

The listener registers at the OUTERMOST waterfall position (`prepend`), so its
decision wins over inner listeners — including the agent's own model-selection
listener that re-applies recorded picks after a switch.

## Install (web profile)

```sh
# 1. clone anywhere you keep plugins, e.g.:
git clone https://github.com/zekdeW/dsh-max-reasoning-default.git ~/dev/dsh-max-reasoning-default
# 2. add to the profile's package.json dependencies:
#    "@zekdew/dsh-max-reasoning-default": "link:~/dev/dsh-max-reasoning-default"
# 3. add to ~/.dsh/profiles/web/cordis.patch.yml insert list:
#    - id: max-reasoning-default
#      name: '@zekdew/dsh-max-reasoning-default'
pnpm --dir ~/.dsh/profiles/web install
# 4. restart the web app (or touch cordis.patch.yml — the layer hot-reloads)
```

## Deployment notes

Lessons from running this on a real deployment — recommended companion settings:

- **DeepSeek direct route** (`llm-deepseek` settings section): set
  `reasoningEffort: max`. The adapter reports it as the model's `defaultEffort`,
  so the composer attaches Max when switching to any DeepSeek model. Scope: it
  applies to every request on the route — session-title generation is always
  forced to disabled thinking by the adapter itself, and other no-effort calls
  (compaction etc.) inherit the max default.
- **Endpoints that mandate reasoning**: some upstreams reject any request whose
  reasoning parameter is absent (`400 "Reasoning is mandatory for this
  endpoint"`). For such models map `off` to a real tier instead of leaving it
  empty — e.g. `off: low` — so auxiliary no-effort requests send a legal
  minimum instead of omitting the parameter entirely.
- **pi-ai route-level `reasoning:`**: it becomes the picker default for EVERY
  model on the route, and a model that cannot support the configured level
  fails its requests at dispatch (`UNSUPPORTED_REASONING_EFFORT`) — including
  non-reasoning models, which have no levels to negotiate with. Prefer leaving
  the route default unset and letting this plugin raise each model to its own
  maximum; add a route default only when every model on the route supports it.
- **UI display caveat**: the composer's effort label reads configured defaults,
  not what this plugin fills at dispatch. With no route default a model can
  show `Default` while actually requesting its top tier — display lags intent
  by design; verify behavior with a request-level probe, not the label.
