import { NextRequest, NextResponse } from "next/server";
import snapshotJson from "../../../data/latest.json";
import { parseGameState } from "../../../lib/game-state";
import { recommend } from "../../../lib/recommender";
import { MetaSnapshot } from "../../../lib/types";

// data/latest.json is validated by scripts/check-data.mjs before commit/build.
const snapshot = snapshotJson as unknown as MetaSnapshot;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const state = parseGameState(body);
  const eligible = snapshot.comps.filter(
    (comp) => !comp.needsEnrichment && comp.coreUnits.length > 0 && comp.stagePlan.length > 0
  );
  const result = recommend(eligible, state);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    engineVersion: "0.3.0",
    patch: snapshot.patch,
    snapshotAt: snapshot.fetchedAt,
    live: snapshot.isLive,
    rankBand: snapshot.rankBand,
    normalizedState: state,
    result
  });
}
