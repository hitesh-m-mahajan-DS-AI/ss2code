"""Reproducible one-day-ahead demand forecasts. No LLM dependency or provider key."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import platform
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent
SOURCE = "https://archive.ics.uci.edu/static/public/275/bike+sharing+dataset.zip"
FEATURES = ["lag_1", "lag_7", "mean_7", "mean_28", "weekday", "month_sin", "month_cos", "holiday", "day_index"]


def dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf8")


def download() -> Path:
    """Read one named CSV from a bounded archive; never extract arbitrary paths."""
    with urlopen(SOURCE, timeout=30) as response:
        payload = response.read(3_000_001)
    if len(payload) > 3_000_000:
        raise ValueError("Dataset archive exceeded its size budget")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        info = archive.getinfo("day.csv")
        if info.file_size > 2_000_000:
            raise ValueError("CSV exceeded its size budget")
        data = archive.read(info)
    target = ROOT / "data/raw/day.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    dump(target.with_suffix(".provenance.json"), {
        "source": SOURCE, "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "sha256": hashlib.sha256(data).hexdigest(), "archive_sha256": hashlib.sha256(payload).hexdigest(),
        "citation": "Fanaee-T, H. (2013). Bike Sharing. UCI Machine Learning Repository. DOI:10.24432/C5W894",
        "license": "CC BY 4.0; see https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset",
    })
    load_data(target)
    return target


def load_data(path: Path) -> pd.DataFrame:
    data = pd.read_csv(path)
    required = {"dteday", "cnt", "holiday"}
    if not required.issubset(data):
        raise ValueError(f"Required columns: {sorted(required)}")
    data = data[["dteday", "cnt", "holiday"]].copy()  # Never use casual, registered or future weather.
    data["dteday"] = pd.to_datetime(data["dteday"], errors="raise")
    if data["dteday"].duplicated().any() or not data["dteday"].is_monotonic_increasing:
        raise ValueError("Dates must be unique and sorted")
    if len(data) < 60 or (data["dteday"].diff().dropna() != pd.Timedelta(days=1)).any():
        raise ValueError("At least 60 continuous daily observations are required")
    for name in ["cnt", "holiday"]:
        data[name] = pd.to_numeric(data[name], errors="raise")
        if not np.isfinite(data[name]).all() or (data[name] < 0).any():
            raise ValueError("Counts and holidays must be finite and nonnegative")
    if not data["holiday"].isin([0, 1]).all() or (data["cnt"] % 1 != 0).any():
        raise ValueError("Counts must be integers and holiday must be 0 or 1")
    return data


def features(data: pd.DataFrame) -> pd.DataFrame:
    dates = pd.to_datetime(data["dteday"])
    past = data["cnt"].shift(1)
    return pd.DataFrame({
        "lag_1": past, "lag_7": data["cnt"].shift(7),
        "mean_7": past.rolling(7).mean(), "mean_28": past.rolling(28).mean(),
        "weekday": dates.dt.dayofweek, "month_sin": np.sin(2*np.pi*dates.dt.month/12),
        "month_cos": np.cos(2*np.pi*dates.dt.month/12), "holiday": data["holiday"],
        "day_index": (dates - pd.Timestamp("2011-01-01")).dt.days,
    }, index=data.index)[FEATURES]


def models() -> dict:
    return {"ridge": make_pipeline(StandardScaler(), Ridge(alpha=10)),
            "boosting": HistGradientBoostingRegressor(max_iter=150, max_leaf_nodes=15, l2_regularization=10, random_state=42)}


def metrics(actual, predicted) -> dict:
    actual, predicted = np.asarray(actual), np.maximum(0, predicted)
    return {"mae": float(mean_absolute_error(actual, predicted)),
            "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
            "wape": float(np.abs(actual-predicted).sum()/np.abs(actual).sum()) if np.abs(actual).sum() else None}


def interval_radius(errors, coverage=.9) -> float:
    errors = np.sort(np.asarray(errors))
    if not len(errors):
        raise ValueError("Calibration observations required")
    rank = min(len(errors)-1, int(np.ceil((len(errors)+1)*coverage))-1)
    return float(errors[rank])


def fit(csv: Path) -> Path:
    data = load_data(csv)
    x = features(data).dropna()
    y = data.loc[x.index, "cnt"]
    dates = data.loc[x.index, "dteday"]
    if len(x) < 200:
        raise ValueError("Training needs at least 228 daily rows for meaningful temporal partitions")
    n = len(x); train_end, calibration_end = int(n*.75), int(n*.85)
    folds = TimeSeriesSplit(n_splits=3, gap=1)
    validation = {name: [] for name in ["seasonal_naive", *models()]}
    fold_dates = []
    for train, valid in folds.split(x.iloc[:train_end]):
        fold_dates.append({"train_end": str(dates.iloc[train[-1]].date()), "validation_start": str(dates.iloc[valid[0]].date()), "validation_end": str(dates.iloc[valid[-1]].date())})
        validation["seasonal_naive"].append(metrics(y.iloc[valid], x.iloc[valid]["lag_7"])["mae"])
        for name, model in models().items():
            model.fit(x.iloc[train], y.iloc[train])
            validation[name].append(metrics(y.iloc[valid], model.predict(x.iloc[valid]))["mae"])
    winner = min(validation, key=lambda name: np.mean(validation[name]))
    fitted = models()
    for model in fitted.values():
        model.fit(x.iloc[:train_end], y.iloc[:train_end])
    def predict(name, frame):
        return np.maximum(0, frame["lag_7"].to_numpy() if name == "seasonal_naive" else fitted[name].predict(frame))
    cal = x.iloc[train_end:calibration_end]
    radius = interval_radius(np.abs(y.iloc[train_end:calibration_end]-predict(winner, cal)))
    test_x, test_y = x.iloc[calibration_end:], y.iloc[calibration_end:]
    prediction = predict(winner, test_x)
    lower, upper = np.maximum(0, prediction-radius), prediction+radius
    test_metrics = {name: metrics(test_y, predict(name, test_x)) for name in validation}
    baseline = test_metrics["seasonal_naive"]["mae"]
    slices = {str(day): metrics(test_y[test_x.weekday == day], prediction[test_x.weekday == day]) for day in sorted(test_x.weekday.unique())}
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    out = ROOT / "artifacts" / run_id; out.mkdir(parents=True)
    report = {
        "run_id": run_id, "dataset_sha256": hashlib.sha256(csv.read_bytes()).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(),
        "versions": {"sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__},
        "task": "rolling one-day-ahead forecast with yesterday's actual count available; calendar-only future inputs",
        "rows": len(data), "usable_rows": n, "features": FEATURES, "folds": fold_dates,
        "training_end": str(dates.iloc[train_end-1].date()), "calibration_end": str(dates.iloc[calibration_end-1].date()),
        "test_start": str(dates.iloc[calibration_end].date()), "test_end": str(dates.iloc[-1].date()),
        "validation_fold_mae": validation, "selected_model": winner, "test_metrics": test_metrics,
        "selected_mae_improvement_vs_naive": 1-test_metrics[winner]["mae"]/baseline if baseline else None,
        "interval": {"nominal_coverage": .9, "observed_test_coverage": float(np.mean((test_y >= lower) & (test_y <= upper))), "radius": radius, "calibration_rows": len(cal)},
        "weekday_slices": slices,
        "limitations": ["Historical 2011–2012 data, not a live deployment or demonstrated business savings.", "Sequential residual calibration does not guarantee future coverage under temporal drift.", "Test scores do not select the model; selection uses expanding-window validation only.", "Repeat experiments on this test period invalidate claims of a fresh holdout.", "Daily aggregate data cannot support station-level allocation recommendations."],
    }
    # joblib is executable serialization: only load your own verified artifacts.
    artifact = out / "model.joblib"
    joblib.dump({"model": None if winner == "seasonal_naive" else fitted[winner], "name": winner, "features": FEATURES, "radius": radius, "training_feature_mean": x.iloc[:train_end].mean().to_dict(), "training_feature_std": x.iloc[:train_end].std().replace(0, 1).to_dict()}, artifact)
    report["artifact_sha256"] = hashlib.sha256(artifact.read_bytes()).hexdigest()
    dump(out / "metrics.json", report)
    pd.DataFrame({"date": dates.iloc[calibration_end:].dt.strftime("%Y-%m-%d"), "actual": test_y, "prediction": prediction, "lower": lower, "upper": upper}).to_csv(out / "predictions.csv", index=False)
    dump(ROOT / "reports/latest.json", report)
    (ROOT / "reports/CASE_STUDY.md").write_text(f"# Measured forecasting case study\n\nRun: {run_id}\n\nSelected by temporal validation: **{winner}**. Test MAE: {test_metrics[winner]['mae']:.2f} rentals/day; seasonal-naive MAE: {baseline:.2f}. Empirical interval coverage: {report['interval']['observed_test_coverage']:.1%}.\n\nResults are historical, not live demand forecasts or actual savings. Full split dates, fold scores, versions and limitations are in latest.json.\n", encoding="utf8")
    return out


def load_artifact(run: Path):
    run = run.resolve()
    report = json.loads((run / "metrics.json").read_text(encoding="utf8"))
    artifact = run / "model.joblib"
    if hashlib.sha256(artifact.read_bytes()).hexdigest() != report["artifact_sha256"]:
        raise ValueError("Artifact hash mismatch; refuse loading")
    if report["versions"]["sklearn"] != sklearn.__version__:
        raise ValueError("Use the training scikit-learn version")
    return joblib.load(artifact), report


def predict_next(run: Path, history: Path, day: str, holiday: int):
    artifact, report = load_artifact(run)
    data = load_data(history)
    date = pd.Timestamp(day)
    if date != data.dteday.iloc[-1] + pd.Timedelta(days=1):
        raise ValueError("Prediction date must be exactly the day after the history ends")
    if date <= pd.Timestamp(report["calibration_end"]):
        raise ValueError("Prediction date must be after model calibration")
    next_row = pd.DataFrame({"dteday": [date], "cnt": [np.nan], "holiday": [holiday]})
    frame = features(pd.concat([data, next_row], ignore_index=True)).tail(1)
    prediction = max(0., float(frame.lag_7.iloc[0] if artifact["model"] is None else artifact["model"].predict(frame)[0]))
    return {"date": day, "prediction": prediction, "lower": max(0, prediction-artifact["radius"]), "upper": prediction+artifact["radius"], "model_run": report["run_id"], "warning": "Historical model; interval coverage is not guaranteed."}


def monitor(run: Path, history: Path):
    artifact, report = load_artifact(run)
    data = load_data(history); x = features(data).dropna()
    x = x.loc[data.loc[x.index, "dteday"] > pd.Timestamp(report["calibration_end"])]
    if len(x) < 14:
        raise ValueError("Need at least 14 labelled post-calibration observations")
    prediction = np.maximum(0, x.lag_7 if artifact["model"] is None else artifact["model"].predict(x))
    actual = data.loc[x.index, "cnt"]
    shift = {name: float(abs(x[name].mean()-artifact["training_feature_mean"][name])/artifact["training_feature_std"][name]) for name in FEATURES if name != "day_index"}
    coverage = float(np.mean(np.abs(actual-prediction) <= artifact["radius"]))
    return {"rows": len(x), "metrics": metrics(actual, prediction), "interval_coverage": coverage, "standardized_mean_shift": shift, "review_required": coverage < .8 or max(shift.values()) > 2, "action": "Review new labelled performance before any retraining or promotion. No automatic retraining.", "evidence": "Historical labelled monitoring batch, not live production telemetry"}


def promote(run: Path):
    run = run.resolve()
    if run.parent != (ROOT / "artifacts").resolve():
        raise ValueError("Only local versioned artifacts can be promoted")
    _, report = load_artifact(run)
    registry_path = ROOT / "artifacts/registry.json"
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else {"history": []}
    registry["history"].append({"previous": registry.get("active"), "active": run.name, "at": datetime.now(timezone.utc).isoformat()})
    registry["active"] = run.name
    dump(registry_path, registry)
    return registry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["download", "train", "predict", "monitor", "promote"])
    parser.add_argument("--data", type=Path, default=ROOT / "data/raw/day.csv")
    parser.add_argument("--run", type=Path)
    parser.add_argument("--date")
    parser.add_argument("--holiday", type=int, choices=[0, 1], default=0)
    args = parser.parse_args()
    if args.command == "download": print(download())
    elif args.command == "train": print(fit(args.data))
    else:
        if args.run is None: parser.error("--run is required; never load an untrusted model artifact")
        if args.command == "predict":
            if not args.date: parser.error("--date is required")
            result = predict_next(args.run, args.data, args.date, args.holiday)
        elif args.command == "monitor": result = monitor(args.run, args.data)
        else: result = promote(args.run)
        print(json.dumps(result, indent=2))


if __name__ == "__main__": main()
