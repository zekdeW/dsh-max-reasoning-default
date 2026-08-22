# @zekdew/dsh-max-reasoning-default

DeepSeek Harness host plugin: every conversation request whose reasoning effort
is unset is raised to the **highest level the selected model supports** —
across pi-ai routes (OpenRouter etc.), the direct DeepSeek adapter, and any
future adapter implementing the standard `resolveModel` capability seam.

## Behavior

| Situation | Result |
| --- | --- |
| No effort chosen for the request | Set to the model's top tier (e.g. `max`) |
| Effort explicitly picked in the composer | Respected, untouched |
| Model exposes no selectable efforts (or only `off`) | Untouched |
| `thinking: disabled` deployment posture | Untouched (only `off` reported) |
| Model metadata unresolvable | Request proceeds on route default |

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
