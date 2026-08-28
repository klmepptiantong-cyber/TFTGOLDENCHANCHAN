# V0.8.3 Vision Model Pipeline

V0.8.3 keeps the V0.8.2 rule that **data collection / candidate training / production activation are separate stages**, then adds dataset QA, leakage prevention, full-board validation snapshots, and a production ONNX evaluation harness.

## 1. Collect current-season China-server crops

The Windows overlay keeps `V0.8.2 ONNX DATA / GATE` under Auto Vision.

- trusted hero crops are collected only when V0.8 Board Vision provides a high-confidence OCR label and that label maps consistently to a board/bench slot;
- each exported record contains only the 128×128 slot crop plus session/slot/label metadata, not the full game screenshot;
- use `新训练 Session` or `新开一局` between matches so train/validation/test can be split by match/session instead of random near-duplicate crops;
- hard-negative `__unknown__` crops require an explicit user action.

Export one or more JSON batches after matches.

## 2. Import and QA batches in V0.8.3

The overlay adds `V0.8.3 DATA QA / EVAL`.

It can import multiple V0.8.2/V0.8.3 JSON files and produces a cleaned merged dataset plus QA report. The QA engine blocks or removes:

- invalid CN/S18/session envelopes;
- malformed or low-confidence OCR samples;
- exact duplicate crops;
- the same crop fingerprint carrying different hero labels;
- exact crop duplicates appearing in multiple sessions, because that can leak near-identical images across train/validation/test.

It also reports:

- session count;
- accepted/rejected sample count;
- per-label sample and session coverage;
- unknown sample/session coverage;
- layout and board/bench coverage;
- candidate-training readiness and production-coverage readiness.

### Full-board validation snapshots

Click `采一帧整盘验证` during a stable board state. A snapshot is accepted only when V0.8 Board Vision already reports a complete board, entity count equals current level, every board hero is at least 82% confident, and every hero maps to a unique board slot.

These snapshots are required for real `boardExactAccuracy`; crop-level accuracy alone is not enough.

## 3. Train a candidate ONNX model

```bash
python -m venv .venv
.venv/Scripts/pip install -r vision/requirements-v082.txt
.venv/Scripts/python scripts/train-vision-model.py path/to/tftgolden-v083-clean.json --out vision/candidate-v083
```

The trainer:

- accepts only `region=CN`, `currentSeasonOnly=true`, `splitUnit=session` exports;
- deterministically splits entire sessions into train / validation / test;
- writes the exact `splitSessionIds` into the candidate report so the held-out test set is auditable;
- trains MobileNetV3-small at 128×128;
- requires an explicit `__unknown__` class;
- exports `champion-v083.onnx`, `classes-v083.json`, and `model-report-v083-candidate.json`;
- deliberately leaves activation blocked.

## 4. Run held-out production evaluation

Run this on Windows CPU when evaluating latency for activation:

```bash
.venv/Scripts/python scripts/evaluate-vision-model.py \
  path/to/tftgolden-v083-clean.json \
  --model vision/candidate-v083/champion-v083.onnx \
  --classes vision/candidate-v083/classes-v083.json \
  --candidate-report vision/candidate-v083/model-report-v083-candidate.json \
  --out vision/model-report-v083.json
```

The evaluator only uses sessions listed in `splitSessionIds.test` and reports:

- per-class precision / recall and confusion matrix;
- `__unknown__` rejection recall;
- trusted false-write rate using production-equivalent confidence/unknown thresholds;
- full-board exact-composition accuracy from held-out board snapshots;
- CPU P95 ONNX latency;
- per-session errors and board-level details;
- whether latency was actually measured on Windows.

`falseWriteRate` is defined as **incorrect trusted non-unknown predictions / all trusted non-unknown predictions**. A low top-1 error rate does not substitute for this metric.

## 5. Production activation gates

`vision/model-manifest.json` remains the single activation authority. The checked-in state stays intentionally:

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

Until those measurements pass, `lib/vision-model.ts` refuses ONNX runtime use and V0.8.1 prototype recognition remains the trusted pixel candidate fallback.

## CI

The main CI compile-checks both Python tools with `python -m py_compile` and still runs the vision-model activation guard. No Python ML dependencies are installed in CI just to syntax-check the tools.

## Safety boundary

No game-process memory reads, injection, packet interception/decryption, or automated gameplay input are introduced by this pipeline.
