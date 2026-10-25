# Models worth putting on Kestrel

Researched 2026-10-25. The rule for this list: a Kestrel model is data, never code (see [../MODELS.md](../MODELS.md)), so a candidate has to fit one of the existing evaluators or justify a new `kind` that is just numbers. Where I could not get a coefficient from a primary source, it says so and the model is not shipped.

## Shipped in this change

| Model | Purpose | Source | State |
|---|---|---|---|
| **Daniels VDOT** (`kestrel/vdot`, kind `vdot`) | race | Daniels & Gilbert (1979), *Oxygen Power*. The two curves (oxygen cost of running, %VO2max held for t minutes) were already in `src/train/fitness.js`; the model turns them into a predictor from the nearest PR. | Checked against Daniels' published table (VDOT 50: 5K 19:57 gives 10K 41:21, half 1:31:35, marathon 3:10:49) to within 0.03%. The 80% range (log-SD 0.035) is a default, not fitted. |
| **Tanda marathon** (`kestrel/tanda-2011`, kind `tanda`) | marathon | Tanda (2011), *Prediction of marathon performance time on the basis of training indices*, J. Hum. Sport Exerc. 6(3):511-520. Pace (s/km) = 17.1 + 140.0 e^(-0.0053 K) + 0.55 P, K = mean weekly km and P = mean training pace over 8 weeks. Fitted on 22 runners, 46 marathons, 2:47-3:36, standard error about 4 min. Tanda (2022) re-tested it on Strava data: RMSE 5.4 min in 2:47-3:36. | Coefficients taken from the paper's abstract and its repository record, not the full PDF. The model answers nothing outside 2:47-3:36 and needs 15 running days. |
| **Van Cortlandt flat factor** (`kestrel/vc-flat-factor`, kind `course-transfer`) | `vc` course | The coaches' rule of thumb already in `src/train/conditions.js`: VC runs 5.5% slower than flat. | Not fitted. It reproduces today's numbers exactly (`npm run check` asserts x1.055) and is the baseline for a real VC model. |

## Worth adding next

| Candidate | Why | Blocker |
|---|---|---|
| **Linear half-to-marathon fit** (Frontiers in Physiology 2025, Valencia Marathon): marathon s = 2.28 x half s + 329.59 x male - 701.85, MAE 5.67% against 7.92% for VDOT, but VDOT wins below 3:00. | Shows a one-line model can beat the formula everyone uses for recreational marathoners. Fits a new tiny `linear` kind. | I read the coefficients from a summary of Table 1 ([paper](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2025.1718298/full)), not the table itself. Check it, and note the sample is Valencia recreational runners. |
| **Critical speed / D'** | Kestrel already fits a CS and D' per athlete (`pace_models`). A `critical-speed` kind would let the 800 m to 5K range use it as a predictor. | Needs a decision on how to blend with PR-based models. No reference table to check against yet. |
| **Vickers & Vertosick (2016)**, a survey-fitted formula that uses training volume and session types; they report Riegel is at least 10 minutes too fast for over half of marathoners. | A marathon predictor that uses more than weekly distance. | I could not retrieve the coefficients from a primary source, only secondary descriptions. Do not ship from a calculator's copy. |
| **Cameron** | The other classic formula, tuned on world-class times, 800 m to marathon. | No primary source found. |
| **More course models** | Any cross-country course the team races at: Franklin Park, Rim Rock, Mt. SAC, Sunken Meadow. | Data (below). |

Conditions, not predictors, so not models: Minetti et al. (2002) cost of running on slopes (3.4 J/kg/m flat; cheapest near -10% grade) for grade-adjusted pace, and the heat table Kestrel already uses (Hadley). A grade or heat kind could come later.

Rejected: Smyth & Lawlor case-based reasoning on London Marathon and 21,000 runners' logs (needs the data, which is not open). The Boston, Berlin and Kaggle marathon repos found by search (mostly in-race splits, unclear licences, no training logs).

## Open data for fitting

Already used: NRCD collegiate results (Zenodo, CC BY 4.0), Ontario high-school finals (Mendeley, CC BY 4.0), BMClab marathon training logs (Figshare, CC BY 4.0). I found no other clearly CC-licensed running log or race dataset. GoldenCheetah OpenData (OSF) shares workouts but I did not find a licence or race results. **Do not scrape MileSplit or Athletic.net** for course data until their terms are read; results there are not open data.

## A Van Cortlandt model that is actually good

No published conversion exists. Searches found course records and a coaches' rule of thumb, not a factor. So a good VC model has to be fitted on paired results: the same runner's VC time and a flat time from the same month.

1. Kestrel already knows which runs were at Van Cortlandt (`courseOf` in `conditions.js`: GPS inside the park, run name, calendar event) and the flat-equivalent of a runner's other races.
2. Collect pairs (an athlete's flat 5K or track 3200 scaled to 5K, and their VC 5K or 2.5 mi). Consent matters: use a team's own data, or an export the athletes chose to share.
3. `node scripts/fit-course.mjs races.csv "Van Cortlandt 2026" vc > vc.json` fits `ln t_vc = a + b ln t_flat + c male`, prints a valid Kestrel model, and reports the residual SD. Upload it under the Van Cortlandt purpose and compare with the flat factor.
4. Expect the gain to come from `b` (a faster runner loses less than 5.5%, or more) and `c`. Past that, the next improvements are weather and fitness-by-date, which would need a richer kind than a line.

I have not fitted one: there is no paired dataset in this repository, and inventing numbers would make the model worse than the baseline while looking better.

## How models plug in now

A **purpose** is a place in the app where a model does a job (`PURPOSES` in `src/models.js`). Each model declares one in its `task`; each athlete picks one model per purpose.

| Purpose | Kind(s) | Used by |
|---|---|---|
| `race` | `lite-trees`, `riegel`, `vdot` | Fitness States, race predictions (800 m and up) |
| `short` | `short-pairs`, `riegel` | 100-1000 m and steeplechase |
| `marathon` | `marathon-trees`, `tanda` | Marathon estimate from training |
| `vc` (a course) | `course-transfer` | Van Cortlandt: crediting VC races back to flat, and the "5K / 2.5 mi at Van Cortlandt" predictions |
| `coach` | not a model file | Provider chosen in the Lab (free Gemini, your own key, local) |

To add a course, add it to `COURSES`, teach `courseOf` to recognise it, and ship a default `course-transfer` model. Picking, validation, the Workbench note, the API and the Purposes page all follow from the registry. Course models are separate from `race`, so a Van Cortlandt model can never change a track prediction.

Not built: more than one coaching variant. Coaching is a provider plus a prompt that the server checks every answer against (`applyCoachSaves`); making the prompt swappable is the next step, but it needs a design for who is allowed to publish prompts.

## Naming the platform

"Kestrel Lab" undersells what this is now: a place where models are written, tested and wired to jobs. It is one constant, `PLATFORM_NAME` in `src/models.js`. Three candidates, none adopted:

- **Kestrel Hangar**: where the aircraft are kept and tuned.
- **Kestrel Aerie**: the nest; models you raise and fly.
- **Kestrel Works**: plain, and sits well beside "models are files of numbers".
