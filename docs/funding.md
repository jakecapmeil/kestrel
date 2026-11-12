# Paying for Kestrel

Kestrel is free, and it should stay free for the school runners it was built for. This document covers what Kestrel costs to run, where the money can come from, and what to do first. The research was done in November 2026, and every number in it needs checking on the official page before you rely on it.

## Decide first: Gemini and under-18 runners

The current [Gemini API terms](https://ai.google.dev/gemini-api/terms) require API users to be 18 or older. They also say the API must not be used in an app "directed towards or likely to be accessed by" people under 18. Kestrel is built for high school teams (13 and up) and uses Gemini's free tier as its default AI, so the default probably doesn't comply today. This was true before these changes too.

This is a decision for the maintainer, ideally after legal advice. The options:

- **Make the default an open-weight model on Cloudflare Workers AI** (Llama or Gemma). It's already the last-resort fallback in `gemini.js`. Check Cloudflare's and the model licence's age terms. Photo food estimates would need a vision model there, such as Llama 3.2 Vision.
- **Gate Kestrel AI to verified adults** and give under-18s the rule-based plan and labels. This loses a lot of the product.
- **Ask Google directly** whether a 13+ coaching app can use the API. Forum threads show staff declining to give guidance.

Whatever is chosen, the per-job model picker added here makes switching cheap: only the server's free default changes.

## What it costs today

| Cost | Now | At 1,000 weekly runners |
|---|---|---|
| Cloudflare Workers + D1 | Free plan | Workers Paid, about $5 a month, covers it |
| Supabase sign-in | Free tier (50k monthly users) | Still free |
| Kestrel AI (Gemini free tier) | $0, capped at 40 calls per runner per day | The free tier's per-minute and per-day limits start to bite. Paid Gemini Flash-class models cost cents per runner per month. |
| Domain | Optional | About $12 a year |

The real cost is AI.

The free Gemini tier is fine to launch on. Its terms let Google use what is sent ([Gemini API terms](https://ai.google.dev/gemini-api/terms)), and the app now says so in Settings and on the privacy page. Two things cut the bill as Kestrel grows:

- Runners can already choose their own model for each job (chat, summaries, food photos).
- The open dataset (docs/data-sharing.md) could fine-tune a small open model that runs on Workers AI.

A realistic budget for the first year is **$100–600**. That covers paid Gemini once the free tier fills up, Workers Paid, a domain, and merch for top supporters.

## Where money can come from

### 1. Donations (start now)

| Platform | Fees (verify) | Good for | Notes |
|---|---|---|---|
| **GitHub Sponsors** | 0% for personal accounts; card processing still applies | Developers who already use GitHub | The account holder must be 18+ or use a parent's account. Monthly or one-time. |
| **Open Collective** (via a fiscal host such as Open Source Collective) | Host fee commonly 0–10% | Transparent public budget, tax-deductible gifts in the US through the host | The host holds the money, so no personal bank account is needed. Good for school and club donors. |
| **HCB (Hack Club)** | 7% of revenue | **Teen-led** projects (ages 13–18), with 501(c)(3) fiscal sponsorship | It doesn't give money; it holds it, makes donations tax-deductible, and gives you a card and transparent books. ([HCB eligibility](https://help.hcb.hackclub.com/en/articles/15409923-who-can-apply-for-fiscal-sponsorship)) |
| **Ko-fi** | 0% on donations (free plan) | Quick "buy me a coffee" | Simple, but no tax deduction. |
| **GoFundMe** | 0% platform fee, about 2.9% + $0.30 per donation (US) | A one-off campaign with a story ("keep Kestrel free for 50 school teams") | The organizer must be **18+**, though a minor can be the beneficiary. Gifts are not tax-deductible. Best for a single goal, not ongoing costs. ([GoFundMe fees](https://www.gofundme.com/c/blog/gofundme-fees)) |

**Should Kestrel start a GoFundMe?** Not as the main channel. GoFundMe suits a one-time goal, needs an adult to run it, and isn't tax-deductible. Kestrel's costs are small and ongoing, and its likely donors are parents, coaches and booster clubs, many of whom want a receipt.

The better setup:
1. **If the project is teen-led, apply to HCB.** It gives you tax-deductible donations, a nonprofit umbrella and public books for 7%. Otherwise use **Open Collective** with Open Source Collective as host. Point GitHub Sponsors at the same collective.
2. **Run a GoFundMe later, once, for a specific goal**, such as "a year of free AI for every high school team on Kestrel, $1,500". Have a parent or guardian as organizer and link it from the Support card.

### 2. Grants

| Program | Fit | Notes |
|---|---|---|
| **NLnet / NGI Zero** (EU) | Medium | Funds open internet technology, €5k–50k, and individuals can apply. The fit is best for privacy-preserving or open data infrastructure, such as the anonymized open running dataset and the on-device models. Calls open and close, so check the current one. ([NLnet](https://nlnet.nl/news/2026/20261015-47-new-projects.html)) |
| **FLOSS/fund** (Zerodha) | Medium | $10k–100k a year to open-source projects with real users. You apply through a `funding.json` file in the repo, so it needs traction first. ([OSS.Fund guide](https://www.oss.fund/guides/open-source-grants-2026/)) |
| **Sovereign Tech Agency** | Low | Funds critical infrastructure, not apps. |
| **Local youth-sports and health foundations** (community foundations, state high school athletic association foundations, running-store and shoe-brand community funds) | **High** | Small grants of $500–5k for youth health and access. Kestrel's story fits: free coaching for school teams that can't afford coaches' software, and health-first guardrails for teens. Most need a fiscal sponsor (HCB or Open Collective), which is another reason to set one up first. |
| **Student and civic tech competitions** (Congressional App Challenge, science fairs, school innovation grants) | High if you are a student | Prize money, visibility, and adult mentors who can help with fiscal setup. |

### 3. In-kind credits

- **Google for Startups Cloud Program:** credits for Gemini and Vertex. The large tiers are for funded startups; a small "Start" tier exists for unfunded ones. ([Google for Startups AI](https://cloud.google.com/startup/ai))
- **Cloudflare:** the startup program targets funded companies. A nonprofit intake ran in late 2025 ([Cloudflare blog](https://blog.cloudflare.com/expanding-startups-for-nonprofits/)), so watch for it to reopen. Project Galileo covers security for at-risk public-interest sites, not compute.
- **Ask the AI providers directly.** Anthropic, OpenAI and Google all have nonprofit and education programs that change often. A short email works best: what Kestrel is, how many teams use it, what it would cost them, and that it's open source.

## Supporter perks (built)

Every supporter gets the same perks, whatever they gave, and perks are always cosmetic, so features never sit behind a paywall:
- **Any donation:** supporter appearance themes (accent colours). Later cosmetic thank-yous (a profile badge, app icons) can be added the same way.
- **$100 or more:** all of the above plus Kestrel merch (a shirt or a running cap). The maintainer sends it by hand. The app never collects a shipping address; that happens by email.

### How perks are unlocked

The donation platforms don't tell Kestrel who gave, so the maintainer sends each donor a **supporter code**.

1. Set a signing secret once: `openssl rand -hex 32 | npx wrangler secret put SUPPORTER_SECRET` (keep a copy somewhere safe). Then mint codes: `SUPPORTER_SECRET=… node scripts/supporter-code.mjs supporter 5` (or `champion` for $100+).
2. Email a code to each donor.
3. They enter it in You → Settings → Support Kestrel.

Codes are signed with `SUPPORTER_SECRET`, so they can't be guessed, and each works for one account only. Later, webhooks from Open Collective or GitHub Sponsors could do this automatically.

### Setting the links

Put the donation pages in `wrangler.jsonc` vars. The Support card hides any link that isn't set.

```jsonc
"DONATE_URL": "https://opencollective.com/kestrel",       // main: Open Collective, HCB or GitHub Sponsors
"DONATE_ALT_URL": "https://github.com/sponsors/<you>",     // optional second option
"CAMPAIGN_URL": ""                                         // optional: a GoFundMe for one specific goal
```

## First steps, in order

1. Decide who holds the money: a parent or guardian, HCB (teen-led), or Open Collective.
2. Create the donation page and set `DONATE_URL`.
3. Set `SUPPORTER_SECRET` and mint the first supporter codes.
4. Write a one-page pitch: users, teams, cost per runner, the safety work (guardrails, the ethos, the 100-case coach eval), and open data. Send it to two local foundations and to NLnet's next call.
5. After 3–6 months of real usage numbers, apply to FLOSS/fund. Run a GoFundMe only for a concrete, time-boxed goal.
