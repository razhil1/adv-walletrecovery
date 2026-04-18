import { NextRequest, NextResponse } from 'next/server';
import { deriveAddress, type Blockchain } from '@/lib/crypto-recovery';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mnemonic, blockchain, derivationPath } = body as {
      mnemonic: string;
      blockchain: Blockchain;
      derivationPath?: string;
    };

    if (!mnemonic || typeof mnemonic !== 'string') {
      return NextResponse.json({ error: 'mnemonic is required' }, { status: 400 });
    }

    const validBlockchains: Blockchain[] = ['btc', 'eth', 'sol', 'xrp'];
    if (!validBlockchains.includes(blockchain)) {
      return NextResponse.json({ error: `blockchain must be one of: ${validBlockchains.join(', ')}` }, { status: 400 });
    }

    // Validate mnemonic
    const bip39 = await import('bip39');
    if (!bip39.validateMnemonic(mnemonic.trim())) {
      return NextResponse.json({ error: 'Invalid mnemonic checksum' }, { status: 400 });
    }

    const address = await deriveAddress(mnemonic.trim(), blockchain, derivationPath);
    return NextResponse.json({ address, blockchain, derivationPath: derivationPath || 'default' });
  } catch (err) {
    console.error('Derive POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
