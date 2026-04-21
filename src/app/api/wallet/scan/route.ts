import { NextRequest, NextResponse } from 'next/server';
import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { createHash } from 'crypto';
import { derivePath as ed25519DerivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import { randomUUID, randomBytes } from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Types ───────────────────────────────────────────────────────────────────

type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp';

interface FoundWallet {
  mnemonic: string;
  addresses: { blockchain: Blockchain; address: string; balance: string; symbol: string }[];
  foundAt: number;
}

interface ScanJob {
  id: string;
  wordCount: 12 | 24;
  chains: Blockchain[];
  checkBalance: boolean;
  mode: 'fast' | 'balanced' | 'full';
  status: 'running' | 'stopped' | 'completed';
  scanned: number;
  speed: number;
  found: FoundWallet[];
  startedAt: number;
  lastUpdateAt: number;
  speedHistory: { time: number; scanned: number }[];
  balanceCheckPercent: number;
  error?: string;
  batchSize: number;
  walletsSinceLastBalanceCheck: number;
}

interface ScanState {
  jobs: Map<string, ScanJob>;
  controllers: Map<string, { stopped: boolean }>;
}

// ─── Global state (survives HMR) ────────────────────────────────────────────

const g = globalThis as unknown as { __scanState?: ScanState };

function getScanState(): ScanState {
  if (!g.__scanState) {
    g.__scanState = {
      jobs: new Map(),
      controllers: new Map(),
    };
  }
  return g.__scanState;
}

// ─── Base58 & Hash utilities ─────────────────────────────────────────────────

const BTC_BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const XRP_BASE58_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxy';

function base58Encode(buffer: Buffer, alphabet: string = BTC_BASE58_ALPHABET): string {
  const bytes = buffer;
  let num = BigInt('0x' + bytes.toString('hex'));
  let result = '';
  while (num > 0n) {
    result = alphabet[Number(num % BigInt(alphabet.length))] + result;
    num = num / BigInt(alphabet.length);
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result = alphabet[0] + result;
  }
  return result;
}

function hash160(publicKeyBytes: Buffer): Buffer {
  const sha256Hash = createHash('sha256').update(publicKeyBytes).digest();
  const ripemd160Hash = createHash('ripemd160').update(sha256Hash).digest();
  return ripemd160Hash;
}

function doubleSha256(payload: Buffer): Buffer {
  const first = createHash('sha256').update(payload).digest();
  const second = createHash('sha256').update(first).digest();
  return second;
}

// ─── Derivation paths ───────────────────────────────────────────────────────

const DEFAULT_PATHS: Record<Blockchain, string> = {
  eth: "m/44'/60'/0'/0/0",
  btc: "m/84'/0'/0'/0/0",
  sol: "m/44'/501'/0'/0'",
  xrp: "m/44'/144'/0'/0/0",
};

// ─── Derive one wallet ──────────────────────────────────────────────────────

async function deriveOneWallet(
  entropyBytes: number,
  chains: Blockchain[]
): Promise<{ mnemonic: string; addresses: { blockchain: Blockchain; address: string }[] } | null> {
  try {
    const entropy = randomBytes(entropyBytes);
    const mnemonic = bip39.entropyToMnemonic(entropy);
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const hdNode = HDNodeWallet.fromSeed(seed);
    const seedHex = seed.toString('hex');
    const addresses: { blockchain: Blockchain; address: string }[] = [];

    for (const chain of chains) {
      const path = DEFAULT_PATHS[chain];
      try {
        let address: string;
        switch (chain) {
          case 'eth': {
            const child = hdNode.derivePath(path);
            address = child.address;
            break;
          }
          case 'btc': {
            const child = hdNode.derivePath(path);
            const pubKeyBytes = Buffer.from(child.signingKey.publicKey.slice(4), 'hex');
            const h160 = hash160(pubKeyBytes);
            let versionByte = 0x00;
            if (path.startsWith("m/84'")) versionByte = 0x00;
            else if (path.startsWith("m/49'")) versionByte = 0x05;
            const versionedPayload = Buffer.concat([Buffer.from([versionByte]), h160]);
            const checksum = doubleSha256(versionedPayload).slice(0, 4);
            address = base58Encode(Buffer.concat([versionedPayload, checksum]), BTC_BASE58_ALPHABET);
            break;
          }
          case 'sol': {
            const { key } = ed25519DerivePath(path, seedHex);
            const keypair = nacl.sign.keyPair.fromSeed(key);
            address = base58Encode(Buffer.from(keypair.publicKey));
            break;
          }
          case 'xrp': {
            const child = hdNode.derivePath(path);
            const pubKeyBytes = Buffer.from(child.signingKey.publicKey.slice(4), 'hex');
            const h160 = hash160(pubKeyBytes);
            const versionedPayload = Buffer.concat([Buffer.from([0x00]), h160]);
            const checksum = doubleSha256(versionedPayload).slice(0, 4);
            address = base58Encode(Buffer.concat([versionedPayload, checksum]), XRP_BASE58_ALPHABET);
            break;
          }
          default:
            continue;
        }
        addresses.push({ blockchain: chain, address });
      } catch {
        // skip failed derivation for this chain
      }
    }
    return { mnemonic, addresses };
  } catch {
    return null;
  }
}

// ─── Balance checking ────────────────────────────────────────────────────────

async function checkBalance(chain: Blockchain, address: string): Promise<{ balance: string; symbol: string; hasBalance: boolean } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response: Response;

    switch (chain) {
      case 'eth':
        response = await fetch('https://cloudflare-eth.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const ethData = await response.json();
        if (ethData.result) {
          const weiBigInt = BigInt(ethData.result as string);
          const eth = Number(weiBigInt) / 1e18;
          return { balance: eth.toFixed(8), symbol: 'ETH', hasBalance: eth > 0 };
        }
        return { balance: '0', symbol: 'ETH', hasBalance: false };

      case 'btc':
        response = await fetch(`https://blockchain.info/balance?active=${address}`, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const btcData = await response.json();
        if (btcData[address]) {
          const satoshi = btcData[address].final_balance as number;
          const btc = satoshi / 1e8;
          return { balance: btc.toFixed(8), symbol: 'BTC', hasBalance: satoshi > 0 };
        }
        return { balance: '0', symbol: 'BTC', hasBalance: false };

      case 'sol':
        response = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'getBalance', params: [address], id: 1 }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const solData = await response.json();
        if (solData.result) {
          const lamports = solData.result.value as number;
          const sol = lamports / 1e9;
          return { balance: sol.toFixed(9), symbol: 'SOL', hasBalance: lamports > 0 };
        }
        return { balance: '0', symbol: 'SOL', hasBalance: false };

      case 'xrp':
        response = await fetch('https://s2.ripple.com:51234/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'account_info', params: [{ account: address, ledger_index: 'validated' }] }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const xrpData = await response.json();
        if (xrpData.result?.account_data?.Balance) {
          const drops = Number(xrpData.result.account_data.Balance);
          const xrp = drops / 1e6;
          return { balance: xrp.toFixed(6), symbol: 'XRP', hasBalance: drops > 0 };
        }
        return { balance: '0', symbol: 'XRP', hasBalance: false };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// ─── Lazy batch processing constants ─────────────────────────────────────────

const DEFAULT_BATCH_SIZE = 8;   // Wallets derived per GET poll
const MAX_WALLETS = 5000;       // Max wallets per job
const MAX_RUNTIME_MS = 600000;  // 10 minutes max runtime per job

// ─── Process one batch of wallets (called from GET handler) ─────────────────

async function processBatch(job: ScanJob, ctrl: { stopped: boolean }): Promise<void> {
  const entropyBytes = job.wordCount === 24 ? 32 : 16;
  const batchSize = job.batchSize || DEFAULT_BATCH_SIZE;

  for (let i = 0; i < batchSize; i++) {
    // Check stop conditions at the start of each iteration
    if (ctrl.stopped || job.status !== 'running') {
      if (job.status === 'running') job.status = 'stopped';
      return;
    }
    if (job.scanned >= MAX_WALLETS) {
      job.status = 'completed';
      return;
    }
    if (Date.now() - job.startedAt > MAX_RUNTIME_MS) {
      job.status = 'completed';
      return;
    }

    try {
      const result = await deriveOneWallet(entropyBytes, job.chains);

      if (result && result.addresses.length > 0) {
        // Balance check logic
        if (job.checkBalance) {
          job.walletsSinceLastBalanceCheck++;
          const shouldCheck =
            job.mode === 'full' ||
            (job.walletsSinceLastBalanceCheck % Math.max(1, Math.round(100 / job.balanceCheckPercent))) === 0;

          if (shouldCheck) {
            const balanceResults = await Promise.all(
              result.addresses.map(async (addr) => {
                const bal = await checkBalance(addr.blockchain, addr.address);
                return { ...addr, ...bal };
              })
            );

            const fundedAddresses = balanceResults.filter(
              (r): r is typeof r & { balance: string; symbol: string; hasBalance: boolean } =>
                r.hasBalance === true && r.balance !== undefined
            );

            if (fundedAddresses.length > 0) {
              job.found.push({
                mnemonic: result.mnemonic,
                addresses: fundedAddresses.map((r) => ({
                  blockchain: r.blockchain,
                  address: r.address,
                  balance: r.balance,
                  symbol: r.symbol,
                })),
                foundAt: Date.now(),
              });
            }
          }
        }
      }

      // Update stats
      job.scanned++;
      const elapsed = (Date.now() - job.startedAt) / 1000;
      job.speed = elapsed > 0 ? Math.round(job.scanned / elapsed) : 0;
      job.lastUpdateAt = Date.now();
      job.speedHistory.push({ time: Date.now(), scanned: job.scanned });
      if (job.speedHistory.length > 60) job.speedHistory.shift();

    } catch (err) {
      console.error('Scan batch item error:', err);
    }
  }
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// POST /api/wallet/scan - Start a new scan job (returns immediately, no background work)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      wordCount = 12,
      chains = ['eth'],
      mode = 'balanced',
      batchSize,
      balanceCheckPercent = 10,
    } = body as {
      wordCount?: 12 | 24;
      chains?: Blockchain[];
      mode?: 'full' | 'fast' | 'balanced';
      batchSize?: number;
      balanceCheckPercent?: number;
    };

    const validBlockchains: Blockchain[] = ['btc', 'eth', 'sol', 'xrp'];
    const filteredChains = chains.filter((c) => validBlockchains.includes(c));
    if (filteredChains.length === 0) {
      return NextResponse.json(
        { error: 'At least one blockchain must be selected' },
        { status: 400 }
      );
    }

    const wc: 12 | 24 = wordCount === 24 ? 24 : 12;
    const state = getScanState();

    const job: ScanJob = {
      id: randomUUID(),
      wordCount: wc,
      chains: filteredChains,
      checkBalance: mode !== 'fast',
      mode,
      status: 'running',
      scanned: 0,
      speed: 0,
      found: [],
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
      speedHistory: [],
      balanceCheckPercent,
      batchSize: batchSize || DEFAULT_BATCH_SIZE,
      walletsSinceLastBalanceCheck: 0,
    };

    const controller = { stopped: false };
    state.controllers.set(job.id, controller);
    state.jobs.set(job.id, job);

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      wordCount: job.wordCount,
      chains: job.chains,
      checkBalance: job.checkBalance,
      mode,
      batchSize: job.batchSize,
    });
  } catch (err) {
    console.error('Scan start error:', err);
    return NextResponse.json({ error: 'Failed to start scan' }, { status: 500 });
  }
}

// GET /api/wallet/scan?jobId=xxx - Poll scan job status AND process a batch
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const state = getScanState();
  const job = state.jobs.get(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // If job is still running, process a small batch of wallets now
  if (job.status === 'running') {
    const ctrl = state.controllers.get(jobId);
    if (ctrl && !ctrl.stopped) {
      try {
        await processBatch(job, ctrl);
      } catch (err) {
        console.error('Batch processing error:', err);
        job.error = 'Batch processing error occurred';
      }
    } else {
      if (job.status === 'running') job.status = 'stopped';
    }
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
    mode: job.mode,
    balanceCheckPercent: job.balanceCheckPercent,
    speedHistory: job.speedHistory.slice(-30),
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

  const state = getScanState();
  const controller = state.controllers.get(jobId);
  if (controller) controller.stopped = true;

  const job = state.jobs.get(jobId);
  if (job && job.status === 'running') {
    job.status = 'stopped';
  }

  state.controllers.delete(jobId);
  const deleted = state.jobs.delete(jobId);

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

  const state = getScanState();
  const controller = state.controllers.get(jobId);
  if (controller) controller.stopped = true;

  const job = state.jobs.get(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found or already stopped' }, { status: 404 });
  }

  if (job.status === 'running') {
    job.status = 'stopped';
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    scanned: job.scanned,
    speed: job.speed,
    found: job.found,
  });
}
