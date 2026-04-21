import { NextRequest, NextResponse } from 'next/server';
import { type Blockchain } from '@/lib/crypto-recovery';

export const runtime = 'nodejs';

interface BalanceResult {
  address: string;
  blockchain: Blockchain;
  balance: string;
  symbol: string;
  decimals: number;
  usdValue?: string;
  error?: string;
}

async function fetchETHBalance(address: string): Promise<Omit<BalanceResult, 'address' | 'blockchain'>> {
  try {
    // Use public Ethereum RPC
    const response = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    const data = await response.json();
    if (data.result) {
      // Convert hex wei to ETH
      const weiHex = data.result as string;
      const weiBigInt = BigInt(weiHex);
      const eth = Number(weiBigInt) / 1e18;
      return { balance: eth.toFixed(8), symbol: 'ETH', decimals: 8 };
    }
    return { balance: '0', symbol: 'ETH', decimals: 8, error: 'No result' };
  } catch (err) {
    return { balance: '0', symbol: 'ETH', decimals: 8, error: String(err) };
  }
}

async function fetchBTCBalance(address: string): Promise<Omit<BalanceResult, 'address' | 'blockchain'>> {
  try {
    const response = await fetch(`https://blockchain.info/balance?active=${address}`, {
      headers: { 'Accept': 'application/json' },
    });
    const data = await response.json();
    if (data[address]) {
      const satoshi = data[address].final_balance as number;
      const btc = satoshi / 1e8;
      return { balance: btc.toFixed(8), symbol: 'BTC', decimals: 8 };
    }
    return { balance: '0', symbol: 'BTC', decimals: 8, error: 'No result' };
  } catch (err) {
    return { balance: '0', symbol: 'BTC', decimals: 8, error: String(err) };
  }
}

async function fetchSOLBalance(address: string): Promise<Omit<BalanceResult, 'address' | 'blockchain'>> {
  try {
    const response = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
        id: 1,
      }),
    });
    const data = await response.json();
    if (data.result) {
      const lamports = data.result.value as number;
      const sol = lamports / 1e9;
      return { balance: sol.toFixed(9), symbol: 'SOL', decimals: 9 };
    }
    return { balance: '0', symbol: 'SOL', decimals: 9, error: 'No result' };
  } catch (err) {
    return { balance: '0', symbol: 'SOL', decimals: 9, error: String(err) };
  }
}

async function fetchXRPBalance(address: string): Promise<Omit<BalanceResult, 'address' | 'blockchain'>> {
  try {
    const response = await fetch('https://s2.ripple.com:51234/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_info',
        params: [{ account: address, ledger_index: 'validated' }],
      }),
    });
    const data = await response.json();
    if (data.result?.account_data?.Balance) {
      const drops = Number(data.result.account_data.Balance);
      const xrp = drops / 1e6;
      return { balance: xrp.toFixed(6), symbol: 'XRP', decimals: 6 };
    }
    return { balance: '0', symbol: 'XRP', decimals: 6, error: 'Account not found or empty' };
  } catch (err) {
    return { balance: '0', symbol: 'XRP', decimals: 6, error: String(err) };
  }
}

// POST /api/wallet/balance - Check wallet balance for a specific address
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, blockchain } = body as { address: string; blockchain: Blockchain };

    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'address is required' }, { status: 400 });
    }

    const validBlockchains: Blockchain[] = ['btc', 'eth', 'sol', 'xrp'];
    if (!validBlockchains.includes(blockchain)) {
      return NextResponse.json(
        { error: `blockchain must be one of: ${validBlockchains.join(', ')}` },
        { status: 400 }
      );
    }

    let result: Omit<BalanceResult, 'address' | 'blockchain'>;

    switch (blockchain) {
      case 'eth':
        result = await fetchETHBalance(address);
        break;
      case 'btc':
        result = await fetchBTCBalance(address);
        break;
      case 'sol':
        result = await fetchSOLBalance(address);
        break;
      case 'xrp':
        result = await fetchXRPBalance(address);
        break;
      default:
        result = { balance: '0', symbol: '', decimals: 0, error: 'Unsupported blockchain' };
    }

    return NextResponse.json({
      address,
      blockchain,
      ...result,
    });
  } catch (err) {
    console.error('Balance check error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
