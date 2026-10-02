import unittest
import tempfile
import json
from unittest.mock import patch
from pathlib import Path
import numpy as np
import pandas as pd
from forecast import features, interval_radius, load_data, metrics, FEATURES
import forecast


class ForecastTests(unittest.TestCase):
    def frame(self):
        return pd.DataFrame({"dteday": pd.date_range("2020-01-01", periods=80), "cnt": np.arange(80), "holiday": 0, "casual": 999, "registered": 999, "temp": 999})

    def test_future_targets_cannot_change_past_features(self):
        original = self.frame()
        changed = original.copy(); changed.loc[50:, "cnt"] = 99999
        pd.testing.assert_frame_equal(features(original).iloc[:51], features(changed).iloc[:51])
        self.assertEqual(features(original).loc[50, "lag_1"], 49)
        self.assertNotIn("casual", FEATURES); self.assertNotIn("temp", FEATURES)

    def test_gaps_and_duplicates_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.csv"
            self.frame().drop(index=5).to_csv(path, index=False)
            with self.assertRaises(ValueError): load_data(path)
            pd.concat([self.frame(), self.frame().tail(1)]).to_csv(path, index=False)
            with self.assertRaises(ValueError): load_data(path)

    def test_calibration_and_metrics(self):
        self.assertEqual(interval_radius([1, 2, 3, 4, 5], .9), 5)
        self.assertEqual(metrics([0, 0], [0, 0])["wape"], None)
        self.assertEqual(metrics([10, 20], [10, 20])["mae"], 0)

    def test_training_serving_registry_and_artifact_integrity(self):
        # Synthetic test fixture only; never included in published model-quality results.
        with tempfile.TemporaryDirectory() as directory, patch.object(forecast, "ROOT", Path(directory)):
            csv = Path(directory) / "fixture.csv"
            dates = pd.date_range("2011-01-01", periods=365)
            pd.DataFrame({"dteday": dates, "cnt": (100 + np.arange(365) + 20 * (np.arange(365) % 7)).astype(int), "holiday": 0}).to_csv(csv, index=False)
            run = forecast.fit(csv)
            report = json.loads((run / "metrics.json").read_text())
            self.assertLess(report["training_end"], report["calibration_end"])
            self.assertLess(report["calibration_end"], report["test_start"])
            for fold in report["folds"]:
                self.assertLess(fold["train_end"], fold["validation_start"])
            prediction = forecast.predict_next(run, csv, "2012-01-01", 0)
            self.assertGreaterEqual(prediction["prediction"], 0)
            with self.assertRaises(ValueError): forecast.predict_next(run, csv, "2012-01-02", 0)
            self.assertIn("review_required", forecast.monitor(run, csv))
            self.assertEqual(forecast.promote(run)["active"], run.name)
            self.assertEqual(forecast.promote(run)["history"][-1]["previous"], run.name)
            (run / "model.joblib").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "hash mismatch"): forecast.load_artifact(run)


if __name__ == "__main__": unittest.main()
