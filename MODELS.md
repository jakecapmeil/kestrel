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

## Tasks

- `race`: 800 m and up on track, cross country and road (XC 5K, 3200 m, half marathon, ...).
- `short`: 100-1000 m and the steeplechases.
- `marathon`: marathon time from the last 16 weeks of training.

## Kinds

### `riegel` (task `race` or `short`)

`t2 = t1 × (d2/d1)^exponent` from the athlete's PR nearest in distance. The 80% range is `±1.2816 × sd × (1 + |ln(d2/d1)|)` in log time.

- `exponent`: 0.9-1.3
- `sd`: above 0, at most 0.5

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

LightGBM and XGBoost trees convert to this layout directly. `research/hawkspredict/scripts/lite_train.py` shows the export (and `exp20_marathon.py` for the marathon trees).

### `short-pairs` (task `short`)

The HawksPredict-Short format: one line per ordered event pair, `ln t_target = a + b ln t_source + c male`.

- `infl`: range inflation factor, above 0, at most 5.
- `events`: `{ key: metres }`, up to 40 events. Steeplechase keys start with `S` (`S2000`, `S3000`). `1609` is the mile.
- `pairs`: 1-2,000 entries of `{ s, t, a, b, c, sd }`. `s` and `t` must be keys in `events`, and `sd` must be above 0.
- `extra_sd` (optional): `{ key: log-SD }` added to a target's range.

### `marathon-trees` (task `marathon`)

The HawksPredict-Marathon format. The tree rules are the same as `lite-trees`, with these 15 features in this order: `wk_mean, wk_max, wk_last6, longest, long_n, long16_n, runs_wk, weeks_active, pace_med, pace_p10, pace_long, best_riegel, n_eff, best_recent, vol_trend`. Trees predict log seconds directly; there's no baseline. `interval` keys are `g0` (no steady effort found), then `g1`, `g2` and `g3` for under 40, 40-70 and 70+ km a week.

## Fine-tuning a built-in model

1. Download it from the Model hub (or take it from `kestrel/models/`).
2. Retrain on your results with the scripts in `research/hawkspredict/scripts`, keeping the same features.
3. Write the trees out in the layout above, give the model a new `name` or `version`, fill in `trained_on` and `license`, and upload it.
4. Click **Use this model**. Your race times now come from your model, and the chip under each time says which model made it.

Check your numbers before uploading: `node kestrel/scripts/check-models.mjs` shows how the built-in files are tested.
