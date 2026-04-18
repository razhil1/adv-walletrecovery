import { NextResponse } from 'next/server';
import { getWordlist } from '@/lib/crypto-recovery';

export const runtime = 'nodejs';

// Cache the wordlist data (not the response object)
let cachedWords: string[] | null = null;

// GET /api/wordlist - Returns the BIP39 English wordlist
export async function GET() {
  if (!cachedWords) {
    cachedWords = getWordlist();
  }
  return NextResponse.json({ words: cachedWords });
}
