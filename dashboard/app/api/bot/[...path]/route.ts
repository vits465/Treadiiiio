// dashboard/app/api/bot/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BOT_API_URL = (process.env.NEXT_PUBLIC_BOT_API_URL || "http://localhost:4000").trim();
const API_KEY = (process.env.NEXT_PUBLIC_API_KEY || "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8").trim();

// Prioritize local bot API URL first, followed by external tunnels
const FALLBACK_TUNNEL_URLS = [
  "http://localhost:4000",
  BOT_API_URL,
  "https://curvy-panther-15.loca.lt",
  "https://2dbd0045144a97bb-150-107-241-89.serveousercontent.com",
  "https://deluge-footsie-dander.ngrok-free.dev",
];

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
  const subpath = pathSegments.join('/');
  
  if (subpath === 'debug-env') {
    return NextResponse.json({
      BOT_API_URL,
      FALLBACK_TUNNEL_URLS,
      API_KEY: API_KEY ? `${API_KEY.substring(0, 4)}...${API_KEY.substring(API_KEY.length - 4)}` : 'missing',
      NODE_ENV: process.env.NODE_ENV,
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
    "Bypass-Tunnel-Reminder": "true",
    "bypass-tunnel-reminder": "true",
    "ngrok-skip-browser-warning": "true",
  };

  let bodyText: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    bodyText = await req.text();
  }

  // Deduplicate candidate URLs
  const candidateBaseUrls = Array.from(new Set(FALLBACK_TUNNEL_URLS.filter(Boolean)));
  let lastError: any = null;

  for (const baseUrl of candidateBaseUrls) {
    try {
      const targetUrl = `${baseUrl}/api/${subpath}${req.nextUrl.search}`;
      const fetchInit: RequestInit = {
        method: req.method,
        headers,
        body: bodyText,
        signal: AbortSignal.timeout(5000),
      };

      const res = await fetch(targetUrl, fetchInit);

      if (res.status === 503 || res.status === 502) {
        lastError = new Error(`Tunnel ${baseUrl} returned HTTP ${res.status}`);
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        return NextResponse.json(json, { status: res.status });
      } else {
        const text = await res.text();
        // Catch localtunnel 200 OK pseudo-errors
        if (text.includes("Tunnel Unavailable") || text.includes("Forbidden") || text.includes("tunnel error")) {
          lastError = new Error(`Tunnel ${baseUrl} returned pseudo-error: ${text}`);
          continue;
        }
        return new NextResponse(text, { status: res.status, headers: { "content-type": contentType } });
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  return NextResponse.json({ error: `Proxy failed on all candidate tunnels: ${lastError?.message}` }, { status: 500 });
}
