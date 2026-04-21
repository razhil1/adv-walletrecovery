import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SCANNER_SERVICE_PORT = 3002;

// Helper to proxy requests to the scanner mini-service
async function proxyToScanner(path: string, method: string, body?: unknown) {
  const baseUrl = `http://localhost:${SCANNER_SERVICE_PORT}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(baseUrl, options);
  return res.json();
}

// POST /api/wallet/scan - Start a new scan job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Proxy to scanner service
    const result = await proxyToScanner('/scan', 'POST', body);
    
    if (result.error) {
      return NextResponse.json(result, { status: 400 });
    }
    
    return NextResponse.json(result);
  } catch (err) {
    console.error('Scan start error:', err);
    return NextResponse.json({ error: 'Failed to start scan - scanner service may be unavailable' }, { status: 503 });
  }
}

// GET /api/wallet/scan?jobId=xxx - Get scan job status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const result = await proxyToScanner(`/scan?jobId=${jobId}`, 'GET');
    
    if (result.error) {
      return NextResponse.json(result, { status: result.error.includes('not found') ? 404 : 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('Scan status error:', err);
    return NextResponse.json({ error: 'Scanner service unavailable' }, { status: 503 });
  }
}

// DELETE /api/wallet/scan?jobId=xxx - Stop and delete a scan job
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const result = await proxyToScanner(`/scan?jobId=${jobId}`, 'DELETE');
    return NextResponse.json(result);
  } catch (err) {
    console.error('Scan delete error:', err);
    return NextResponse.json({ error: 'Scanner service unavailable' }, { status: 503 });
  }
}

// PATCH /api/wallet/scan?jobId=xxx - Stop a scan job (keep it for results)
export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const result = await proxyToScanner(`/scan?jobId=${jobId}`, 'PATCH');
    
    if (result.error) {
      return NextResponse.json(result, { status: result.error.includes('not found') ? 404 : 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('Scan stop error:', err);
    return NextResponse.json({ error: 'Scanner service unavailable' }, { status: 503 });
  }
}
