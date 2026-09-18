# Provider Subscription Allowance & API Cost Tracking

This document tracks the API-equivalent value delivered by AI subscription plans (**Antigravity / Google AI Pro** vs. **Codex / ChatGPT Plus**) over time. It is updated bi-weekly to monitor whether providers adjust quota ceilings, model availability, or prompt cache economics.

---

## Tracking Log

### Benchmark #1: 2026-09-18

- **Measurement Date**: September 18, 2026 (Local Time: 13:40 EDT / 17:40 UTC)
- **Methodology**: Ground-truth telemetry audit from local logs (`~/.gemini/antigravity/` and `~/.codex/sessions/`). Evaluated across exact exhaustion anchors (0% used $\rightarrow$ 100% used) with full prompt caching discounts applied to prevent inflated cumulative double-counting.

#### 1. Measured 5-Hour Burst Limit Allowance (0% $\rightarrow$ 100% Exhaustion)

| Provider / Plan                                                | Model(s) Evaluated            | Measured 5-Hour Token Capacity  | Prompt Cache Hit Rate                 | API Cost per 5-Hour Limit | Subscription Plan Fee | Window Value Multiplier |
| :------------------------------------------------------------- | :---------------------------- | :------------------------------ | :------------------------------------ | :------------------------ | :-------------------- | :---------------------- |
| **Antigravity (Google AI Pro)**<br>_(Claude Pool)_             | `claude-opus-4-6-thinking`    | **~4.04M tokens** _(9 turns)_   | ~93.4% cached input ($1.50/M)         | **$4.48**                 | $19.99 / month        | **0.22×**               |
| **Antigravity (Google AI Pro)**<br>_(Gemini Pool)_             | `gemini-3.8-flash-high`       | **~170.9M tokens** _(33 turns)_ | ~98.4% cached input ($0.0375/M)       | **$9.87 – $10.00**        | (Included above)      | **0.50×**               |
| **Antigravity (Google AI Pro)**<br>_(Combined Window Ceiling)_ | Claude Opus + Gemini Flash    | **~175.0M tokens**              | —                                     | **~$14.48**               | $19.99 / month        | **0.72×**               |
| **Codex (ChatGPT Plus)**<br>_(Measured 5h Session)_            | `gpt-6-astra` / `gpt-5.6-sol` | **~3.41M tokens** _(30 turns)_  | ~94.9% cached input ($0.40 – $1.25/M) | **$4.59 – $9.18**         | $20.00 / month        | **0.23× – 0.46×**       |

> **Notes on 5-Hour Limits**:
>
> - **Antigravity / Google AI Pro**: Employs separate quota pools. The Claude Opus pool triggers cooldown after ~$4.48 of compute, while the Gemini Flash pool provides high token volume (~171M tokens) before exhaustion.
> - **Codex**: A single continuous session starting from a completely fresh window (`0.0% used`) to lockout (`100.0% used`) consumes **~3.41M tokens** (~30 turns) with a ~~95% cache hit rate, representing **~$4.59 to $9.18** in API-equivalent compute. Both providers offer remarkably consistent 5-hour burst allowances (~~$4.50 – $9.50) per monthly subscription dollar.

---

#### 2. Weekly Quota Allowance & Actual Incurred Cost (Full Reset $\rightarrow$ 100% Exhaustion)

Measured across the complete weekly cycle (**2026-09-14 14:03 UTC $\rightarrow$ 2026-09-18 02:28 UTC**):

| Metric                             | Codex (ChatGPT Plus: $20/mo)                               | Antigravity (Google AI Pro: $19.99/mo)                                           |
| :--------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------- |
| **Weekly Cycle Duration**          | Drained to 100% in **3.5 days** (2,105 subscription turns) | Rolling 7-day quota (~16–18 window equivalents)                                  |
| **Total Tokens Consumed**          | **207,034,530 tokens**                                     | Claude: **~10.1M tokens**<br>Gemini: **~536.0M tokens**                          |
| **Average Prompt Cache Rate**      | **94.6% cached input**                                     | **95.2% cached input**                                                           |
| **Primary Subscription API Value** | **$66.30**                                                 | Claude: **$11.20**<br>Gemini: **$31.00 – $32.50**<br>**Total: ~$42.20 – $43.70** |
| **Usage Credits Incurred**         | **$2.21** _(55 fallback turns from balance)_               | N/A (Hard rate-limit cooldown)                                                   |
| **Weekly Plan Multiplier**         | **~3.3× monthly sub cost** in 4 days                       | **~2.1× – 2.2× monthly sub cost** per week                                       |

---

## Reference Rate Cards Used for Benchmarking

Pricing definitions reflect active rates in `request-auditor` including prompt caching discounts:

- **Codex**:
  - `gpt-5.6-sol`: $4.00 uncached input / $0.40 cached input / $20.00 output (per 1M tokens)
  - `gpt-5.6-luna`: $0.20 uncached input / $0.02 cached input / $1.20 output (per 1M tokens)
  - `codex-auto-review`: $1.00 uncached input / $0.25 cached input / $4.00 output (per 1M tokens)
- **Antigravity / Google AI Pro**:
  - `claude-opus-4-6-thinking`: $5.00 uncached input / $1.50 cached input / $25.00 output (per 1M tokens)
  - `gemini-3.8-flash-high`: $0.15 uncached input / $0.0375 cached input / $0.60 output (per 1M tokens)
