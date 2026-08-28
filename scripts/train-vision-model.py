#!/usr/bin/env python3
"""Train a current-season China-server slot classifier from cleaned V0.8.x JSON exports.

This script intentionally cannot mark the production manifest verified. It emits an
ONNX candidate, classes and crop-level report. Board-level exact accuracy,
false-write rate and Windows CPU P95 must be measured separately before activation.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import random
from collections import defaultdict
from pathlib import Path

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

SEED = 20260829
UNKNOWN = "__unknown__"


def load_exports(paths: list[Path]):
    samples = []
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("region") != "CN" or payload.get("currentSeasonOnly") is not True:
            raise ValueError(f"invalid dataset provenance: {path}")
        if payload.get("splitUnit") != "session":
            raise ValueError(f"dataset must split by session: {path}")
        for sample in payload.get("samples", []):
            if sample.get("region") != "CN" or sample.get("season") != "S18":
                continue
            if not sample.get("sessionId") or not sample.get("label") or not sample.get("imageDataUrl"):
                continue
            samples.append(sample)
    return samples


def split_sessions(samples):
    sessions = sorted({sample["sessionId"] for sample in samples})
    rng = random.Random(SEED)
    rng.shuffle(sessions)
    n = len(sessions)
    train_end = max(1, int(n * 0.7))
    val_end = max(train_end + 1, int(n * 0.85)) if n >= 3 else n
    return {
        "train": set(sessions[:train_end]),
        "validation": set(sessions[train_end:val_end]),
        "test": set(sessions[val_end:]),
    }


class SlotDataset(Dataset):
    def __init__(self, samples, classes, session_ids, train=False):
        self.samples = [s for s in samples if s["sessionId"] in session_ids and s["label"] in classes]
        self.class_to_index = {name: index for index, name in enumerate(classes)}
        base = [transforms.Resize((128, 128))]
        if train:
            base += [
                transforms.RandomApply([transforms.ColorJitter(brightness=.12, contrast=.12, saturation=.10)], p=.45),
                transforms.RandomAffine(degrees=2.5, translate=(.025, .025), scale=(.97, 1.03)),
            ]
        base += [
            transforms.ToTensor(),
            transforms.Normalize([.485, .456, .406], [.229, .224, .225]),
        ]
        self.transform = transforms.Compose(base)

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        sample = self.samples[index]
        encoded = sample["imageDataUrl"].split(",", 1)[1]
        image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")
        return self.transform(image), self.class_to_index[sample["label"]]


def evaluate(model, loader, classes, device):
    confusion = [[0 for _ in classes] for _ in classes]
    model.eval()
    with torch.no_grad():
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            predictions = model(images).argmax(dim=1)
            for truth, pred in zip(labels.tolist(), predictions.tolist()):
                confusion[truth][pred] += 1
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
    parser.add_argument("exports", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, default=Path("vision/candidate-v083"))
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=48)
    args = parser.parse_args()

    random.seed(SEED)
    torch.manual_seed(SEED)
    samples = load_exports(args.exports)
    if not samples:
        raise SystemExit("no valid current-season samples")
    per_label = defaultdict(int)
    for sample in samples:
        per_label[sample["label"]] += 1
    classes = sorted(per_label)
    if UNKNOWN not in classes:
        raise SystemExit("dataset requires explicit __unknown__ hard-negative samples")

    split = split_sessions(samples)
    if not split["validation"] or not split["test"]:
        raise SystemExit("need at least 3 distinct sessions before training")

    train_ds = SlotDataset(samples, classes, split["train"], train=True)
    val_ds = SlotDataset(samples, classes, split["validation"])
    test_ds = SlotDataset(samples, classes, split["test"])
    if not train_ds or not val_ds or not test_ds:
        raise SystemExit("all session splits must contain samples")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = models.mobilenet_v3_small(weights=None)
    model.classifier[3] = nn.Linear(model.classifier[3].in_features, len(classes))
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss(label_smoothing=.04)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)

    best_state, best_score = None, -1.0
    for epoch in range(args.epochs):
        model.train()
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()
        _, precision, recall = evaluate(model, val_loader, classes, device)
        known = [name for name in classes if name != UNKNOWN]
        score = min([precision[name] for name in known] + [recall.get(UNKNOWN, 0.0)])
        print(f"epoch={epoch+1} validation_gate_score={score:.4f}")
        if score > best_score:
            best_score = score
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    model.to(device)
    confusion, precision, recall = evaluate(model, test_loader, classes, device)

    args.out.mkdir(parents=True, exist_ok=True)
    classes_path = args.out / "classes-v083.json"
    model_path = args.out / "champion-v083.onnx"
    report_path = args.out / "model-report-v083-candidate.json"
    classes_path.write_text(json.dumps(classes, ensure_ascii=False, indent=2), encoding="utf-8")

    model.eval().cpu()
    dummy = torch.zeros(1, 3, 128, 128)
    torch.onnx.export(
        model,
        dummy,
        model_path,
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
    )

    known = [name for name in classes if name != UNKNOWN]
    report = {
        "schemaVersion": 2,
        "region": "CN",
        "season": "S18",
        "currentSeasonOnly": True,
        "splitUnit": "session",
        "sessions": {key: len(value) for key, value in split.items()},
        "splitSessionIds": {key: sorted(value) for key, value in split.items()},
        "sampleCount": len(samples),
        "classCounts": dict(per_label),
        "metrics": {
            "minPerClassPrecision": min((precision[name] for name in known), default=0.0),
            "minPerClassRecall": min((recall[name] for name in known), default=0.0),
            "unknownRecall": recall.get(UNKNOWN, 0.0),
            "boardExactAccuracy": None,
            "falseWriteRate": None,
            "cpuP95Ms": None,
        },
        "perClassPrecision": precision,
        "perClassRecall": recall,
        "confusionMatrix": confusion,
        "activationReady": False,
        "activationBlockers": [
            "measure boardExactAccuracy on held-out full-board test sessions",
            "measure falseWriteRate with production-equivalent trust thresholds",
            "measure Windows CPU P95 ONNX latency",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"candidate ONNX: {model_path}")
    print("candidate remains BLOCKED until board/false-write/Windows CPU gates are measured")


if __name__ == "__main__":
    main()
