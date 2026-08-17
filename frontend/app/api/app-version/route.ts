import { NextResponse } from 'next/server';

/**
 * The build currently being served. Compared against the build id compiled
 * into the client bundle to spot a tab that has been open across a deploy.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
