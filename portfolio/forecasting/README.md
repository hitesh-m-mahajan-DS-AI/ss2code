# Daily demand forecasting — independent ML project

Predict the next day's aggregate bike rentals using information available at prediction time. This is a real trained scikit-learn pipeline, not an LLM wrapper. The implementation and results can be presented independently of SS2Code.

## Reproduce locally

Install Python 3.12, then from the repository root:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r portfolio/forecasting/requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s portfolio/forecasting -p "test_*.py" -v
.\.venv\Scripts\python.exe portfolio/forecasting/forecast.py download
.\.venv\Scripts\python.exe portfolio/forecasting/forecast.py train
```

On macOS/Linux use `python3.12` and `.venv/bin/python`. In VS Code, select this `.venv` interpreter. Training prints a new artifact directory; replace `RUN_DIRECTORY` below with that path:

```powershell
.\.venv\Scripts\python.exe portfolio/forecasting/forecast.py predict --run RUN_DIRECTORY --date 2013-01-01 --holiday 1
.\.venv\Scripts\python.exe portfolio/forecasting/forecast.py monitor --run RUN_DIRECTORY
```

This prediction is a historical demonstration after the downloaded series, **not a forecast for today**. `--data` accepts your validated continuous daily CSV with `dteday,cnt,holiday`. Prediction must be exactly one day after its last observation and after calibration. Labels from previous days must be available; this is not a recursive multi-day forecast.

Training generates ignored `artifacts/<run>/model.joblib`, `metrics.json` and `predictions.csv`; the public latest report and short case study are refreshed. Review report changes before committing. Test runs isolate all artifacts in temporary directories and do not overwrite the real report.

## Data and model card

Source: [UCI Bike Sharing](https://archive.ics.uci.edu/dataset/275/bike%2Bsharing%2Bdataset), Fanaee-T (2013), DOI 10.24432/C5W894, CC BY 4.0. Dataset contains daily/hourly 2011–2012 historical rentals. The downloader selects only `day.csv` from a bounded archive, records source, retrieval time and SHA-256, and validates the daily schema. Raw data is not committed.

There are 731 days and 703 usable lagged observations. `casual` and `registered` sum to the target and are excluded. Realized target-day weather is also excluded. Inputs are shifted past counts/rolling means and known calendar features. Missing days, duplicate/unsorted dates, nonfinite/negative/fractional counts and invalid holidays fail validation.

First 75%: three expanding-window folds with a one-day gap select among seasonal-naive (lag 7), scaled Ridge and histogram gradient boosting by mean validation MAE. The scaler is fitted inside each training fold. Chosen model is trained on the initial 75%; next 10% calibrates a nominal 90% absolute-residual interval; last 15% is a held-out temporal test. [TimeSeriesSplit documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) explains this ordered validation approach.

For one-day rolling backtests, previous *observed* test-day counts may become features for the next day. Future target-day values never do. This is deliberate and must not be described as forecasting an entire unseen horizon at once.

## Measured result, including the failure

See [complete report](reports/latest.json) and [case study](reports/CASE_STUDY.md). On the original recorded run, Ridge achieved MAE **957.88 rentals/day**, compared with **1,380.12** for seasonal-naive: a **30.6% reduction** on 106 test days. The more complex boosting model was worse (MAE 1,457.63). Selection used temporal validation, not these test scores.

Nominal 90% intervals covered only **72.6%** of test observations. Monitoring correctly requests review. Temporal residual calibration does not guarantee exchangeability or coverage under drift. The model is **not approved for deployment on the basis of these intervals**. Investigate time/weekday slices and new independent periods; do not tune on this held-out report and keep calling it untouched.

## Serving, monitoring and registry

The CLI provides reproducible batch serving. It verifies artifact SHA-256 and the scikit-learn version before loading. **Joblib executes Python serialization: only load artifacts you produced and trust.** A hash is integrity checking, not proof of a trusted author.

Monitoring requires at least 14 labelled post-calibration days and reports MAE/RMSE/WAPE, interval coverage and standardized feature-mean shift. It requests review when coverage falls below 80% or any monitored feature shifts by more than two training standard deviations. These are documented heuristic alerts, not validated causal drift tests. No automatic retraining or promotion occurs.

After human review, `forecast.py promote --run RUN_DIRECTORY` updates the local registry and appends previous/active versions **only if release gate `forecast-release@1.0.0` passes**: finite held-out interval coverage of at least 80%, at least 30 calibration observations, and finite nonnegative selected MAE no worse than seasonal-naive. These fixed heuristics reuse the monitoring floor; they are not proof of nominal 90% or future coverage. Missing/invalid evidence fails closed, without changing the registry. The recorded 72.6%-coverage run is blocked. No CLI bypass is provided; do not edit its report to manufacture approval.

To roll back, explicitly promote the earlier trusted, gate-passing run. This is a single-operator local registry pointer, not a deployed API rollout; serving commands still require explicit `--run`. Keep artifact and metadata together. Tests cover chronological boundaries, leakage, serving dates, registry history, blocked promotion preserving the previous pointer, and tampering. A periodic synthetic series is used for the lifecycle test, never for published quality claims.

Limitations: old aggregate single-system data, no station-level decisions, no business savings measured, no production SLA or forecast API hosting, no guarantee under demand shocks, and no separate demographic fairness conclusions from aggregate data.
