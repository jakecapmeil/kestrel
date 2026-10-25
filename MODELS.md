# Kestrel model files

A Kestrel model is one JSON file. It holds numbers, never code: Kestrel has one evaluator per model `kind` (`src/models.js`), and every upload is checked against the rules below before it is stored. So anyone can run anyone's model safely.

```json
{
  "kestrel": 1,
  "name": "My Riegel",
  "version": "v1",
  "kind": "riegel",
  "task": "race",
  "license": "CC0-1.0",
  "description": "Riegel with a steeper exponent for teens",
  "trained_on": "What data, from where, under which licence",
  "weights": { "exponent": 1.08, "sd": 0.05 }
}
```

| Field | Rule |
|---|---|
| `kestrel` | Always `1`. |
| `name` | 1-60 characters. |
| `version`, `license` | Up to 60 characters. Use an SPDX id for the licence where you can (`CC-BY-4.0`, `CC0-1.0`, `MIT`). |
| `description`, `trained_on` | Up to 2,000 characters. Say what data you trained on and its licence. |
| `kind` / `task` | One of the pairs below. The task is the slot the model fills in the app. |
| `weights` | Depends on the kind. |

The whole file is at most 1 MB. Each user can upload up to 20 models, public or private.

## Purposes (the `task` field)

A purpose is a place in the app where a model does a job. A model declares one; each athlete picks one model per purpose in the Lab's Purposes page. Coaching is also a purpose, but it is powered by a provider (the free Kestrel model, your own key, or a local model), not a weights file.

Every purpose can also be overridden per event with a **slot**, `purpose:event`: `race:5K`, `race:1600`, `short:600`, `vc:2.5mi`. A slot with no pick follows its purpose, so you can run the 5K on one model and everything else on another. Events are Fitness States' own (`SLOT_EVENTS` in `src/models.js`). Picks are stored as `people.settings.models` (purposes) and `people.settings.event_models` (slots); `PUT /api/me` with `{ "models": {...}, "event_models": { "race:5K": "kestrel/vdot", "race:1600": "" } }` sets them, and an empty id clears a slot.

- `race`: 800 m and up on track, cross country and road (XC 5K, 3200 m, half marathon, ...).
- `short`: 100-1000 m and the steeplechases.
- `marathon`: marathon time from the last 16 weeks of training.
- `vc`: a course purpose. What a flat-course time is worth at Van Cortlandt, used to credit Van Cortlandt races back to flat and to predict the park's 5K and 2.5 mi. Every course in `COURSES` (`src/models.js`) gets its own purpose, so a course model never changes track predictions.

## Kinds

### `riegel` (task `race` or `short`)

`t2 = t1 × (d2/d1)^exponent` from the athlete's PR nearest in distance. The 80% range is `±1.2816 × sd × (1 + |ln(d2/d1)|)` in log time.

- `exponent`: 0.9-1.3
- `sd`: above 0, at most 0.5

### `vdot` (task `race`)

Daniels' VDOT. The nearest PR sets a VDOT; that VDOT sets the target time. `weights`: `{ "sd": 0.035 }` (log-SD for the 80% range, above 0, at most 0.5).

### `tanda` (task `marathon`)

Tanda (2011): pace (s/km) = `a + b e^(-c K) + d P` from K = mean weekly km and P = mean training pace (s/km) over `weeks` weeks. `weights`: `a, b, c, d, weeks` (1-16), `min_days` running days needed, `see_sec` (standard error in seconds, for the 80% range) and `range_sec` (`[shortest, longest]` marathon the formula is valid for; outside it, no answer).

### `course-transfer` (task: a course key, e.g. `vc`)

`ln t_course = a + b ln t_flat + c male`, where `t_flat` is what the runner would run on a flat course in good weather. `weights`: `a` (within ±2), `b` (0.5-1.5), `c` (within ±0.5; halved when sex is unknown) and optional `sd` and `n`. A line that makes a course time under 0.9x or over 1.5x the flat time is refused. Fit one from your own races with `node scripts/fit-course.mjs races.csv "Name" vc`.

### `lite-trees` (task `race`)

The HawksPredict-Lite format. Kestrel computes the 21 Lite features from the athlete's results and the target (see `liteFeatures` in `src/models.js`). Your trees predict the log-seconds correction to the weighted-Riegel baseline. This is the format to use for a fine-tuned Lite.

- `feats`: exactly the built-in list, in order: `log_d, surf, male, n_results, p400, p800, p1500, p3000, p5000, p6000, p8000, p21097, base, base_near, base_best, n_buckets, k_ind, base_slope, span, best_samesurf, n_samesurf`.
- `init`: a number added to the sum of the leaves.
- `trees`: 1-2,000 trees, each with 1-4,096 nodes stored as parallel arrays:
  - `f[n]`: feature index, or `-1` for a leaf.
  - `t[n]`: threshold; go left when `x <= t`.
  - `l[n]`, `r[n]`: child indices. Each must be greater than `n`, so every walk ends.
  - `v[n]`: leaf value.
  - `mgl[n]`: `1` sends a missing value (NaN) left, `0` sends it right.
- `interval`: `{ "<buckets>|<distance group>": [low, high] }`, log offsets for the 80% range. `low` must be ≤ 0 and `high` ≥ 0. Buckets run 1-3; distance groups are 0 (≤ 1700 m), 1 (≤ 4100 m), 2 (≤ 7000 m) and 3 (longer). `1|0` is the fallback.

LightGBM and XGBoost trees convert to this layout directly. [`lite_train.py`](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict/scripts/lite_train.py) shows the export (and [`exp20_marathon.py`](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict/scripts/exp20_marathon.py) for the marathon trees).

### `short-pairs` (task `short`)

The HawksPredict-Short format: one line per ordered event pair, `ln t_target = a + b ln t_source + c male`.

- `infl`: range inflation factor, above 0, at most 5.
- `events`: `{ key: metres }`, up to 40 events. Steeplechase keys start with `S` (`S2000`, `S3000`). `1609` is the mile.
- `pairs`: 1-2,000 entries of `{ s, t, a, b, c, sd }`. `s` and `t` must be keys in `events`, and `sd` must be above 0.
- `extra_sd` (optional): `{ key: log-SD }` added to a target's range.

### `marathon-trees` (task `marathon`)

The HawksPredict-Marathon format. The tree rules are the same as `lite-trees`, with these 15 features in this order: `wk_mean, wk_max, wk_last6, longest, long_n, long16_n, runs_wk, weeks_active, pace_med, pace_p10, pace_long, best_riegel, n_eff, best_recent, vol_trend`. Trees predict log seconds directly; there's no baseline. `interval` keys are `g0` (no steady effort found), then `g1`, `g2` and `g3` for under 40, 40-70 and 70+ km a week.

## Fine-tuning a built-in model

1. Download it from the Model hub (or take it from `models/`).
2. Retrain on your results with the [HawksPredict training scripts](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict/scripts), keeping the same features.
3. Write the trees out in the layout above, give the model a new `name` or `version`, fill in `trained_on` and `license`, and upload it.
4. Click **Use this model**. Your race times now come from your model, and the chip under each time says which model made it.

Check your numbers before uploading: `npm run check` shows how the built-in files are tested.
