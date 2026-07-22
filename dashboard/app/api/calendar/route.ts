// dashboard/app/api/calendar/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      next: { revalidate: 300 } // cache for 5 minutes
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch from source: ${res.status}` }, { status: 500 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
