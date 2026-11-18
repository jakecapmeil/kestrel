# Modules: choosing your tools

Kestrel does a lot: a plan, a coach, race estimates, fueling, a team calendar, shoe miles, GPS recording. A high school sophomore on a cross country team and a 40-year-old training for a marathon use almost none of the same screens. So every tool that isn't essential is a **module** a runner can turn off, in **You → Settings → Customize Kestrel**.

Turning a tool off **only hides it**. Nothing is deleted, nobody leaves a team, the plan guardrails and run summaries keep working, and what teammates can see doesn't change. Turning it back on brings everything back.

The list lives in one place, [`src/train/modules.js`](../src/train/modules.js). The server validates against it and sends it to the app with `/api/me`; the nav, the menu and the coach all read the same list. What a runner saves is the list of modules that are **off** (`prefs.modules_off`), so a tool added later is on for everyone until they choose otherwise.

## Classification

**Core: always on.** Today, Run → Plan, Calendar → Training (the log), and You (Profile, Integrate, Settings). Without them the app has nowhere to land.

**Modules, in four groups:**

| Group | Module | What it owns | Hiding it leaves alone |
|---|---|---|---|
| Training | Kestrel AI coach | Run → Coach, every "Ask Kestrel AI" button, Today's check-in box | Plan guardrails, run summaries |
| | Workout library | Run → Workouts | |
| | Fitness and race estimates | Run → Fitness (estimates, VO2max, paces, taper, heat and hills) | PRs and estimates are still worked out |
| | Goals | Run → Goals | Goals already set |
| Body | Recovery and body map | Body → Recovery, Today's "How you feel" | Health status still guides plan changes |
| | Cross-training | Body → Cross-train, its tile on Today | Watch sessions still count in load |
| | Fuel | Body → Fuel, its tile on Today | |
| | Shoes | The shoe list in Profile, the shoe picker on a run | |
| Racing and team | Records | You → Records | PRs still feed estimates |
| | Team | The Team tab, Calendar → Team, "Team today", the team picker | Membership and sharing |
| Watch, phone and Lab | Watch sync | The sync button in the header | Synced runs, You → Integrate |
| | Record a run | The Record button, "Start run" buttons | |
| | Kestrel Lab | The Lab link in the header | The models behind estimates |

A tab with nothing left in it disappears (Body when its three tools are off, Team when Team is). A screen that is off is never shown: a saved link, the tab remembered from last visit, or a button that points at one lands on a screen that is on, and the coach is told which tools are hidden so it doesn't send a runner there.

## Kinds of runner

The menu opens with a row of starting points. Each is only a set of switches; any single tool can still be flipped afterwards.

| Tool | Just getting started | School or club team | Half or full marathon | Coming back | Everything |
|---|:-:|:-:|:-:|:-:|:-:|
| Kestrel AI coach | ✓ | ✓ | ✓ | ✓ | ✓ |
| Workout library |  | ✓ | ✓ |  | ✓ |
| Fitness and race estimates |  | ✓ | ✓ |  | ✓ |
| Goals | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recovery and body map | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cross-training |  |  | ✓ | ✓ | ✓ |
| Fuel |  |  | ✓ |  | ✓ |
| Shoes |  |  | ✓ |  | ✓ |
| Records |  | ✓ | ✓ |  | ✓ |
| Team |  | ✓ |  |  | ✓ |
| Watch sync / Record a run | by the watch | by the watch | by the watch | by the watch | both |
| Kestrel Lab |  |  |  |  | ✓ |

- **Just getting started:** a plan, a log, a coach to talk to, one goal and a check-in on how they feel. Nothing to configure.
- **School or club team:** the team calendar and RSVPs, the workouts their coach assigns, PRs and race estimates, no fueling or shoe tracking to manage.
- **Half or full marathon:** the long-race kit: race estimates and pace zones, the workout library, fueling for long runs, shoe miles, cross-training, no team tab.
- **Coming back:** recovery and cross-training up front, a goal to rebuild toward, nothing that adds pressure.
- **Everything:** every tool on. This is what everyone has until they choose, and it is the fallback when Kestrel can't tell.

Two rules apply on top of every preset. Watch sync versus phone recording follows the runner's watch (any watch means sync, none means Record), not their type. And a team's owner or captain always keeps Team.

### How Kestrel suggests one

From what setup already asked, in this order: coming back from injury → *Coming back*; on a team and young (22 or under, or in school) or training "with my team" → *School or club team*; a half or marathon goal → *Half or full marathon*; brand new, or under 12 miles a week → *Just getting started*; on a team as an adult → *School or club team*; 30 or older, or 30+ miles a week → *Half or full marathon*; otherwise *Everything*.

Nothing is hidden until the runner agrees. A brand-new runner sees the menu once at the end of setup with the suggestion selected, and "Show everything" or closing it keeps every tool on. Existing runners see one dismissible card on Today and never a surprise.

## Adding a tool

1. Add it to `MODULES` in `src/train/modules.js` with its group, a blurb, what turning it off hides, and the nav views it owns (`tab/view` keys from `NAV` in `public/index.html`, or `tab` for a tab with no views). Add it to the presets it belongs in.
2. Gate its markup: `data-mod="id"` on static HTML, `modOn('id')` (or `window.kMods.has('id')`) in templates, and skip its fetches when it is off.
3. Anything that jumps to it should go through `window.kMods.need('id')`.
4. `npm run check` (`scripts/check-modules.mjs`) fails if a nav view belongs to nothing, two modules claim the same view, a preset names a module that doesn't exist, or the app refers to a module that isn't in the list.

## Limits

This is about what the app shows, not what the server allows: the API, the Kestrel connector for your own Claude, and the data itself are unchanged. The old Run-views menu (choose and reorder) is folded into this one; an order saved with it is still used for the Run views that are on.
