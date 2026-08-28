import { NextRequest, NextResponse } from "next/server";
import compsData from "../../../data/comps.json";
import { recommend } from "../../../lib/recommender";
import { Comp, GameState } from "../../../lib/types";

export async function POST(request: NextRequest) {
  const state = (await request.json()) as GameState;
  const result = recommend(compsData as Comp[], state);
  return NextResponse.json({ generatedAt: new Date().toISOString(), result });
}
