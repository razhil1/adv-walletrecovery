import { NextRequest, NextResponse } from 'next/server';
import { type Blockchain } from '@/lib/crypto-recovery';
import {
  startScanJob,
  startFastScanJob,
  startBalancedScanJob,
  getScanJob,
  stopScanJob,
  deleteScanJob,
} from '@/lib/wallet-scanner';

export const runtime = 'nodejs';

// POST /api/wallet/scan - Start a new scan job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      wordCount = 12,
      chains = ['eth'],
      checkBalance = true,
      mode = 'balanced',
      batchSize = 100,
      balanceCheckPercent = 10,
    } = body as {
      wordCount?: 12 | 24;
      chains?: Blockchain[];
      checkBalance?: boolean;
      mode?: 'full' | 'fast' | 'balanced';
      batchSize?: number;
      balanceCheckPercent?: number;
    };

    // Validate chains
    const validBlockchains: Blockchain[] = ['btc', 'eth', 'sol', 'xrp'];
    const filteredChains = chains.filter((c) => validBlockchains.includes(c));
    if (filteredChains.length === 0) {
      return NextResponse.json(
        { error: 'At least one blockchain must be selected' },
        { status: 400 }
      );
    }

    const wc: 12 | 24 = wordCount === 24 ? 24 : 12;

    let job;
    switch (mode) {
      case 'fast':
        // Ultra-fast: no balance checking, pure generation + derivation
        job = startFastScanJob(wc, filteredChains, batchSize);
        break;
      case 'balanced':
        // Balanced: generate fast, check balance on a percentage
        job = startBalancedScanJob(wc, filteredChains, balanceCheckPercent, batchSize);
        break;
      case 'full':
      default:
        // Full: check balance on every wallet (slow but thorough)
        job = startScanJob(wc, filteredChains, checkBalance, batchSize);
        break;
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      wordCount: job.wordCount,
      chains: job.chains,
      checkBalance: job.checkBalance,
      mode,
    });
  } catch (err) {
    console.error('Scan start error:', err);
    return NextResponse.json({ error: 'Failed to start scan' }, { status: 500 });
  }
}

// GET /api/wallet/scan?jobId=xxx - Get scan job status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const job = getScanJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    scanned: job.scanned,
    speed: job.speed,
    found: job.found,
    foundCount: job.found.length,
    startedAt: job.startedAt,
    lastUpdateAt: job.lastUpdateAt,
    elapsed: (Date.now() - job.startedAt) / 1000,
    wordCount: job.wordCount,
    chains: job.chains,
    checkBalance: job.checkBalance,
    error: job.error,
  });
}

// DELETE /api/wallet/scan?jobId=xxx - Stop and delete a scan job
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const deleted = deleteScanJob(jobId);
  if (!deleted) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, jobId });
}

// PATCH /api/wallet/scan?jobId=xxx - Stop a scan job (keep it for results)
export async function PATCH(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const stopped = stopScanJob(jobId);
  if (!stopped) {
    return NextResponse.json({ error: 'Job not found or already stopped' }, { status: 404 });
  }

  const job = getScanJob(jobId);
  return NextResponse.json({
    jobId: job?.id,
    status: job?.status,
    scanned: job?.scanned,
    speed: job?.speed,
    found: job?.found,
  });
}
