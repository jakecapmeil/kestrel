# Kestrel design audit

Measured on 2026-11-16 against the local build (`kestrel-local` and `auth-stub`), with a test athlete on a seeded 35 mi plan and a one-person team.

**Coverage:**
- Screens: Today, Run, Calendar, Body, Team, Lab landing, the signed-out landing page, and onboarding.
- Widths: 375 and 1024.
- Themes: OS dark and OS light. The `data-theme` override was also checked; see finding T3.
- Tool: [`scripts/design-lint.js`](../scripts/design-lint.js), run in the browser console.

**Apple guidance used.** The HIG pages render client-side, so they were read through their JSON endpoints (`developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json`). Rules applied:
- **Buttons, Accessibility:** hit targets at least 44×44 pt. Contrast at least 4.5:1, or 3:1 for text 18 pt and up or bold. No more than one or two prominent buttons per view.
- **Typography:** a small set of built-in text styles; hierarchy from weight, size and colour, not from many sizes. iOS default text styles: Large Title 34, Title 1 28, Title 2 22, Title 3 20, Headline and Body 17, Callout 16, Subhead 15, Footnote 13, Caption 12 and 11.
- **Dark Mode, Color:**
  - Use semantic, adaptive colours, never hardcoded ones.
  - Test both appearances.
  - Don't offer an in-app appearance setting that overrides the system.
- **Materials, Tab bars:**
  - Translucent material belongs to the navigation layer only.
  - Tabs have one-word labels.
  - Keep the tab bar visible.
- **App icons:** square, unmasked layers; the system applies the corner mask. This is relevant to `apps/icon/` only.
- **Not used:** SF Pro, SF Compact and SF Symbols. Apple's font licence forbids embedding them in products, and `public/` is also served to Android and desktop browsers.

---

## 1. What is distinctive (keep it and spread it)

| Pattern | Where | Why it works |
|---|---|---|
| **The inverse hero.** One block flips the theme: a black card on light, a cream card on dark. It holds a display headline ("Easy **5.5 mi**"), an eyebrow line of metadata, and a single red primary action. | Today, `.kv-run` / `.kv-runh` (`public/ds/views.css:91-94`, `public/views.js:139-145`) | It is the only place where one screen has one obvious subject. It follows HIG Buttons: one prominent action. The theme flip creates hierarchy without adding a colour. |
| **The week strip.** Seven tiles with day, type and miles; today is filled with the inverse colour. | Today `.kv-wk` | It turns the plan into something you can scan at a glance. The inverse fill is the same "this one" signal as the hero. |
| **The hawk.** A line-drawn kestrel with a red eye dot. | Header mark, landing hero, `public/kestrel.svg` | The red eye is the only decorative use of red, which is exactly what the colour rule says. |
| **Three-layer tokens.** Primitive, then semantic, then legacy. | `public/ds/tokens.css` | Dark mode swaps only the semantic layer. The structure is right; the problem is the files that bypass it. |
| **The mobile tab bar.** Five one-word tabs. The selected tab's icon sits in an inverse pill. | `public/ds/shell.css:26-45` | Matches HIG Tab bars, and reuses the inverse-equals-selected signal. |

**Where the system is generic or inconsistent, so Today's treatment should replace it.** Run, Body and Team each open with a run of identical grey cards. Nothing on those screens carries the inverse hero, so no screen except Today has one obvious subject. Several things use a different "selected" signal:
- the desktop rail's active item is an inverse pill (good)
- chips use an inverse fill (good)
- `.seg-btn.active` uses a raised surface
- the onboarding step bar uses red

The proposal below makes inverse the single selected signal and gives Run, Body and Team one inverse block each.

## 2. Findings

Severity:
- 🔴 a user cannot read or use something
- 🟡 visibly sloppy, or fails a guideline
- 🟢 consistency debt

### Bugs

| # | Where | What | Measured | Sev |
|---|---|---|---|---|
| B1 | `public/views2.js:182,188` | When there is no readiness score, Body shows the literal text **"null"** in the Readiness tile, and the subtitle reads "Readiness null · …". | `rd.score === null` | 🔴 |
| B2 | Landing at 375, light theme | The hawk line drawing sits **on top of the lede paragraph**; the stroke crosses the text. | Visual | 🟡 |
| B3 | Landing at 1024 | The headline's minimum width pushed the sign-in card 6px out of the grid. `1.35fr 1fr` columns could not shrink below the 104px "together." | 6px | 🟡 |

### Contrast (WCAG 1.4.3; HIG Accessibility)

| # | Where | What | Measured | Sev |
|---|---|---|---|---|
| C1 | `tokens.css` `--text-2` (light) = `ink-500 #6b6b73` | Secondary text fails on `--surface-2`. Seen on segment buttons, tile labels, "of 36 mi", "Not enough data" and "Last week". | 4.28:1 | 🟡 |
| C2 | `tokens.css` `--accent` (light) = `red-500 #e1371a` | White text on red buttons ("Start run", "Send", "Post", "Add a run") fails. | 4.41:1 | 🟡 |
| C4 | Lab header, "lab" in the wordmark (dark theme) | `red-400` on the cream inverse header. | 2.76:1 | 🟡 |

### Text leaving boxes

| # | Where | What | Measured | Sev |
|---|---|---|---|---|
| O1 | Body, health tiles | "Readiness" and "Resting HR" are clipped with an ellipsis and no `title`. | 50 < 58, 50 < 61px | 🟡 |
| O2 | Team | "Last week" and athlete names are clipped. | 52 < 57, 88 < 106px | 🟡 |
| O3 | Today, Off the run | "Nothing yet this week" overflows its tile. | 122 < 131px | 🟡 |
| O4 | `.kv-link` rows | The `›` chevron sits outside the row. | 2px | 🟢 |
| O6 | Lab at 375 | The sub-nav ("Workbench") runs past the viewport with no scroll affordance. | 377 > 375 | 🟡 |

The header "overflow" reported in the first pass is an intentional full-bleed negative margin, not a bug. The lint now ignores negative-margin bleeds.

### Corners (radius scale 8 / 12 / 16 / 24 / 32 / pill)

| # | Where | Measured | Fix |
|---|---|---|---|
| R1 | Today buttons (`.kv-btns button`) | 34px | Pill |
| R2 | Calendar `.kv-nav` | 36px | Pill |
| R3 | Week strip `.kv-wk` | 14px (phone), 18px (desktop) | `--r-md` (16), concentric inside a 24 card |
| R4 | Body map `.kv-bodymap` | 20px | `--r-lg` |
| R5 | Header logo `img`, avatar marks | 9px | `--r-xs` |
| R6 | Calendar dots `.i1`–`.i4`, chart bars | 3px | Pill (they are marks) |
| R7 | AI bubble `.k-bubble.kai` | 18px | `--r-lg` |
| R8 | Landing phone mocks | 38, 30, 18, 13px | 32, 24, 16, 12 |
| R9 | Source total | 79 px-literal radii across 30 distinct values | All through `--r-*` |

### Type

| # | Where | Measured | Sev |
|---|---|---|---|
| T1 | Live app | Up to 11 off-scale sizes on one screen. Today at 375 uses 10, 11.5, 12, 13.5, 14, 16, 18, 19, 22, 26 and 26.6px. Source has 182 `font-size` literals and 168 `font:` shorthands with px sizes. | 🟢 |
| T2 | Mono | Mono is used for words, not numbers: "Not set" (sleep stepper, `views.css:87`) and the 1–10 feel scale (`views.css:102`). The plan says mono is for times, paces and miles only. | 🟡 |
| T3 | `public/index.html:115,459,875,1361` | Four legacy `prefers-color-scheme:dark` blocks with about 95 raw hex colours. `tokens.css` overrides them, so they are dead weight. Nothing in the app sets `data-theme`, so there is no in-app override today. Per HIG Dark Mode, keep it that way. | 🟢 |

### Touch targets at 375 (HIG minimum 44×44)

| # | Where | Measured |
|---|---|---|
| H1 | Feel scale, 1–10 | 26×40, ten in a row |
| H2 | Sleep stepper −/+ | 34×34 |
| H3 | Status chips, segment buttons | 34 tall |
| H4 | Today buttons ("Start run", "Can't do this", "Ask Kestrel AI") | 38 tall |
| H5 | Header controls | Team picker 34, "+ Team" 30, Record 40, avatar 36×40, logo 28×28, Run/Lab switch 30 |
| H6 | Calendar `.kv-nav` and day cells | 36×36, and 35×58 cells |
| H7 | `.kv-link` rows | 35 tall |

The lint counts 11–42 targets under 44 per screen at 375.

### Source debt (before)

| Measure | Count |
|---|---|
| `style="` attributes (`index.html`, `*.js`) | 230 |
| 6-digit hex | 187 |
| px radius literals | 79 |
| `font-size` literals | 182 |
| `font:` shorthands with px sizes | 168 |
| `!important` | 20 |

## 3. Proposal

### Type scale

Seven sizes, modelled on the HIG text styles and named for their role. Added to `tokens.css`.

| Token | Size | HIG analogue | Use |
|---|---|---|---|
| `--fs-caption` | 11px | Caption 2 | Eyebrows, tab labels, units |
| `--fs-footnote` | 13px | Footnote | Secondary lines, meta, small buttons |
| `--fs-subhead` | 15px | Subhead | UI default: buttons, rows, chips |
| `--fs-body` | 17px | Body and Headline | Inputs (16px or more stops iOS focus zoom), card titles |
| `--fs-title3` | 20px | Title 3 | Section titles |
| `--fs-title2` | 24px | Title 2 | Stat numbers, dialog titles |
| `--fs-display` | `clamp(34px, 5vw, 56px)` | Large Title and up | Page titles, the hero headline |

Old values map as follows:

| Old size | New token |
|---|---|
| 10–11.5 | caption |
| 12–13.5 | footnote |
| 14–15.5 | subhead |
| 16–18 | body |
| 19–22 | title3 |
| 24–28 | title2 |
| 30 and up | display |

Hierarchy comes from weight (500 / 600 / 800) and from `--text` against `--text-2`, not from extra sizes.

### Changes

| # | Change | Rule or token | Files |
|---|---|---|---|
| P1 | Fix "null" readiness. | Show "–" when there is no score. | `views2.js` |
| P2 | Fix light-theme contrast. | Darken the `ink-500` primitive to `#5f5f67`: 5.12:1 on `surface-2`, 5.66:1 on `bg`. Light `--accent` becomes `red-600` (white text 5.36:1); hover becomes `red-700`. Both are existing primitives. | `tokens.css` |
| P3 | Add the type scale; route every size through it. | `--fs-*` | `tokens.css`, `ds/*.css`, `kestrel.css`, `lab.css`, `index.html`, `*.js` |
| P4 | Route every radius through the scale. | `--r-*` | Same |
| P5 | Mono only for numbers. | `--font-ui` with `font-variant-numeric: tabular-nums` for the feel scale and stepper labels. | `views.css` |
| P6 | Make phone targets at least 44. | Feel scale becomes a 5×2 grid. Stepper, chips, segments, buttons, `.kv-nav` and `.kv-link` get `min-height: 44px`. Header controls are 44 tall. Calendar cells use the full card width. | `views.css`, `shell.css`, `components.css` |
| P7 | No silent clipping. | Health and Team tile labels wrap to two lines. Single-line ellipses carry a `title`. | `views.css`, `views2.js` |
| P8 | Fix the landing hero on phones. | On phones the hawk drawing moves below the copy, so text never sits on top of it. Fix the link contrast and the Google button colour. | `index.html` |
| P9 | Lab sub-nav at 375. | Horizontal scroll with snap and edge fade, like `.nav-head .seg`. Fix the "lab" wordmark contrast. | `lab.css` |
| P10 | Remove the dead legacy dark blocks in `index.html`. | `tokens.css` owns theming. | `index.html` |
| P11 | One "selected" signal: inverse. | `.seg-btn.active` uses `--inverse` / `--on-inverse`, like chips, the rail and the tab bar. | `components.css` / `kestrel.css` |
| P12 | Spread the inverse hero. Prototype first in [prototypes/inverse-hero.html](prototypes/inverse-hero.html). | Run gets this week's miles as its inverse block, Body gets readiness, Team gets today's practice. | Prototype only until approved |

P1–P11 are fixes and consistency work. P12 changes layout on three screens, so it stays in the prototype.

---

## 4. Results (Phase 2, implemented)

P1–P11 are done. P12 stays in [prototypes/inverse-hero.html](prototypes/inverse-hero.html) for review. That prototype has not been opened or rendered yet.

**Lint.** [`scripts/design-lint.js`](../scripts/design-lint.js) covered:
- Every segmented sub-view of Today, Run, Calendar, Body and Team, 15–16 views per width:
  - at 320, 360, 375, 768 and 1024
  - at 375 and 1024 in both OS dark and OS light
- Also checked:
  - the landing page and Lab, at 375 and 1024
  - all seven onboarding steps
  - the profile screen and its four tabs
  - the "+ Team" screen
  - the Record screen
  - the Customize Run dialog
  - the `?app` start screen

Counts come from [`scripts/design-counts.sh`](../scripts/design-counts.sh). The data is one athlete on a one-person team with no logged runs, so screens that only render with teammates, runs or PRs (the roster with many athletes, run detail, PR tables) were not exercised.

| Check | Before (worst screen) | After |
|---|---|---|
| Text overflow or clipping | 4 | 0 |
| Children escaping their box | 2 | 0 |
| Off-scale radii | 6 values | 0 |
| Off-scale font sizes | 11 values | 0 |
| Mono on words | 2 | 0 |
| Contrast below AA | 17 (light)¹ | 0 |
| Phone targets under 44 | 42 | 0, except 7-column day grids (see below) |
| Horizontal scroll | 0 | 0 |

**Source counts.**

| Measure | Before | After |
|---|---|---|
| `style="` attributes | 230 | 177 |
| 6-digit hex | 187 | 121 |
| px radius literals | 79 | 0 |
| `font-size` literals | 182 | 0 |
| `font:` shorthands with px sizes | 168 | 0 |
| `!important` | 20 | 19 |

¹ The first-pass lint read `color-mix()` backgrounds as black. Of these 17, the real failures were:
- C1, `--text-2` on `--surface-2` at 4.28:1, which accounts for most of the count
- C2, white on red at 4.41:1
- C4

The tab-bar labels (5.24:1) and the 1.08:1 items were parser errors.

Every size now goes through the scale, including the display sizes: the Today hero, Lab stats and results, and the onboarding titles. The one exception is the landing and marketing headlines (`.k-display`, `.k-title`, `.k-section-title`), which keep their own larger fluid `clamp()` sizes of up to 104px. That is a deliberate marketing scale beyond `--fs-display`, not part of the app's scale.

**Exception: 7-column day grids.** The calendar day cells are 35×58 at 375, and the Today week strip is 38×69 at 320. Seven day columns plus the weekly-total column cannot reach 44px wide on a 375px phone. That would need about 370px of content width for 343px available. The cells meet the HIG *minimum* (28×28) and are tall. To reach 44 wide, either hide the weekly-total column on phones or make the calendar card full-bleed. Both change the layout, so neither is done without a decision. The week strip has the same limit at 320.

**Corrections to the first pass.**
- There is no in-app Light/Dark override. Nothing sets `data-theme`, so the "hero headline invisible at 1:1" seen in the first pass was caused by my manual toggle, not by the app. Per HIG Dark Mode, the app should keep following the system.
- The "Front" label on the body map was a lint false positive: it sits on a gradient, which the first lint could not measure.
- Several landing and Lab "contrast failures" were captured mid-way through an entrance animation.
- The lint now skips gradients and parses `color(srgb …)` values.

**Found by the deeper sweep and fixed.** Most of these were broken before this pass, in narrow desktop columns or at 320:
- **Run → Fitness:** the training paces were forced into 4 columns of 53px, so labels overflowed. They now use an auto-fill grid.
- **Run → Fitness:** the prediction ± sat beside the time and overflowed. It now sits under the time.
- **Body → Fuel:** the macro bars collapsed to 14px beside the ring. They now wrap under it.
- **Body → Cross-train:** the stat tiles clipped "0 min". Tiles now use an auto-fit grid.
- **In-card segments** wrapped mid-label ("Based / on"). They are now single-line and scroll.
- **Goals:** a hint ran outside its row.
- **Smaller fixes:**
  - "+ Add" was set in mono.
  - Accent swatches were 36px, a height no other control uses.
  - Three button groups used a 40px height. Buttons are now 34 or 44 only.
- **At 320:**
  - The header wrapped onto three rows and clipped the Run/Lab switch. Below 370px, Record now shows only its dot (it keeps its aria-label).
  - Segment buttons were under 44px wide.
- **Too-small targets:**
  - onboarding goal chips (28px)
  - the `?app` page dots (22px; now true 44px targets, so the dots sit further apart)
  - Fuel's select (40px)
  - the Roster "Edit" link

**Notable decisions.**
- **Type sizes are in rem**, matching the existing HIG scale in `index.html`, so the browser text-size setting still scales the app.
  - The old HIG names (`--fs-footnote`, `--fs-caption2`, …) are aliases onto the seven sizes in `tokens.css`.
  - The new names are size-ordered (`--fs-xs` to `--fs-2xl`, plus `--fs-display`), like the radius scale.
- **Touch layouts:**
  - Controls grow to `--tap` (44px) only below 1024px; desktop keeps its denser 34px controls.
  - The phone header logo gets a 44px hit area through padding with a negative margin, so the header still fits on one row.
- **One selected signal:** segmented controls, chips, the tab bar, the rail and the week strip all use `--inverse`.
- **Dead code removed:** 79 dead legacy colour variables in `index.html` (light and dark) that `tokens.css` already overrode.
- **New tokens:**
  - `--accent-on-inverse`, for red text on an inverse block such as the Lab wordmark.
  - `--tap`.
  - `ds/utilities.css`, which holds the classes that replaced repeated inline styles.

---

## 5. Round two (after review)

**P12 shipped.** The inverse hero is now one helper, `hero()` in `public/views.js`. Each main screen opens with one:

| Screen | Hero content |
|---|---|
| Today | Today's run |
| Run → Plan | Miles this week against the plan, a progress bar, runs left, and the key session |
| Body → Recovery | The readiness label and score, or "Check in" until there is enough data, plus the resting HR, sleep and body-map summary |
| Team → Feed | Today's practice. If there is none, the next event within a week, plus the team's miles |

- "No team yet" screens show the hawk empty state (`empty()` / `noTeam()`) instead of a grey sentence.
- Today's hero dropped "Can't do this". It only opened Kestrel AI with a prefilled line, so "Ask Kestrel AI" covers it.

**Rows never wrap.** A row of buttons or chips stays on one line. If it doesn't fit, it scrolls sideways like a slider. This applies to:
- `.kv-btns`, `.kv-chips`, `.k-row`, `.k-toolbar`, `.k-dialog-foot`
- `.k-chips`, `.k-accents`, `.cluster`
- `.split-quick`, `.split-add`, `.kv-snap-row`, `.k-power`, `.lab-seg`, `.cal-toolbar-left`

How it behaves:
- Inside a card, a row runs to the card's edge, so the cut-off shows there is more.
- A row that actually scrolls fades at its edge, through a scroll-driven animation. It is not verified visually, because the hidden preview pane doesn't advance animation frames.
- Phone dialog footers keep the destructive link on the same row and tighten the button padding, instead of pushing the link onto a second line.
- The lint now has a `wrapped` check that flags any flex row of controls that wraps.

**7-column grids.**
- On phones the month calendar runs edge to edge, like the iOS Calendar, with a 2px gap and a 26–30px totals column. Day cells are 44px or wider at 360px and up.
- The Today week strip uses a 4px gap.
- The remaining exception is the week strip at 320px: 38×69, above Apple's 28pt minimum.

**Data-dependent screens.** I seeded four teammates, nine days of runs, PRs, three events and two posts through the local API. That surfaced and fixed:
- Initials on the lightest team colours were 3:1. Avatars now get a 25% shade from a `--av` colour, which puts every palette colour at 5:1 or better.
- On Today's inverse tile, a done day's miles were green on black at 3.1:1.
- Schedule RSVP and icon buttons were 36px.
- The day page's "‹ Back" was 18px tall, and its quick-rep and add-set rows wrapped.
- Event titles in the team month view were 21px-wide chips. Narrow months now show coloured dots, through a container query.
- Meet chip text was 4.3:1.
- Long event names overflowed plan pills. They now get an ellipsis and a `title`.
- Truncated post authors now get a `title`.

**Lab sub-pages** were checked for the first time:
- A long model tag overflowed its card.
- The filter and import segment buttons were 34px.
- The selected segment now uses the inverse style, like the rest of the app.

**Type.** The landing headline uses `--fs-hero`, a marketing-only token. Lab, onboarding and record-stat sizes go through the scale. There are no px size literals left. The live-run timer (`.rec-big`) is the one deliberate exception, a readout meant to be read at arm's length.

**Copy.** The sign-in link "New here? Create an account" is now "Create an account", and "Have an account? Sign in" is now "I have an account", so the two links fit on one row at 375px.

**Final lint.** Every check passes on:
- the app's 16–17 views, at 320, 360, 375, 768 and 1024px, in light and dark, with seeded data
- the landing page, all nine Lab pages, all seven onboarding steps, the profile tabs and four dialogs

The only exception is the 320px week strip.
