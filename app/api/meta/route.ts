import { NextResponse } from "next/server";
import snapshotJson from "../../../data/latest.json";
import { discoveryScore, metaScore } from "../../../lib/scoring";
import { MetaSnapshot } from "../../../lib/types";

// data/latest.json is validated by scripts/check-data.mjs before commit/build.
const snapshot = snapshotJson as unknown as MetaSnapshot;

export async function GET() {
  const comps = snapshot.comps
    .map((comp) => ({
      ...comp,
      metaScore: metaScore(comp),
      discoveryScore: discoveryScore(comp)
    }))
    .sort((a, b) => b.metaScore - a.metaScore);

  return NextResponse.json({
    schemaVersion: snapshot.schemaVersion,
    season: snapshot.season,
    patch: snapshot.patch,
    fetchedAt: snapshot.fetchedAt,
    live: snapshot.isLive,
    rankBand: snapshot.rankBand,
    totalGames: snapshot.totalGames,
    source: snapshot.source,
    comps
  });
}
