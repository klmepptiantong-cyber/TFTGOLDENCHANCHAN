import { NextResponse } from "next/server";
import statusJson from "../../../data/source-status.json";
import { SourceStatus } from "../../../lib/types";

const status = statusJson as SourceStatus;

export async function GET() {
  return NextResponse.json(status);
}
