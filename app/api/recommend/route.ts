import { NextRequest, NextResponse } from "next/server";
import snapshotJson from "../../../data/latest.json";
import { recommend } from "../../../lib/recommender";
import { GameState, MetaSnapshot } from "../../../lib/types";

// data/latest.json is validated by scripts/check-data.mjs before commit/build.
const snapshot = snapshotJson as unknown as MetaSnapshot;

export async function POST(request: NextRequest) {
  const state = (await request.json()) as GameState;
  const eligible = snapshot.comps.filter((comp) => !comp.needsEnrichment || comp.coreUnits.length > 0);
  const result = recommend(eligible, state);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    patch: snapshot.patch,
    snapshotAt: snapshot.fetchedAt,
    live: snapshot.isLive,
    rankBand: snapshot.rankBand,
    result
  });
}
