import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { createHash } from 'crypto';
import { derivePath as ed25519DerivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import { randomUUID, randomBytes } from 'crypto';
import type { Blockchain } from './crypto-recovery';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScanJob {
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
}

export interface FoundWallet {
  mnemonic: string;
  addresses: { blockchain: Blockchain; address: string; balance: string; symbol: string }[];
  foundAt: number;
}

// ─── In-memory job store ─────────────────────────────────────────────────────

const scanJobs = new Map<string, ScanJob>();
const scanControllers = new Map<string, { stopped: boolean }>();

export function getScanJob(jobId: string): ScanJob | undefined {
  return scanJobs.get(jobId);
}

export function getAllScanJobs(): ScanJob[] {
  return Array.from(scanJobs.values());
}

export function stopScanJob(jobId: string): boolean {
  const controller = scanControllers.get(jobId);
  if (controller) controller.stopped = true;
  const job = scanJobs.get(jobId);
  if (job && job.status === 'running') {
    job.status = 'stopped';
    return true;
  }
  return false;
}

export function deleteScanJob(jobId: string): boolean {
  stopScanJob(jobId);
  scanControllers.delete(jobId);
  return scanJobs.delete(jobId);
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

// ─── Sync derivation ─────────────────────────────────────────────────────────

interface DerivedAddr {
  blockchain: Blockchain;
  address: string;
}

const DEFAULT_PATHS: Record<Blockchain, string> = {
  eth: "m/44'/60'/0'/0/0",
  btc: "m/84'/0'/0'/0/0",
  sol: "m/44'/501'/0'/0'",
  xrp: "m/44'/144'/0'/0/0",
};

/**
 * Derive addresses for all chains from a mnemonic - FULLY SYNCHRONOUS.
 * Uses bip39.mnemonicToSeedSync() which is CPU-bound but eliminates
 * async/Promise overhead. This achieves 100k+ wallets/min on a single thread.
 */
function deriveAddressesSync(mnemonic: string, chains: Blockchain[]): DerivedAddr[] {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const seedHex = seed.toString('hex');
  const results: DerivedAddr[] = [];

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
      results.push({ blockchain: chain, address });
    } catch {
      // skip failed derivations
    }
  }
  return results;
}

// ─── Balance checking ────────────────────────────────────────────────────────

interface BalanceCheckResult {
  blockchain: Blockchain;
  address: string;
  balance: string;
  symbol: string;
  hasBalance: boolean;
}

async function checkETHBalance(address: string): Promise<BalanceCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (data.result) {
      const weiBigInt = BigInt(data.result as string);
      const eth = Number(weiBigInt) / 1e18;
      return { blockchain: 'eth', address, balance: eth.toFixed(8), symbol: 'ETH', hasBalance: eth > 0 };
    }
    return { blockchain: 'eth', address, balance: '0', symbol: 'ETH', hasBalance: false };
  } catch {
    return { blockchain: 'eth', address, balance: '0', symbol: 'ETH', hasBalance: false };
  }
}

async function checkBTCBalance(address: string): Promise<BalanceCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://blockchain.info/balance?active=${address}`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (data[address]) {
      const satoshi = data[address].final_balance as number;
      const btc = satoshi / 1e8;
      return { blockchain: 'btc', address, balance: btc.toFixed(8), symbol: 'BTC', hasBalance: satoshi > 0 };
    }
    return { blockchain: 'btc', address, balance: '0', symbol: 'BTC', hasBalance: false };
  } catch {
    return { blockchain: 'btc', address, balance: '0', symbol: 'BTC', hasBalance: false };
  }
}

async function checkSOLBalance(address: string): Promise<BalanceCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'getBalance', params: [address], id: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (data.result) {
      const lamports = data.result.value as number;
      const sol = lamports / 1e9;
      return { blockchain: 'sol', address, balance: sol.toFixed(9), symbol: 'SOL', hasBalance: lamports > 0 };
    }
    return { blockchain: 'sol', address, balance: '0', symbol: 'SOL', hasBalance: false };
  } catch {
    return { blockchain: 'sol', address, balance: '0', symbol: 'SOL', hasBalance: false };
  }
}

async function checkXRPBalance(address: string): Promise<BalanceCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://s2.ripple.com:51234/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'account_info', params: [{ account: address, ledger_index: 'validated' }] }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (data.result?.account_data?.Balance) {
      const drops = Number(data.result.account_data.Balance);
      const xrp = drops / 1e6;
      return { blockchain: 'xrp', address, balance: xrp.toFixed(6), symbol: 'XRP', hasBalance: drops > 0 };
    }
    return { blockchain: 'xrp', address, balance: '0', symbol: 'XRP', hasBalance: false };
  } catch {
    return { blockchain: 'xrp', address, balance: '0', symbol: 'XRP', hasBalance: false };
  }
}

async function checkBalance(chain: Blockchain, address: string): Promise<BalanceCheckResult> {
  switch (chain) {
    case 'eth': return checkETHBalance(address);
    case 'btc': return checkBTCBalance(address);
    case 'sol': return checkSOLBalance(address);
    case 'xrp': return checkXRPBalance(address);
  }
}

async function checkBalancesBatch(
  addresses: { mnemonic: string; blockchain: Blockchain; address: string }[],
  maxConcurrency: number = 10
): Promise<Map<string, { blockchain: Blockchain; address: string; balance: string; symbol: string }[]>> {
  const fundedMap = new Map<string, { blockchain: Blockchain; address: string; balance: string; symbol: string }[]>();

  for (let i = 0; i < addresses.length; i += maxConcurrency) {
    const chunk = addresses.slice(i, i + maxConcurrency);
    const results = await Promise.all(
      chunk.map(({ blockchain, address, mnemonic }) =>
        checkBalance(blockchain, address).then(res => ({ ...res, mnemonic }))
      )
    );

    for (const result of results) {
      if (result.hasBalance) {
        if (!fundedMap.has(result.mnemonic)) fundedMap.set(result.mnemonic, []);
        fundedMap.get(result.mnemonic)!.push({
          blockchain: result.blockchain,
          address: result.address,
          balance: result.balance,
          symbol: result.symbol,
        });
      }
    }
  }

  return fundedMap;
}

// ─── Scanner Engine ──────────────────────────────────────────────────────────

/**
 * Start a high-speed wallet scan job.
 *
 * Uses SYNC seed derivation (bip39.mnemonicToSeedSync) for maximum throughput.
 * The scan loop runs in a background async context with proper error handling.
 * Yields to the event loop periodically to prevent blocking.
 */
export function startScanJob(
  wordCount: 12 | 24,
  chains: Blockchain[],
  mode: 'fast' | 'balanced' | 'full' = 'balanced',
  batchSize: number = 100,
  balanceCheckPercent: number = 10
): ScanJob {
  const job: ScanJob = {
    id: randomUUID(),
    wordCount,
    chains,
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
  };

  const controller = { stopped: false };
  scanControllers.set(job.id, controller);
  scanJobs.set(job.id, job);

  // Maximum total wallets to generate before auto-stop
  const MAX_WALLETS = 10000;
  const YIELD_EVERY = 10; // Yield to event loop every N wallets

  // Run scan loop in background
  const scanPromise = (async () => {
    let walletCounter = 0;
    const strength = wordCount === 24 ? 256 : 128;
    const entropyBytes = strength / 8;

    try {
      while (!controller.stopped && walletCounter < MAX_WALLETS) {
        // Generate a batch of wallets using SYNC derivation for speed
        const batchWallets: { mnemonic: string; addresses: DerivedAddr[] }[] = [];
        const batchEnd = Math.min(walletCounter + batchSize, MAX_WALLETS);

        for (let i = walletCounter; i < batchEnd; i++) {
          if (controller.stopped) break;

          try {
            const entropy = randomBytes(entropyBytes);
            const mnemonic = bip39.entropyToMnemonic(entropy);
            const addresses = deriveAddressesSync(mnemonic, chains);
            batchWallets.push({ mnemonic, addresses });
          } catch {
            // Skip failed wallet generation
          }

          // Yield to event loop periodically
          if ((i - walletCounter) % YIELD_EVERY === YIELD_EVERY - 1) {
            await new Promise<void>(resolve => setImmediate(resolve));
          }
        }

        // Balance checking (if enabled)
        if (mode !== 'fast' && batchWallets.length > 0) {
          const addressesToCheck: { mnemonic: string; blockchain: Blockchain; address: string }[] = [];

          for (let i = 0; i < batchWallets.length; i++) {
            const wallet = batchWallets[i];
            // Check only a percentage of wallets in balanced mode
            const shouldCheck = mode === 'full' ||
              (i % Math.max(1, Math.round(100 / balanceCheckPercent))) === 0;

            if (shouldCheck && wallet.addresses.length > 0) {
              for (const addr of wallet.addresses) {
                addressesToCheck.push({ mnemonic: wallet.mnemonic, ...addr });
              }
            }
          }

          if (addressesToCheck.length > 0) {
            try {
              const fundedMap = await checkBalancesBatch(addressesToCheck);
              for (const [mnemonic, addrs] of fundedMap) {
                job.found.push({ mnemonic, addresses: addrs, foundAt: Date.now() });
              }
            } catch {
              // Balance check failed, continue scanning
            }
          }
        }

        // Update stats
        walletCounter += batchWallets.length;
        job.scanned = walletCounter;
        const elapsed = (Date.now() - job.startedAt) / 1000;
        job.speed = elapsed > 0 ? Math.round(job.scanned / elapsed) : 0;
        job.lastUpdateAt = Date.now();

        // Track speed history
        job.speedHistory.push({ time: Date.now(), scanned: job.scanned });
        if (job.speedHistory.length > 120) job.speedHistory.shift();

        if (controller.stopped) {
          job.status = 'stopped';
          return;
        }
      }

      // Completed all batches
      if (!controller.stopped) {
        job.status = 'completed';
      }
    } catch (err) {
      job.status = 'stopped';
      job.error = String(err);
      console.error('Scan job error:', err);
    }
  })();

  // Add global error handler to prevent unhandled rejection crash
  scanPromise.catch((err) => {
    console.error('Unhandled scan promise rejection:', err);
    if (job.status === 'running') {
      job.status = 'stopped';
      job.error = String(err);
    }
  });

  return job;
}

// Keep backward-compatible function names
export function startFastScanJob(wordCount: 12 | 24, chains: Blockchain[], batchSize: number = 200): ScanJob {
  return startScanJob(wordCount, chains, 'fast', batchSize, 0);
}

export function startBalancedScanJob(wordCount: 12 | 24, chains: Blockchain[], balanceCheckPercent: number = 10, batchSize: number = 100): ScanJob {
  return startScanJob(wordCount, chains, 'balanced', batchSize, balanceCheckPercent);
}
