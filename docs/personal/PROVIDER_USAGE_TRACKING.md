# Provider subscription value

How much API-equivalent usage each subscription delivered, measured from local
transcripts and priced as if the same tokens had gone through the provider's
API. Each benchmark used the rates of its day; current rates are at the end.

## Benchmark 2: 2026-10-09 to 2026-10-16 (7 days)

Plans: Codex on ChatGPT Plus ($20/mo); Claude on a Team Premium seat (from
2026-10-12, extra usage disabled by the organization); Antigravity and ChatLLM
plans not recorded locally. Zed spend isn't stored locally and is not included.

### 7-day totals

| Provider    | Main models                               | Tokens | Cache hit | API value | Credits / extra spend  |
| :---------- | :---------------------------------------- | -----: | --------: | --------: | :--------------------- |
| Claude      | Opus 5.5 (418M), Haiku 4.5/5.5, Fable 5.1 |   462M |       97% |  **$208** | none (extra usage off) |
| Codex       | GPT-6.1 Sol (494M), GPT-6 Astra/Sol/Luna  |   532M |     97.5% |   **$87** | 8.8 credits ($0.35)    |
| Antigravity | Gemini 3.8 Flash High (277M), Sonnet 5.5  |   281M |       96% |   **$33** | none                   |
| ChatLLM     | GLM-5.3-Flash, muse-wonder                |   0.2M |     99.9% |     $0.08 | 992 credits ($0.50)    |

Codex delivered $87 in a week against a $4.62 weekly share of its fee (18.8×).

### Limit consumption

- **Codex weekly:** three windows reset early, so 7 days consumed 146% of a
  weekly limit. One full weekly limit is worth about **$59 (371M tokens)**,
  about 12.8× the monthly fee per month.
- **Codex 5-hour:** one window hit 100%, after **23.2M tokens worth $6.89**
  (97% cached). Three others peaked at 93–98%, worth $8–9 each.
- **Claude weekly:** on 2026-10-13 the meter dropped from 19% to 4% with the
  same reset time, which suggests the limit rose about 4.75×. Before that, a
  full week extrapolated to about $182; after it, to about **$827 (1.78B
  tokens)**, from 21% of one week.
- **Claude 5-hour:** none hit 100%. Extrapolated full windows are worth about
  $20 before the change and about $60 after.
- Antigravity and ChatLLM record no used-percent locally.

These figures count each Antigravity call and each Codex credit drop once.
Builds up to 0.6.3 over-count both in Usage (USAGE-005, USAGE-006).

## Benchmark 1: 2026-09-18

Codex on ChatGPT Plus ($20/mo) and Antigravity on Google AI Pro ($19.99/mo),
priced at the rates of the time.

### 5-hour window, 0% to 100%

| Provider / pool          | Model                         | Tokens             | Cache hit | API value    | Value / monthly fee |
| :----------------------- | :---------------------------- | :----------------- | :-------- | :----------- | :------------------ |
| Antigravity, Claude pool | `claude-opus-4-6-thinking`    | ~4.04M (9 turns)   | ~93.4%    | $4.48        | 0.22×               |
| Antigravity, Gemini pool | `gemini-3.8-flash-high`       | ~170.9M (33 turns) | ~98.4%    | $9.87–$10.00 | 0.50×               |
| Antigravity, both pools  | Claude Opus + Gemini Flash    | ~175.0M            | —         | ~$14.48      | 0.72×               |
| Codex                    | `gpt-6-astra` / `gpt-5.6-sol` | ~3.41M (30 turns)  | ~94.9%    | $4.59–$9.18  | 0.23×–0.46×         |

### Weekly cycle, reset to 100% (2026-09-14 to 2026-09-18)

| Metric              | Codex                          | Antigravity                                |
| :------------------ | :----------------------------- | :----------------------------------------- |
| Cycle               | 100% in 3.5 days (2,105 turns) | Rolling 7 days                             |
| Tokens              | 207.0M                         | Claude ~10.1M, Gemini ~536.0M              |
| Cache hit           | 94.6%                          | 95.2%                                      |
| API value           | $66.30                         | Claude $11.20, Gemini $31.00–$32.50 (~$43) |
| Credits             | $2.21 (55 fallback turns)      | none (hard cooldown)                       |
| Value / monthly fee | ~3.3× in 4 days                | ~2.1×–2.2× per week                        |

## Current rates

Per 1M tokens: uncached input / cached input / output. Official rates come from
`apps/server/src/usage/usagePricing.ts`; the rest from LiteLLM (2026-10-16).
Fast tiers cost 2× for GPT and Opus.

| Model             | Rates                                  | Source   |
| :---------------- | :------------------------------------- | :------- |
| gpt-6.1-sol       | $2 / $0.10 / $10                       | official |
| gpt-6-sol         | $2 / $0.20 / $10                       | official |
| gpt-6-astra       | $10 / $1 / $50                         | official |
| gpt-6-luna        | $0.10 / $0.01 / $0.50                  | official |
| claude-opus-5-5   | $4 / $0.20 / $20 (cache write $5)      | official |
| claude-sonnet-5-5 | $2 / $0.10 / $10                       | official |
| gemini-3.8-flash  | $0.75 / $0.075 / $3.75                 | official |
| claude-fable-5-1  | $10 / $0.25 / $50 (cache write $12.50) | LiteLLM  |
| claude-haiku-4-5  | $1 / $0.10 / $5 (cache write $1.25)    | LiteLLM  |
| claude-haiku-5-5  | $0.10 / $0.01 / $0.50                  | LiteLLM  |
| muse-wonder-1.0   | $4 / $0.20 / $20                       | LiteLLM  |
| GLM-5.3-Flash     | $0.15 / $0.03 / $0.50                  | LiteLLM  |

`codex-auto-review` is unpriced and costs nothing.
