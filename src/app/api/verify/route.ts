import { NextRequest, NextResponse } from 'next/server';
import { verifyMnemonic, type Blockchain } from '@/lib/crypto-recovery';

export const runtime = 'nodejs';

// POST /api/verify - Quick verify a complete seed phrase against a known address
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mnemonic, knownAddress, blockchain, derivationPath } = body as {
      mnemonic: string;
      knownAddress: string;
      blockchain: Blockchain;
      derivationPath?: string;
    };

    // Validate inputs
    if (!mnemonic || typeof mnemonic !== 'string') {
      return NextResponse.json(
        { error: 'mnemonic is required' },
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

    const result = await verifyMnemonic(mnemonic.trim(), knownAddress.trim(), blockchain, derivationPath);

    return NextResponse.json(result);
  } catch (err) {
    console.error('Verify POST error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
