# Prompt: Kestrel design system, from good to great

Target: Claude Code, run from the repo root. Audit data below measured on 2026-11-16 against the local build (`kestrel-local` + `auth-stub`), dark and light, 375px and 1024px.

---

<role>
You are a senior design engineer who owns Kestrel's design system. You take visual risks in prototypes, and you are strict about consistency in production code. Your job is to make the system tighter: fewer values, one rule for each decision, and the existing strengths applied everywhere.
</role>

<context>
## Locked decisions (do not relitigate)
`docs/redesign-plan.md` §3 is settled:
- Black and red. Red only for the single primary action per screen and the hawk's eye.
- Radius scale 8 / 12 / 16 / 24 / 32 / pill. Buttons and chips are pills, cards are 24, inputs are 16, sheets are 32.
- Fonts: Bricolage Grotesque for display, Inter for UI, JetBrains Mono only for race times, paces and keys.
- No hand-drawn layer.
- The hawk carries the brand.
- Light and dark are both first-class.

## Where the system already shines (protect and spread these)
- **The Today hero.** `.kv-run` / `.kv-runh` in `public/ds/views.css:91-94` and `public/views.js:124-152`:
  - an inverse card holding a huge "Easy 5.5 mi" headline (display weight with mono miles)
  - eyebrow metadata
  - a single red "Start run"
  - the 7-day `.kv-wk` strip below
  This is the system at its best: one inverse block, one red action, data typeset like a number.
- **The logo and hawk.** `public/kestrel.svg`, the header mark, and the large hawk line drawing on the landing page.
- **The token architecture.** `public/ds/tokens.css` has three layers: primitive, semantic and legacy. The drift is in the files that consume it, not in the tokens.

## Measured drift (starting state)

**Radius**
- Live off-scale radii: 3px (calendar dots, body bars), 9px (img), 18px (`.k-bubble.kai`), 20px (`.kv-bodymap`), 34px (Today buttons), 36px (`.kv-nav`).
- Source literals that bypass tokens: 12px ×10, 14px ×9, 4px ×7, 3px ×6, 20px ×4, 9px ×3, 99px ×3, 2px ×3. Plus singletons: 2.5, 5, 6, 10, 18, 28, 30, 34, 36 and 38px, and mixed-corner bars like `6px 6px 3px 3px`.

**Type**
- 13 live font sizes on Today alone: 11, 12, 13, 13.5, 14, 15, 16, 17, 18, 19, 22, 24 and 41.6px.
- Source also has 10.5, 12.5, 14.5, 15.5 and 16.5px, plus rem values.
- Mono is used beyond times: the 1–10 feel scale, "Not set" for sleep, and 15 mono text nodes on Body.

**Inline styles and colour**
- 121 `style=""` in `public/index.html`, about 100 more across `views.js`, `views2.js`, `track.js`, `kestrel.js`, `shoes.js` and `dayview.js`.
- 95 raw 6-digit hex in `index.html`.
- 19 `!important`, 10 of them in `views.css`.

**Text leaving boxes**
- At 1024: the header overflows `#kApp.wrap` by 28px.
- At 375:
  - the header and `.page-tabs` both overflow by 14px
  - Lab's sub-nav ("Workbench") runs 2px past the viewport
- Ellipsis clipping:
  - Body: "Readiness", "Resting HR"
  - Team: "Last week" and athlete names (88 < 106px)
  - Today: "Nothing yet this week" (122 < 131px)
- `.kv-link` chevron sits 2px outside its row.

**Theme**
- Nothing in the app sets `data-theme`, so the app follows the OS appearance, as HIG Dark Mode asks.
- `public/index.html` still has legacy `prefers-color-scheme:dark` variable blocks that `tokens.css` overrides. They are dead weight.
- Light theme: sidebar nav labels and some secondary text fall below 4.5:1.

**Touch targets (375px)**
- 14 targets are under 44×44 on Today and Body:
  - the 1–10 feel buttons are 26×40
  - `.kv-nav` is 36×36
  - the avatar is 36×40
  - the brand mark is 28×28

**Layout**
- Today at 1024: the "Off the run / Team today / Kestrel AI" row has uneven columns. The status chips wrap "Sick" onto its own line. The sidebar's active pill is a translucent grey, unlike the cream selected state used everywhere else.
- Today at 375: the Kestrel AI card is not shown.
</context>

<task>
Work in two phases. Stop between them.

## Phase 1: Audit and proposal (read-only, no source edits)

1. Load these skills before starting, and use each for its named part:
   - `design:design-system` for the token and naming audit
   - `design:design-critique` for hierarchy and where the system is generic
   - `design:accessibility-review` for contrast and targets
   - `anthropic-skills:built-in-browser` to drive the preview
2. Read the Apple guidance and cite what you apply:
   - HIG Typography: https://developer.apple.com/design/human-interface-guidelines/typography
   - HIG pages for layout, color, dark mode, materials, tab bars, buttons and accessibility under the same path. Fetch each one, and confirm the URL resolves before you cite it.
   - The WWDC25 "Meet Liquid Glass" session: https://developer.apple.com/videos/play/wwdc2025/219/. Use it for the material and tab-bar treatment on phone.
   - Icon Composer: applies only to `apps/icon/`, the Capacitor iOS shell.
   - The Figma UI kits need the Figma connector authorised with `/mcp`. If it is not, skip them and say so.
3. Re-run the measurements:
   - **Setup:** start `auth-stub` and `kestrel-local` from `.claude/launch.json`, then run `npm run migrate:local`. Sign in with any email and the stub password from `scripts/auth-stub.mjs`. Seed a profile with `PUT /api/me` and a plan with `PUT /api/me/plan`, so Today shows a real workout.
   - **Matrix:** cover every screen (Today, Run, Calendar, Body, Team, the Lab landing, the signed-out landing page, onboarding) at 375 and 1024, under OS dark and OS light.
   - **Check script:** save the DOM check you use as `scripts/design-lint.js`. It is a browser-console script that reports:
     - text with `scrollWidth > clientWidth`
     - children escaping their parent
     - distinct live border-radius values
     - distinct font sizes and families
     - contrast below 4.5:1 (3:1 for 18px and larger)
     - targets under 44×44 at 375px
4. Write `docs/design-audit.md` with three sections:
   - **Findings:** a table with columns for where (file:line), what, measured value, and severity.
   - **What's distinctive:** what to keep and spread.
   - **Proposal:** for each item, the change, the token or rule it uses, and the files it touches.

   Include a proposed **type scale** of at most 7 named sizes, mapped to tokens in `tokens.css`. Fill in the sentence the user left unfinished, "places where…", as: places where the system is generic or inconsistent and Today's treatment should replace it.
5. Put risky ideas in throwaway prototypes under `docs/prototypes/`, or in the existing `docs/design-system-preview.html`, never in production files. Examples: the inverse hero pattern as the card style for every screen's primary block, and the hawk in empty and loading states.

**Stop condition for Phase 1:** post a summary of at most 10 bullets plus the path to `docs/design-audit.md`. Then wait for an explicit "go", or for a subset of proposals to implement.

## Phase 2: Implement the approved proposals

- Route every radius, colour, font size and shadow through `public/ds/tokens.css`.
- Replace literals in consuming files. Where you touch an inline `style=""`, move it into a class.
- Remove the dead legacy colour variables in `index.html` that `tokens.css` already overrides; `tokens.css` owns theming.
- After each screen, re-run `scripts/design-lint.js` across the full matrix, and take a 375 and a 1024 screenshot of it.
</task>

<constraints>
- **Editable files:** `public/ds/*.css`, `public/kestrel.css`, `public/lab/lab.css`, the markup and class names in `public/*.js` and `public/index.html`, and `docs/`. Edit `apps/icon/` only if an icon change is approved.
- **NEVER touch:** `src/`, `migrations/`, `wrangler.jsonc`, `llm/`, `models/`. Never deploy, never push, never commit to `main`.
- **Licensing:** NEVER bundle SF Pro, SF Compact or SF Symbols into `public/`. Apple's font licence forbids embedding them in products. `public/` is served to Android and desktop browsers too, and the SF Symbols web terms are unconfirmed. Apply HIG principles, not Apple assets.
- **Ask first:**
  - before adding a font, a dependency, or a new colour primitive
  - before removing any user-facing feature
  - before changing copy beyond fixing truncation
- **Scope:** only make changes that serve consistency, the measured bugs, or approved proposals. No new features.
</constraints>

<done_when>
All of these must hold, checked by `scripts/design-lint.js` across the full matrix (every screen, 375 and 1024, OS dark and OS light):
- Zero text overflow or clipping, except intentional single-line ellipsis that has a `title` attribute.
- Zero children escaping their parent.
- No horizontal scroll at 375.
- Live radii are only 8, 12, 16, 24, 32, 999px and 50%.
- Font sizes are only the approved scale. JetBrains Mono appears only on times, paces and miles values.
- No text below 4.5:1 contrast (3:1 for 18px and larger).
- Every interactive target is at least 44×44 at 375.
- `grep -c 'border-radius:[0-9]'` on the edited CSS files reports no new literals.
- Inline `style=""` and raw hex counts are reported before and after, and both go down.

Report the final lint output, the before/after counts, and screenshots of Today, Body and Team at 375 in both themes.
</done_when>
