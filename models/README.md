# Kestrel model cards

The four built-in models, as open weights. Each `.json` file here is the complete model: download it, read it, retrain it, upload a new version through the Model hub. The file format is in [../MODELS.md](../MODELS.md). The training scripts and full results are in [research/hawkspredict](../../research/hawkspredict) (`RESULTS.md`, `DATASETS.md`).

All errors below are mean absolute error in percent of race time, on data the model never saw.

## HawksPredict-Lite v1.1 (`hawkspredict-lite.json`)

- **Task:** race time for 800 m and up (track, cross country, road), from any earlier results.
- **How:** a weighted-Riegel baseline from the athlete's results, plus 150 gradient-boosted trees (6,450 parameters) that correct it from distance, time and surface only (never dates, so undated PRs work). 80% ranges come from held-out residuals, by how many distance buckets the athlete has and the target distance.
- **Trained on:** NRCD v2.1.0 collegiate results 2003-2026 (Zenodo record 22077479, CC BY 4.0) and Ontario high-school championship finals 2013-2026 (Mendeley Data 7rxh2z7vrc, CC BY 4.0).
- **How good:** 4.39% on the frozen NRCD test set (95% CI 4.12-4.69). On teen-like inputs, v1.1 moved predictions by about 1-2% from v1. On Ontario finals its average bias is within ±1% in every grade and sex group.
- **Limits:** trained mostly on college runners and championship finalists. It hasn't been scored on a fresh set of real high-school races yet. That scoring starts with the 2026 season. Without a sex given, it averages the male and female predictions and keeps the wider range.
- **Weights licence:** CC BY 4.0. Credit NRCD (Zenodo 22077479) and the Ontario championship dataset (Mendeley 7rxh2z7vrc).

## HawksPredict-Short v1.1 (`hawkspredict-short.json`)

- **Task:** 400 m, 600 m, 1000 m and steeplechase. 100 m and 200 m need a sprint PR to predict from.
- **How:** for every pair of events, a line `ln t_target = a + b ln t_source + c male` with its residual SD. Up to three nearest known events are combined by inverse variance, and the range is inflated by a cross-validated factor.
- **Trained on:** World Athletics all-time top lists (best mark per athlete and event, elite), NRCD collegiate PBs (CC BY 4.0) and the training half of the Ontario finalists (CC BY 4.0).
- **How good:** cross-validated error from 0.95% (600 m) to 3.6% (400 m) per event, below Riegel's on every event (Riegel: 2.4-10.8%). Per-event numbers are in `research/hawkspredict/RESULTS.md` (exp13).
- **Weights licence: unclear.** The World Athletics list copy it was fitted on (Kaggle `mexwell/world-athletics-database`) states no licence. Published here for transparency and research; check before reusing commercially. A refit on a CC0 copy of the lists (Kaggle `jeannicolasduval/world-athletics-all-time-rankings`) is planned.

## HawksPredict-Marathon v1 (`hawkspredict-marathon.json`)

- **Task:** marathon time from the last 16 weeks of logged running (needs 15 running days with distance and time).
- **How:** 15 training features (weekly volume, long runs, pace distribution, best Riegel-equivalent effort, volume trend) into 150 boosted trees. The range comes from held-out residuals by weekly volume.
- **Trained on:** BMClab long-distance running dataset, 2019 marathons with each runner's training logs (Figshare 16620238, CC BY 4.0).
- **How good:** 6.30% on 2,127 held-out races (Riegel from the best training run: 8.55%). 80% range coverage 78.9%.
- **Limits:** adults, and only runs logged on one social site. Training logs alone can't say much more than this about a marathon day, so the range is wide on purpose.
- **Weights licence:** CC BY 4.0. Credit the BMClab dataset (Figshare 16620238).

## Riegel (`riegel.json`)

- **Task:** any race time, from the nearest PR: `t2 = t1 × (d2/d1)^1.06`.
- **Source:** Riegel, P. S. (1981), *Athletic records and human endurance*, American Scientist 69(3). The range (log-SD 0.04, wider the further you extrapolate) is a rough default, not fitted.
- **Licence:** CC0. It's a formula.
