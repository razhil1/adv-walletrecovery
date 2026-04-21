import { NextRequest, NextResponse } from 'next/server';
import * as bip39 from 'bip39';

export const runtime = 'nodejs';

// POST /api/wallet/generate - Generate a random BIP39 seed phrase
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wordCount } = body as { wordCount?: number };

    // Validate word count
    const count = wordCount === 24 ? 24 : 12;
    // BIP39 entropy: 128 bits for 12 words, 256 bits for 24 words
    const strength = count === 24 ? 256 : 128;

    const mnemonic = bip39.generateMnemonic(strength);

    return NextResponse.json({
      mnemonic,
      wordCount: count,
      entropy: strength,
    });
  } catch (err) {
    console.error('Wallet generate error:', err);
    return NextResponse.json(
      { error: 'Failed to generate wallet' },
      { status: 500 }
    );
  }
}
