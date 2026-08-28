# V0.8.2 Vision Model Pipeline

V0.8.2 separates **data collection / candidate training** from **production activation**.

## 1. Collect current-season China-server crops

The Windows overlay adds `V0.8.2 ONNX DATA / GATE` under Auto Vision.

- trusted hero crops are collected only when V0.8 Board Vision provides a high-confidence OCR label and that label maps consistently to a board/bench slot;
- each exported record contains only the 128×128 slot crop plus session/slot/label metadata, not the full game screenshot;
- use `新训练 Session` or `新开一局` between matches so train/validation/test can be split by match/session instead of random near-duplicate crops;
- hard-negative `__unknown__` crops require an explicit user action. Only trigger this when the currently unlabeled slots are genuinely negatives such as empty/effect/transition slots.

Export one or more JSON batches after matches.

## 2. Train an ONNX candidate

```bash
python -m venv .venv
.venv/Scripts/pip install -r vision/requirements-v082.txt
.venv/Scripts/python scripts/train-vision-model.py path/to/batch1.json path/to/batch2.json --out vision/candidate-v082
```

The trainer:

- accepts only `region=CN`, `currentSeasonOnly=true`, `splitUnit=session` exports;
- splits entire sessions into train / validation / test;
- trains MobileNetV3-small at 128×128;
- requires an explicit `__unknown__` class;
- exports `champion-v082.onnx`, `classes-v082.json`, and `model-report-v082.json`;
- deliberately leaves activation blocked because crop-level accuracy alone does not prove low GameState false-write risk.

## 3. Production activation gates

`vision/model-manifest.json` is the single activation authority. The checked-in state is intentionally:

```text
status=blocked
precisionUse=blocked
```

Changing it to `verified` requires all of the following to exist and pass `npm run check:vision-model`:

- ONNX model file + exact SHA-256;
- classes file with `__unknown__`;
- session-level train/validation/test report;
- minimum per-class precision;
- minimum per-class recall;
- unknown recall;
- full-board exact-composition accuracy;
- production false-write rate;
- Windows CPU P95 inference latency.

Until those measurements are supplied, `lib/vision-model.ts` refuses ONNX runtime use and V0.8.1 prototype recognition remains the only pixel candidate path.

## Safety boundary

No game-process memory reads, injection, packet interception/decryption, or automated gameplay input are introduced by this pipeline.
