# Data sharing for Kestrel's models

Runners choose in **You → Settings → Help improve Kestrel's models** (and once on Today). Off by default.

| Choice | What happens |
|---|---|
| Don't share (default) | Nothing leaves the runner's account. |
| Share with Kestrel only | The project may use an anonymized copy to test and improve its race models, plan levels and coach. Never published or sold. |
| Kestrel open dataset (18+) | The same anonymized copy may be published in the Kestrel open dataset under CC BY 4.0. |

The choice is stored in `people.settings.data_share` as `{ choice, at, version }`. The open option is refused on the server for runners under 18 or without a birth year.

## How anonymous it is

Plainly: the records are **pseudonymous**, not fully anonymous. Nothing names a runner, but each record keeps exact lap times, heart rates and distances, and weekdays stay right after the date shift. Someone who already knew a runner's exact training could recognise them. That's why the open option is adults-only, and why releases should drop thin records (see below) and could round lap times before publishing.

## What a record holds

`src/train/dataset.js` builds it (`anonymize`). Per runner: a pseudonym (HMAC of the person id with `KESTREL_SECRET`), age band, sex if given, running experience. Per run: date shifted by a per-runner secret number of whole weeks (4-160), category, surface, miles, moving time, average and max heart rate, cadence, climbing (nearest 10 ft), temperature (nearest 5 °F), difficulty, load, and up to 40 laps (distance, time, heart rate).

Never included: name, email, team, school, GPS routes, courses, start times, notes, health or body map, AI text, anything typed.

## Exporting

`GET /api/v1/dataset?scope=open|all` with `Authorization: Bearer <DATASET_TOKEN>` returns newline-delimited JSON. Set the token with `npx wrangler secret put DATASET_TOKEN` (at least 20 characters). Without it the route refuses everything.

Before publishing a release:
- Re-export with `scope=open` on the day of release, so anyone who changed their mind is left out.
- Drop runners with fewer than 20 runs (small records are easier to re-identify).
- Version each release; withdrawn runners are left out of the next one. Released versions can't be recalled, and the settings card says so.

## Still to decide (needs a person, not code)

- Have the privacy wording read by someone qualified, especially for 13-17 year olds sharing with Kestrel.
- Where open releases live (Hugging Face datasets or a GitHub release) and who signs off on each.
