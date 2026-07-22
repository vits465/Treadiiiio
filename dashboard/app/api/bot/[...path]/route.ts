// dashboard/app/api/bot/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BOT_API_URL = (process.env.NEXT_PUBLIC_BOT_API_URL || "http://localhost:4000").trim();
const API_KEY = (process.env.NEXT_PUBLIC_API_KEY || "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8").trim();

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path);
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path);
}

async function handleProxy(req: NextRequest, pathSegments: string[]) {
  try {
    const subpath = pathSegments.join('/');
    
    if (subpath === 'debug-env') {
      return NextResponse.json({
        BOT_API_URL,
        API_KEY: API_KEY ? `${API_KEY.substring(0, 4)}...${API_KEY.substring(API_KEY.length - 4)}` : 'missing',
        NODE_ENV: process.env.NODE_ENV,
      });
    }

    if (subpath === 'test-fetch') {
      try {
        const testRes = await fetch(`${BOT_API_URL}/api/config`, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "bypass-tunnel-reminder": "true",
          }
        });
        const status = testRes.status;
        const text = await testRes.text();
        return NextResponse.json({ success: true, status, text });
      } catch (fetchErr: any) {
        return NextResponse.json({ success: false, error: fetchErr.message, stack: fetchErr.stack });
      }
    }

    const targetUrl = `${BOT_API_URL}/api/${subpath}${req.nextUrl.search}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "Bypass-Tunnel-Reminder": "true",
      "bypass-tunnel-reminder": "true",
    };

    const fetchInit: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const bodyText = await req.text();
      if (bodyText) {
        fetchInit.body = bodyText;
      }
    }

    const res = await fetch(targetUrl, fetchInit);
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const json = await res.json();
      return NextResponse.json(json, { status: res.status });
    } else {
      const text = await res.text();
      return new NextResponse(text, { status: res.status, headers: { "content-type": contentType } });
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Proxy failed: ${err.message}` }, { status: 500 });
  }
}
