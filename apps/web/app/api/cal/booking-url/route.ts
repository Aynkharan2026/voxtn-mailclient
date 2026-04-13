import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const base = process.env.CALCOM_BASE_URL;
  const username = process.env.CALCOM_USERNAME;
  if (!base || !username) {
    return NextResponse.json(
      {
        error:
          "CALCOM_BASE_URL / CALCOM_USERNAME not configured in apps/web/.env.local",
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    url: `${base.replace(/\/$/, "")}/${encodeURIComponent(username)}`,
    username,
  });
}
