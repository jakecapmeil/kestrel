# Kestrel redesign: critique and plan

Scope: the push at `f643967` and the app as it runs today (desktop 1024px and phone 375px, local build). Nothing in `src/` or `public/` is changed by this document. Open [design-system-preview.html](design-system-preview.html) for the proposed direction.

## 1. What the last push did

It added a marketing landing page (537 lines in `public/index.html`), a second button system, Hugging Face-style cards in the Lab, and a Lab landing page. It did not touch the app itself.

Problems with the push:

| # | Finding | Where |
|---|---|---|
| 1 | **The landing page renders above the app for signed-in users.** `#kApp` starts at y=5,785px, below the hero, features, demo and CTA. `gate()` hides these only on sign-in screens, never when the app opens. A signed-in athlete lands on a marketing page. | `public/kestrel.js` `gate()` / `openApp()` |
| 2 | **Landing hero clips on phones.** "Train together." overflows the 375px viewport. `.k-display` uses `clamp(48px,16vw,112px)` with `-0.055em` tracking. | `public/index.html:1772` |
| 3 | **`.k-btn` is defined twice with different rules** (rounded 44px block in index.html, square 40px outlined block in kestrel.css). Which wins depends on load order. | `public/index.html:1641`, `public/kestrel.css:171` |
| 4 | **Stale copy.** "Six plan levels, 20 to 80+ miles" contradicts the README (levels 1-9 from 15 mi). "Interactive demos" are static boxes with emoji icons. | landing |
| 5 | **Lab landing says "Think of it as Hugging Face for running models"** and the feature grid ends in an orphan fourth card. Reads as placeholder copy. | `public/lab/lab.js` |
| 6 | **Rounded cards on a 2px system.** The push adds `border-radius: var(--r-card)` where `--r-card` is `2px`, `--r-pill` is also `2px` (a "pill" button is square), then adds 12px toasts and 6px focus rings. Four radius values with no scale. | `kestrel.css:46-49, 262-266` |

## 2. Critique of the app

### Why it reads as vibe-coded

- **A skin on top of a fork.** The app is the Hawks calendar (6,817-line `index.html`, 115 inline `style=""` attributes, 87 distinct hex colours) with `kestrel.css` overriding it. There are 11 `!important`s, a duplicated button, and tokens that lie: `--gold` holds red, `--gold-bg` is pink. Every new screen inherits the contradiction.
- **Decoration standing in for design.** Red-pen underline under every page title, hand-drawn circle on the selected day, an SVG turbulence filter on icons, uppercase tracking on every label. Each is fine once; applied everywhere they become the "look" and carry no information.
- **One radius, everywhere.** 2px corners on cards, inputs, buttons, chips. No hierarchy between a card, a control and a badge.
- **Generic structure.** Every screen is "page title, then card, then card". Nothing says what matters on that screen.
- **Hawks leftovers.** `hawks*` localStorage keys (17 call sites), `Those available are: …` copy box, the coach prompt names "the Kestrel cross country team", and the AI avatar is the letter K.

### Layout and navigation

- **Four tabs across the top, even on phones.** School athletes use this on phones. At 375px the header stacks into four rows (brand, sync/lab/profile, team picker, tabs) and about 230px passes before content. At 1024px the tab labels collide ("SCHEDULETRAINING").
- **Team is the least developed tab.** It is a mileage chart. For someone with no team it says "Couldn't load team mileage. Check your connection." when the real state is "you are not on a team".
- **Team switcher shows "No team  + Team"** as the second thing on every screen.
- **Kestrel and Lab are visually the same product.** They share a header pattern and button system but nothing tells you which one you are in, or why you would go to the other.
- **Bring-your-own-AI is a settings dialog in the main app.** That is the Lab audience's feature, in the beginner's path.

### Logo

The mark is a `K` with a red dot on a black square (a 32px glyph). The original mark (`git show fced8dc:public/kestrel.svg`: rust rounded square, white hawk) was a more distinctive idea but was drawn crudely and in a colour the product no longer uses. The hawk is the product's personality and currently appears nowhere in the UI.

## 3. Direction (decisions, not options)

1. **Keep black and red.** Black is the structure and the dominant surface. Red is only for the one thing to act on per screen and for the hawk's eye. The user said keep it; the change is *how* it is used: much more black, fewer red accents.
2. **Round everything, with a scale.** 8 / 12 / 16 / 24 / 32 / pill. Buttons and chips are pills, cards are 24, inputs are 16, sheets are 32 on the top corners. The scale is the system; there are no one-off radii.
3. **Drop the hand-drawn layer.** Red-pen underlines, circled day, rough filter, Caveat font: removed. They fight rounded geometry and add a second personality on top of the hawk. The hawk carries the personality instead.
4. **Type pair.** Bricolage Grotesque (display, 700/800) for headings and big numbers; Inter for UI; JetBrains Mono only for race times and keys. Replaces Inter Tight at 800 weight with -0.055em tracking.
5. **The hawk is the brand, large.** Redraw it properly (the preview uses the old silhouette recoloured; it is a placeholder and reads weakly). Uses:
   - header mark at 32px, wordmark lowercase `kestrel`
   - the AI coach avatar everywhere (replaces the "K" tile)
   - empty states (perched hawk: no team yet, no runs yet)
   - loading (gliding hawk)
   - team avatar fallback, favicon, app icon, OG image
   - landing hero as a large tonal watermark
   - Lab variant: hawk plus a node/wing-feather detail so the two products have one family resemblance
6. **Mobile first nav.** Bottom tab bar on phones: Team, Schedule, Train, You. Left rail on desktop. Team is the home screen, because the team is the reason to come back daily.
7. **Light and dark both first-class.** Light is warm paper with white cards and black hero blocks; dark is near-black. Semantic tokens switch, components do not.

## 4. Design system

### Files

```
public/ds/tokens.css      primitives + semantic tokens (light, dark)
public/ds/base.css        reset, type, focus, motion defaults
public/ds/components.css  button, chip, input, card, seg, tab-bar, sheet, avatar, toast, ...
public/ds/hawk.svg        sprite: hawk, hawk-perched, hawk-glide, hawk-lab
public/ds/index.html      living style guide (the preview becomes this)
```

Rules: components read **semantic** tokens only; primitives are never referenced outside `tokens.css`; no inline styles in new code; no `!important`.

### Tokens

| Group | Values |
|---|---|
| Radius | `--r-xs 8`, `--r-sm 12`, `--r-md 16`, `--r-lg 24`, `--r-xl 32`, `--r-pill 999` |
| Space | 4pt scale: 4, 8, 12, 16, 24, 32, 48, 72 |
| Ink (neutrals) | 950 `#0d0d0f`, 900 `#17171a`, 800 `#222226`, 700 `#34343a`, 500 `#6b6b73`, 300 `#b9b6ae`, 200 `#dcd8cf`, 100 `#ebe7dd`, 50 `#f5f2ea` |
| Red | 700 `#a82610`, 600 `#c9301a`, 500 `#e1371a` (brand), 400 `#ff5b3a` (dark-mode accent), 100 `#fbe1da`, 950 `#2c120c` |
| Status | green `#1f8a52` / `#6fcf97`, blue `#2a5c96` / `#7fb2ec`, amber `#c98a0a` |
| Semantic | `--bg --surface --surface-2 --inverse --on-inverse --text --text-2 --line --accent --accent-hover --accent-subtle --on-accent --positive --info --shadow-1 --shadow-2` |
| Type | Display 44/1.0, Title 24, Heading 18, Body 15/1.5, Caption 12; mono 13 for data |
| Motion | 140ms (press, hover), 260ms (sheets); `cubic-bezier(.2,.8,.2,1)`; respects `prefers-reduced-motion` |
| Elevation | `shadow-1` rest, `shadow-2` sheets and menus; none in dark |

Token renames in the old CSS: `--gold` → `--accent`, `--gold-bg` → `--accent-subtle`, `--gold-ink` → `--accent`, `--r-pill: 2px` → `999px`.

### Components (v1 list)

Button (primary, accent, secondary, ghost, sm), icon button, chip/badge, segmented control, tab bar (bottom) and rail (desktop), input / textarea / select / switch / checkbox, card, stat tile, list row, avatar and avatar stack, event card (with RSVP), post card, message bubble, composer, bottom sheet / modal, toast, empty state (hawk), skeleton, progress/bar, calendar day cell, model card, code block.

### Accessibility

Contrast checked against both themes (red-500 on white is 4.2:1, so it is used for large/bold text and fills only; red-600 for small text), 44px minimum targets, visible focus ring on every interactive element, reduced-motion respected.

## 5. Information architecture: Kestrel vs Kestrel Lab

The Claude chat vs Claude Code split:

| | **Kestrel** (chat) | **Kestrel Lab** (code) |
|---|---|---|
| For | Athletes, parents, coaches | Tinkerers, researchers, coach-developers |
| Stance | Works out of the box, few choices | Everything is a choice and a file |
| AI | One default coach. No keys, no settings. | Pick any model: Gemini, OpenAI, Anthropic, OpenRouter, Groq, Ollama/LM Studio. Own system prompt and guardrail view. |
| Predictions | One default per task, labelled "Kestrel Fitness model" | Choose, compare, fork, fine-tune, publish; per-task defaults; A/B on your own race history |
| Shell | Bottom tabs, friendly, rounded | Dense: left sidebar of repos, model pages with Files / Card / Try it / API / Lineage, tables, diffs |
| Data | Team, plan, log | Models, API keys, usage, imports |
| Visual | Warm, hawk-forward | Same tokens, denser density setting, hawk + node mark, mono type more prominent |

Concrete moves:

- The **AI provider/key dialog moves from the main app to Lab** (`kestrel.js` `aiSettings`). Kestrel shows "Kestrel AI" and a small "Customise in Lab" link.
- The **per-prediction model picker moves to Lab**. Kestrel's Fitness card says which model made the number and has "Open in Lab" to see or change it.
- Lab gets a **"Use in Kestrel"** button on any model, which sets it as the account default and shows a banner in Kestrel while a non-default model is active.
- A visible **switcher** in both headers (Kestrel · Lab) with a different tinted header so you always know where you are.

## 6. Team

What the references do (sources in section 9): Heja gives each team an auto-created team chat, plus one-to-one and small-group chats, schedule with RSVP and reminders; attendance stats and payment tracking are paid. TeamSnap offers rosters, messaging, availability, assignments and lineups, photo/video sharing, stats. Neither is training-aware. Kestrel's advantage is that the team knows how everyone is training, and opt-in sharing can feed the feed.

### Screens

Team tab becomes five segments: **Feed · Chat · Calendar · Roster · Mileage**.

- **Feed** (home screen): event cards with one-tap RSVP and "who is going", pinned announcements from the owner/coach with "seen by 19 / 22", posts, optional auto-shared runs (opt-in per athlete) with kudos reactions and comments, weekly mileage milestones.
- **Chat**: channels `#general`, `#announcements` (owner posts only), `#meets`, a thread per event, and small group chats. No one-to-one DMs between an adult and a minor.
- **Calendar**: the current calendar, restyled; day sheet instead of side panel on phones.
- **Roster**: members with role, availability, optional contact card, groups (varsity, JV, distance, sprints) used for targeting posts and events.
- **Mileage**: current leaderboard and bars, plus weekly challenges, opt-in only (names shown only for sharers, as today).

### Data

The schema already has `posts` and `comments` (day notes). New (migration `0003_team_social.sql`):

```
channels(id, team_id, name, kind[general|announce|event|group], event_id, created_by, created_at)
channel_members(channel_id, person_id, muted)
messages(id, channel_id, person_id, text, reply_to, created_at, deleted_at)
reactions(target_type, target_id, person_id, emoji)
post_seen(post_id, person_id, seen_at)
reports(id, message_id, reporter_id, reason, created_at, resolved_at)
```

### Realtime

Recommended: **one Durable Object per team** holding the WebSocket fan-out, writing to D1. It fits the Workers stack, keeps auth in the Worker (membership check before upgrade, same rule as today), and avoids a second realtime vendor. Fallback if Durable Objects are not wanted: Supabase Realtime, since Supabase is already connected. Polling every 10s is acceptable for v1 of the feed; chat should be live.

### Safety (members are 13+, many are minors)

These are design constraints, not a later phase:

- Team owner (coach) can read every channel. No hidden channels.
- No one-to-one DMs involving an adult and a minor. Group chats of 3+ only, and owners can see them.
- Report on every message, mute per channel, owner can remove messages and members; removed messages keep an audit row for 90 days.
- Retention: messages deleted after 12 months (configurable by the owner down to 30 days).
- Links show as plain text (no previews, no image unfurls); image upload is out of v1.
- Delete-my-data already exists; extend it to messages and reactions.
- Rate limits per person per minute, and a word filter hook the owner can enable.

## 7. Training and the AI coach

References: Strava (feed, kudos, clubs, AI summarising the last 30 days of activity), Runna (plans adjust automatically as sessions complete). Kestrel already does the adaptive plan with guardrails, which is the harder part; the gaps are presentation and social.

- **Home of Train** is *today*: one big card (workout, why, how it should feel, "can't do this" and "ask coach"). The week is a horizontal strip; the full week list is a sheet.
- **Run cards** after a synced run: pace, effort vs plan, a one-line coach note from the hawk avatar, share to team toggle.
- **Weekly review**: a Sunday card from the coach: what changed, what moves next week, and why.
- **Coach chat** is a bottom sheet on any Train screen rather than a segment of the page.
- **Fitness** screen leads with the three or four numbers an athlete cares about (5K estimate, VO2max, readiness), with the table behind "All events".

## 8. Kestrel Lab

References: Hugging Face (model repos are git-backed; each repo has a Model card tab and a Files and versions tab), GitHub (repos, forks, releases, contents API), Cline (open source; bring your own keys; Plan mode is read-only and Act mode edits with approval; built-in MCP marketplace).

### Pages

- **Home**: search, task filters, trending, "Your models", a "Start from a template" row.
- **Model page**: header (owner/name, task, licence, version, uses), tabs **Model card · Files & versions · Try it · API · Lineage**. Actions: Use in my account, Fork, Import, Push.
- **Files & versions**: `kestrel.json` + `README.md`; each upload is a new immutable version with a diff of metadata and weight summary. `base_model` already exists in the schema and powers **Lineage** (forks and fine-tunes tree).
- **Workbench** (the Cline analogue): choose a model, run it against *your* race history ("Plan" = dry run showing predictions and error against your actual results; "Act" = set as your default). Nothing changes without approval.
- **Providers**: the bring-your-own-AI keys UI, moved here from the main app, with MCP connections listed (Kestrel already exposes `/mcp/`).

### Import and export (Hugging Face and GitHub)

Constraint to keep: models are **numbers, never code**. Every import goes through the existing `validateModel` in `src/models.js` (kind/task rules, 1 MB limit, 20-model limit). Imported repos are never executed; only a `kestrel.json` and a `README.md` are read.

**Import**

- Input: `owner/name` or a full URL for Hugging Face or GitHub, with optional ref (branch, tag, commit).
- Fetch happens **in the Worker**, not the browser (no CORS dependence, no token in the page).
- GitHub: `GET /repos/{owner}/{repo}/contents/{path}?ref=`. Per the GitHub docs, files up to 1 MB are fully supported by this endpoint, which is exactly Kestrel's model size cap. Private repos need a user token with `repo` scope.
- Hugging Face: read `kestrel.json` and `README.md` from the repo's `main` (or given revision) via the Hub's file-resolve URL, and the repo's metadata via the Hub API. Private or gated repos need a Hugging Face access token. **Before building:** confirm exact endpoints against the Hub OpenAPI spec (`https://huggingface.co/.well-known/openapi.json`), which the Hub docs name as the source of truth; I did not verify the resolve URL shape in this pass.
- Mapping: HF model-card YAML (`license`, `base_model`, `tags`, `datasets`) → Kestrel `license`, `base_model`, `trained_on`; README body → `readme`; repo URL stored as `source_url` so "update from source" is one click.
- A repo with no `kestrel.json` shows "this repo has no Kestrel model file yet" with a download link to a template and a validator in the browser.
- Dry-run first: show the validation result and the card diff, then a confirm button.

**Export**

- "Push to GitHub": `PUT /repos/{owner}/{repo}/contents/kestrel.json` (and `README.md`) with base64 content, a commit message, and the file's `sha` to update an existing file. Run the writes serially; the GitHub docs warn that parallel PUT/DELETE calls conflict.
- "Push to Hugging Face": create the model repo if absent and commit the two files with a write-scoped token (Hub commit API, again to be verified against the OpenAPI spec).
- Tokens: stored the way intervals.icu keys are today (AES-GCM, `KESTREL_SECRET`), with a "forget token" button, or used once and discarded (default).
- A `kestrel.json` is also a plain file, so GitHub Actions or `huggingface-cli` can sync it; Lab docs include a three-line example.
- Optional later: webhook so a push to the linked GitHub repo publishes a new Kestrel version automatically.

## 9. Sources used

- Heja features: [help.heja.io main features](https://help.heja.io/getting-started-with-heja/what-are-hejas-main-features), [App Store listing](https://apps.apple.com/app/id1157335714)
- TeamSnap features: [teamsnap.com/teams/features](https://www.teamsnap.com/teams/features)
- Strava and Runna: [5krunner on Athlete Intelligence](https://the5krunner.com/2024/10/03/strava-athlete-intelligence-subscribers/), [Runna overview](https://the5krunner.com/runna/)
- Cline: [fast.io explainer](https://www.fast.io/resources/what-is-cline.md), [MCP client notes](https://learn.engineering.vips.edu/mcp/mcp-cline-client)
- Hugging Face: [Hub API docs](https://huggingface.co/docs/hub/api), [downloading models](https://huggingface.co/docs/hub/models-downloading), [upload guide](https://huggingface.co/docs/huggingface_hub/guides/upload)
- GitHub: [REST contents API](https://docs.github.com/en/rest/repos/contents)

Search coverage was thin on Strava's current feed and Whoop; the plan relies on well-known product behaviour there and does not copy any of it.

## 10. Roadmap

Each phase ships on its own and leaves the app working.

| Phase | Content | Size |
|---|---|---|
| **0. Fix what the push broke** | Hide landing for signed-in users (route it to `/welcome` or show it only signed out); fix hero clipping; one `.k-btn`; correct plan-level copy; fix tab-label collision; "not on a team" empty state instead of a network error; rename `hawks*` storage keys (with migration read); fix coach prompt copy. | S |
| **1. Design system** | `public/ds/*` (tokens, base, components, hawk sprite), living style guide, final hawk redraw (header, avatar, empty, loading, favicon). New tokens aliased over old names so nothing breaks. | M |
| **2. App shell** | Bottom tab bar / desktop rail, new header, Kestrel · Lab switcher. Port screens one at a time: Schedule → Train → You. Delete `kestrel.css` overrides screen by screen; split `index.html` into per-view modules as each moves. | L |
| **3. Team** | Migration `0003`, Feed with RSVP cards and announcements, reactions, seen-by, then chat via Durable Object, then safety tooling and retention. | L |
| **4. Lab** | Dense shell, model page tabs, versions and lineage, Import (GitHub first, then Hugging Face), Export, Workbench, Providers moved from the main app. | L |
| **5. Landing and brand** | Rebuilt landing with the hawk, real product screenshots instead of emoji demo boxes, Lab landing copy. | S |

Risks:
- `index.html` is a 6.8k-line monolith with global state; the port will find coupling. Mitigation: port per view and keep the old view alive behind the same tab until the new one is done.
- Chat with minors needs a decision from you on moderation (section 6) before phase 3 starts.
- Hugging Face write endpoints are unverified (section 8).

## 11. Open questions

1. Is a coach (team owner) reading all channels acceptable for your target schools? The plan assumes yes.
2. Durable Objects for chat (recommended) or Supabase Realtime?
3. Lowercase `kestrel` wordmark with the hawk, or keep `KESTREL` in caps?
