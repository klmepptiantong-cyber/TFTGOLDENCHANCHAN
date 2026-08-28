#!/usr/bin/env python3
"""Evaluate a candidate champion ONNX model against held-out session data.

The output matches the production manifest gate fields and measures crop-level
precision/recall, unknown rejection, trusted false-write rate, full-board exact
composition accuracy, and ONNX CPU latency. It never edits the production manifest.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import platform
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

UNKNOWN = "__unknown__"
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
CONFIDENCE_MIN = 0.82
UNKNOWN_SCORE_MAX = 0.18


def load_payloads(paths: list[Path]):
    samples, snapshots = [], []
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("region") != "CN" or payload.get("currentSeasonOnly") is not True:
            raise ValueError(f"invalid dataset provenance: {path}")
        if payload.get("splitUnit") != "session":
            raise ValueError(f"dataset must split by session: {path}")
        samples.extend(payload.get("samples", []))
        snapshots.extend(payload.get("boardSnapshots", []))
    return samples, snapshots


def decode_image(data_url: str) -> np.ndarray:
    encoded = data_url.split(",", 1)[1]
    image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB").resize((128, 128))
    array = np.asarray(image, dtype=np.float32).transpose(2, 0, 1) / 255.0
    return ((array - MEAN) / STD)[None, ...]


def softmax(logits: np.ndarray) -> np.ndarray:
    logits = logits.astype(np.float64)
    logits -= np.max(logits)
    values = np.exp(logits)
    return values / np.sum(values)


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return math.inf
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * pct) - 1))
    return ordered[index]


def predictor(model_path: Path, classes: list[str]):
    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, min(4, (os_cpu_count() or 2)))
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    unknown_index = classes.index(UNKNOWN)

    def predict(data_url: str):
        tensor = decode_image(data_url)
        started = time.perf_counter()
        logits = session.run(None, {input_name: tensor})[0][0]
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        probs = softmax(logits)
        top = int(np.argmax(probs))
        confidence = float(probs[top])
        unknown_score = float(probs[unknown_index])
        label = classes[top]
        trusted = label != UNKNOWN and confidence >= CONFIDENCE_MIN and unknown_score <= UNKNOWN_SCORE_MAX
        emitted = label if trusted else UNKNOWN
        return emitted, confidence, unknown_score, elapsed_ms

    return predict


def os_cpu_count():
    try:
        import os
        return os.cpu_count()
    except Exception:
        return 2


def confusion_metrics(classes: list[str], pairs: list[tuple[str, str]]):
    index = {name: idx for idx, name in enumerate(classes)}
    confusion = [[0 for _ in classes] for _ in classes]
    for truth, pred in pairs:
        if truth not in index or pred not in index:
            continue
        confusion[index[truth]][index[pred]] += 1
    precision, recall = {}, {}
    for idx, name in enumerate(classes):
        tp = confusion[idx][idx]
        fp = sum(confusion[row][idx] for row in range(len(classes)) if row != idx)
        fn = sum(confusion[idx][col] for col in range(len(classes)) if col != idx)
        precision[name] = tp / max(1, tp + fp)
        recall[name] = tp / max(1, tp + fn)
    return confusion, precision, recall


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("datasets", nargs="+", type=Path, help="clean V0.8.3 dataset JSON files")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--classes", type=Path, required=True)
    parser.add_argument("--candidate-report", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("vision/model-report-v083.json"))
    args = parser.parse_args()

    classes = json.loads(args.classes.read_text(encoding="utf-8"))
    if not isinstance(classes, list) or UNKNOWN not in classes:
        raise SystemExit("classes must be a list containing __unknown__")
    candidate = json.loads(args.candidate_report.read_text(encoding="utf-8"))
    split_ids = candidate.get("splitSessionIds") or {}
    test_ids = set(split_ids.get("test") or [])
    if not test_ids:
        raise SystemExit("candidate report must contain splitSessionIds.test; retrain with V0.8.3 pipeline")

    samples, snapshots = load_payloads(args.datasets)
    test_samples = [s for s in samples if s.get("sessionId") in test_ids and s.get("label") in classes]
    test_snapshots = [s for s in snapshots if s.get("sessionId") in test_ids]
    if not test_samples:
        raise SystemExit("no held-out test samples matched candidate splitSessionIds.test")

    predict = predictor(args.model, classes)
    pairs: list[tuple[str, str]] = []
    latencies: list[float] = []
    trusted_writes = 0
    false_writes = 0
    per_session = defaultdict(lambda: {"samples": 0, "errors": 0})

    for sample in test_samples:
        truth = sample["label"]
        pred, confidence, unknown_score, latency = predict(sample["imageDataUrl"])
        latencies.append(latency)
        pairs.append((truth, pred))
        per_session[sample["sessionId"]]["samples"] += 1
        if pred != truth:
            per_session[sample["sessionId"]]["errors"] += 1
        if pred != UNKNOWN:
            trusted_writes += 1
            if pred != truth:
                false_writes += 1

    board_exact = 0
    board_total = 0
    board_details = []
    for snapshot in test_snapshots:
        expected = int(snapshot.get("expectedLevel") or 0)
        units = snapshot.get("units") or []
        if expected <= 0 or len(units) != expected:
            continue
        board_total += 1
        predictions = []
        exact = True
        for unit in units:
            pred, confidence, unknown_score, latency = predict(unit["imageDataUrl"])
            latencies.append(latency)
            predictions.append({
                "slotId": unit["slotId"],
                "truth": unit["label"],
                "predicted": pred,
                "confidence": confidence,
                "unknownScore": unknown_score,
            })
            if pred != unit["label"]:
                exact = False
        if exact:
            board_exact += 1
        board_details.append({
            "snapshotId": snapshot.get("snapshotId"),
            "sessionId": snapshot.get("sessionId"),
            "exact": exact,
            "predictions": predictions,
        })

    confusion, precision, recall = confusion_metrics(classes, pairs)
    known = [name for name in classes if name != UNKNOWN]
    metrics = {
        "minPerClassPrecision": min((precision.get(name, 0.0) for name in known), default=0.0),
        "minPerClassRecall": min((recall.get(name, 0.0) for name in known), default=0.0),
        "unknownRecall": recall.get(UNKNOWN, 0.0),
        "boardExactAccuracy": board_exact / max(1, board_total),
        "falseWriteRate": false_writes / max(1, trusted_writes),
        "cpuP95Ms": percentile(latencies, 0.95),
    }

    train_ids = list(split_ids.get("train") or [])
    validation_ids = list(split_ids.get("validation") or [])
    report = {
        "schemaVersion": 2,
        "region": "CN",
        "season": "S18",
        "currentSeasonOnly": True,
        "splitUnit": "session",
        "sessions": {
            "train": len(train_ids),
            "validation": len(validation_ids),
            "test": len(test_ids),
        },
        "splitSessionIds": {
            "train": train_ids,
            "validation": validation_ids,
            "test": sorted(test_ids),
        },
        "testSamples": len(test_samples),
        "boardSnapshots": board_total,
        "metrics": metrics,
        "perClassPrecision": precision,
        "perClassRecall": recall,
        "confusionMatrix": confusion,
        "falseWrite": {
            "trustedWrites": trusted_writes,
            "incorrectTrustedWrites": false_writes,
            "definition": "incorrect trusted non-unknown predictions / all trusted non-unknown predictions",
        },
        "boardDetails": board_details,
        "perSession": dict(per_session),
        "runtime": {
            "engine": "onnxruntime-cpu",
            "platform": platform.system(),
            "machine": platform.machine(),
            "windowsCpuMeasured": platform.system().lower() == "windows",
            "latencySamples": len(latencies),
        },
        "activationReady": False,
        "activationBlockers": [],
    }

    if not report["runtime"]["windowsCpuMeasured"]:
        report["activationBlockers"].append("cpuP95Ms must be measured on Windows CPU")
    if board_total == 0:
        report["activationBlockers"].append("no held-out full-board validation snapshots")
    if metrics["falseWriteRate"] > 0.005:
        report["activationBlockers"].append("false-write rate above 0.5% reference gate")
    if metrics["boardExactAccuracy"] < 0.90:
        report["activationBlockers"].append("board exact accuracy below 90% reference gate")
    if metrics["unknownRecall"] < 0.90:
        report["activationBlockers"].append("unknown recall below 90% reference gate")
    report["activationReady"] = len(report["activationBlockers"]) == 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"production evaluation report: {args.out}")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    if not report["runtime"]["windowsCpuMeasured"]:
        print("WARNING: CPU latency was not measured on Windows; activation remains blocked")


if __name__ == "__main__":
    main()
