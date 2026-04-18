import { NextRequest, NextResponse } from 'next/server';
import {
  createJob,
  getJob,
  getAllJobs,
  startRecovery,
  stopRecovery,
  type Blockchain,
} from '@/lib/crypto-recovery';

export const runtime = 'nodejs';

// POST /api/recover - Start a new recovery job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { partialMnemonic, knownAddress, blockchain, derivationPath } = body as {
      partialMnemonic: (string | null)[];
      knownAddress: string;
      blockchain: Blockchain;
      derivationPath?: string;
    };

    // Validate inputs
    if (!partialMnemonic || !Array.isArray(partialMnemonic)) {
      return NextResponse.json(
        { error: 'partialMnemonic must be an array' },
        { status: 400 }
      );
    }

    if (partialMnemonic.length !== 12) {
      return NextResponse.json(
        { error: 'partialMnemonic must have exactly 12 elements' },
        { status: 400 }
      );
    }

    if (!knownAddress || typeof knownAddress !== 'string') {
      return NextResponse.json(
        { error: 'knownAddress is required' },
        { status: 400 }
      );
    }

    const validBlockchains: Blockchain[] = ['btc', 'eth', 'sol', 'xrp'];
    if (!validBlockchains.includes(blockchain)) {
      return NextResponse.json(
        { error: `blockchain must be one of: ${validBlockchains.join(', ')}` },
        { status: 400 }
      );
    }

    // Count unknown words (null entries)
    const unknownCount = partialMnemonic.filter((w) => w === null).length;

    if (unknownCount === 0) {
      // Still allow it - just validates the single candidate
    } else if (unknownCount > 4) {
      return NextResponse.json(
        {
          error: `Too many unknown words (${unknownCount}). Maximum 4 unknown words supported. For practical recovery, 1-2 unknowns is recommended.`,
        },
        { status: 400 }
      );
    }

    // Validate known words are in BIP39 wordlist
    const knownWordCount = partialMnemonic.filter((w) => w !== null).length;
    if (knownWordCount < 8) {
      return NextResponse.json(
        {
          error: `At least 8 known words are required. You provided ${knownWordCount}.`,
        },
        { status: 400 }
      );
    }

    // Create and start the job
    const job = createJob(partialMnemonic, knownAddress.trim(), blockchain, derivationPath);
    startRecovery(job);

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    console.error('Recovery POST error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/recover?jobId=xxx - Get job status (or all jobs if no jobId)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      // Return all jobs
      const allJobs = getAllJobs();
      return NextResponse.json({ jobs: allJobs });
    }

    const job = getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (err) {
    console.error('Recovery GET error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/recover?jobId=xxx - Stop a running job
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId query parameter is required' },
        { status: 400 }
      );
    }

    const success = stopRecovery(jobId);
    return NextResponse.json({ success });
  } catch (err) {
    console.error('Recovery DELETE error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
