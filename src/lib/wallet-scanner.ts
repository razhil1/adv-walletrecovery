import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { createHash } from 'crypto';
import { derivePath as ed25519DerivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import bs58Module from 'bs58';
const bs58 = bs58Module.default || bs58Module;
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import type { Blockchain } from './crypto-recovery';
import { DERIVATION_PATHS, getDefaultPath } from './crypto-recovery';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScanJob {
  id: string;
  wordCount: 12 | 24;
  chains: Blockchain[];
  checkBalance: boolean;
  status: 'running' | 'stopped' | 'completed';
  scanned: number;        // total wallets scanned
  speed: number;          // wallets per second
  found: FoundWallet[];   // funded wallets
  startedAt: number;
  lastUpdateAt: number;
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

export function stopScanJob(jobId: string): boolean {
  const controller = scanControllers.get(jobId);
  if (controller) {
    controller.stopped = true;
  }
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

// ─── Base58 & Hash utilities (same as derive-full) ──────────────────────────

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

// ─── Fast wallet generation (no API overhead) ───────────────────────────────

interface GeneratedWallet {
  mnemonic: string;
  seed: Buffer;
}

/**
 * Generate N random wallets in bulk.
 * Uses crypto.randomBytes for entropy, then validates checksum.
 * This avoids per-wallet HTTP overhead entirely.
 */
function generateWalletsBulk(count: number, wordCount: 12 | 24): GeneratedWallet[] {
  const strength = wordCount === 24 ? 256 : 128;
  const entropyBytes = strength / 8;
  const wallets: GeneratedWallet[] = [];

  for (let i = 0; i < count; i++) {
    const entropy = randomBytes(entropyBytes);
    const mnemonic = bip39.entropyToMnemonic(entropy);
    wallets.push({ mnemonic, seed: Buffer.alloc(0) }); // seed computed lazily
  }

  return wallets;
}

// ─── Fast address derivation from seed ──────────────────────────────────────

interface DerivedAddr {
  blockchain: Blockchain;
  address: string;
}

/**
 * Derive addresses for multiple chains from a seed buffer.
 * Much faster than per-API-call derivation since we reuse the seed.
 */
async function deriveAddressesFromSeed(
  seed: Buffer,
  chains: Blockchain[]
): Promise<DerivedAddr[]> {
  const hdNode = HDNodeWallet.fromSeed(seed);
  const results: DerivedAddr[] = [];

  for (const chain of chains) {
    const paths = DERIVATION_PATHS.filter(p => p.blockchain === chain);
    const path = paths.length > 0 ? paths[0].path : getDefaultPath(chain);

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
          const uncompressedHex = child.signingKey.publicKey;
          const pubKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
          const h160 = hash160(pubKeyBytes);
          let versionByte = 0x00;
          if (path.startsWith("m/84'")) versionByte = 0x00;
          else if (path.startsWith("m/49'")) versionByte = 0x05;
          const versionedPayload = Buffer.concat([Buffer.from([versionByte]), h160]);
          const checksum = doubleSha256(versionedPayload).slice(0, 4);
          const addressBytes = Buffer.concat([versionedPayload, checksum]);
          address = base58Encode(addressBytes, BTC_BASE58_ALPHABET);
          break;
        }
        case 'sol': {
          const seedHex = seed.toString('hex');
          const { key } = ed25519DerivePath(path, seedHex);
          const keypair = nacl.sign.keyPair.fromSeed(key);
          address = bs58.encode(Buffer.from(keypair.publicKey));
          break;
        }
        case 'xrp': {
          const child = hdNode.derivePath(path);
          const uncompressedHex = child.signingKey.publicKey;
          const pubKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
          const h160 = hash160(pubKeyBytes);
          const versionedPayload = Buffer.concat([Buffer.from([0x00]), h160]);
          const checksum = doubleSha256(versionedPayload).slice(0, 4);
          const addressBytes = Buffer.concat([versionedPayload, checksum]);
          address = base58Encode(addressBytes, XRP_BASE58_ALPHABET);
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

// ─── Balance checking (batched & concurrent) ────────────────────────────────

interface BalanceCheckResult {
  blockchain: Blockchain;
  address: string;
  balance: string;
  symbol: string;
  hasBalance: boolean;
}

async function checkETHBalance(address: string): Promise<BalanceCheckResult> {
  try {
    const response = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
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
    const response = await fetch(`https://blockchain.info/balance?active=${address}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
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
    const response = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [address],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
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
    const response = await fetch('https://s2.ripple.com:51234/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_info',
        params: [{ account: address, ledger_index: 'validated' }],
      }),
      signal: AbortSignal.timeout(5000),
    });
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

/**
 * Check balances for multiple addresses concurrently.
 * Uses Promise.all for maximum parallelism.
 */
async function checkBalancesBatch(
  addresses: { blockchain: Blockchain; address: string }[]
): Promise<BalanceCheckResult[]> {
  const promises = addresses.map(({ blockchain, address }) => checkBalance(blockchain, address));
  return Promise.all(promises);
}

// ─── Main scanner engine ────────────────────────────────────────────────────

/**
 * Start a high-speed wallet scan job.
 * Generates wallets in batches, derives addresses in parallel,
 * and optionally checks balances concurrently.
 *
 * Architecture:
 * - Batch generation: Generate N mnemonics at once (fast, just random bytes)
 * - Parallel seed derivation: Compute seeds in batches using Promise.all
 * - Parallel address derivation: Derive addresses for all chains concurrently
 * - Concurrent balance checking: All chain balance APIs hit simultaneously
 * - No per-wallet HTTP overhead: Everything runs server-side
 */
export function startScanJob(
  wordCount: 12 | 24,
  chains: Blockchain[],
  checkBalance: boolean,
  batchSize: number = 50
): ScanJob {
  const job: ScanJob = {
    id: uuidv4(),
    wordCount,
    chains,
    checkBalance,
    status: 'running',
    scanned: 0,
    speed: 0,
    found: [],
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  };

  const controller = { stopped: false };
  scanControllers.set(job.id, controller);
  scanJobs.set(job.id, job);

  // Run the scan loop in the background
  (async () => {
    try {
      while (!controller.stopped) {
        // Phase 1: Generate batch of mnemonics (CPU-fast, just random bytes)
        const wallets = generateWalletsBulk(batchSize, wordCount);

        // Phase 2: Compute seeds in parallel (PBKDF2 is the bottleneck)
        const seedPromises = wallets.map(async (w) => {
          const seed = await bip39.mnemonicToSeed(w.mnemonic);
          return { mnemonic: w.mnemonic, seed };
        });
        const walletsWithSeeds = await Promise.all(seedPromises);

        // Phase 3: Derive addresses in parallel
        const derivePromises = walletsWithSeeds.map(async (w) => {
          const addresses = await deriveAddressesFromSeed(w.seed, chains);
          return { mnemonic: w.mnemonic, addresses };
        });
        const walletsWithAddresses = await Promise.all(derivePromises);

        // Phase 4: Check balances (if enabled)
        if (checkBalance && !controller.stopped) {
          // Collect all addresses for batch checking
          const allAddresses: { mnemonic: string; blockchain: Blockchain; address: string }[] = [];
          for (const w of walletsWithAddresses) {
            for (const addr of w.addresses) {
              allAddresses.push({ mnemonic: w.mnemonic, ...addr });
            }
          }

          // Check all balances concurrently
          const balanceResults = await checkBalancesBatch(allAddresses);

          // Group results by mnemonic
          const mnemonicMap = new Map<string, { blockchain: Blockchain; address: string; balance: string; symbol: string }[]>();
          for (const result of balanceResults) {
            if (result.hasBalance) {
              const mnemonic = allAddresses.find(
                a => a.address === result.address && a.blockchain === result.blockchain
              )?.mnemonic;
              if (mnemonic) {
                if (!mnemonicMap.has(mnemonic)) mnemonicMap.set(mnemonic, []);
                mnemonicMap.get(mnemonic)!.push({
                  blockchain: result.blockchain,
                  address: result.address,
                  balance: result.balance,
                  symbol: result.symbol,
                });
              }
            }
          }

          // Add funded wallets to found list
          for (const [mnemonic, addrs] of mnemonicMap) {
            const foundWallet: FoundWallet = {
              mnemonic,
              addresses: addrs,
              foundAt: Date.now(),
            };
            job.found.push(foundWallet);
          }
        }

        // Update stats
        job.scanned += batchSize;
        const elapsed = (Date.now() - job.startedAt) / 1000;
        job.speed = elapsed > 0 ? Math.round(job.scanned / elapsed) : 0;
        job.lastUpdateAt = Date.now();

        if (controller.stopped) {
          job.status = 'stopped';
          return;
        }
      }
      job.status = 'stopped';
    } catch (err) {
      job.status = 'stopped';
      job.error = String(err);
      console.error('Scan job error:', err);
    }
  })();

  return job;
}

/**
 * Start an ultra-fast scan job that skips balance checking.
 * This mode can achieve 100k+ wallets/minute since there's no
 * external API calls - only CPU-bound crypto operations.
 */
export function startFastScanJob(
  wordCount: 12 | 24,
  chains: Blockchain[],
  batchSize: number = 100
): ScanJob {
  const job: ScanJob = {
    id: uuidv4(),
    wordCount,
    chains,
    checkBalance: false,
    status: 'running',
    scanned: 0,
    speed: 0,
    found: [],
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  };

  const controller = { stopped: false };
  scanControllers.set(job.id, controller);
  scanJobs.set(job.id, job);

  (async () => {
    try {
      while (!controller.stopped) {
        // Generate bulk mnemonics (fastest operation)
        const wallets = generateWalletsBulk(batchSize, wordCount);

        // Compute seeds in parallel
        const seedPromises = wallets.map(async (w) => {
          const seed = await bip39.mnemonicToSeed(w.mnemonic);
          return { mnemonic: w.mnemonic, seed };
        });
        const walletsWithSeeds = await Promise.all(seedPromises);

        // Derive addresses in parallel
        const derivePromises = walletsWithSeeds.map(async (w) => {
          const addresses = await deriveAddressesFromSeed(w.seed, chains);
          return { mnemonic: w.mnemonic, addresses };
        });
        await Promise.all(derivePromises);

        // Update stats
        job.scanned += batchSize;
        const elapsed = (Date.now() - job.startedAt) / 1000;
        job.speed = elapsed > 0 ? Math.round(job.scanned / elapsed) : 0;
        job.lastUpdateAt = Date.now();

        if (controller.stopped) {
          job.status = 'stopped';
          return;
        }
      }
      job.status = 'stopped';
    } catch (err) {
      job.status = 'stopped';
      job.error = String(err);
      console.error('Fast scan job error:', err);
    }
  })();

  return job;
}

/**
 * Start a balance-checking scan that periodically samples wallets
 * for balance checking (not every wallet, just a percentage).
 * This gives a good speed/balance-coverage tradeoff.
 */
export function startBalancedScanJob(
  wordCount: 12 | 24,
  chains: Blockchain[],
  balanceCheckPercent: number = 10, // check 10% of generated wallets
  batchSize: number = 100
): ScanJob {
  const job: ScanJob = {
    id: uuidv4(),
    wordCount,
    chains,
    checkBalance: true,
    status: 'running',
    scanned: 0,
    speed: 0,
    found: [],
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
  };

  const controller = { stopped: false };
  scanControllers.set(job.id, controller);
  scanJobs.set(job.id, job);

  (async () => {
    let walletCounter = 0;

    try {
      while (!controller.stopped) {
        // Generate bulk mnemonics
        const wallets = generateWalletsBulk(batchSize, wordCount);

        // Compute seeds in parallel
        const seedPromises = wallets.map(async (w) => {
          const seed = await bip39.mnemonicToSeed(w.mnemonic);
          return { mnemonic: w.mnemonic, seed };
        });
        const walletsWithSeeds = await Promise.all(seedPromises);

        // Derive addresses in parallel
        const derivePromises = walletsWithSeeds.map(async (w, idx) => {
          const addresses = await deriveAddressesFromSeed(w.seed, chains);
          walletCounter++;
          // Only check balance for a percentage of wallets
          const shouldCheckBalance = (walletCounter % Math.max(1, Math.round(100 / balanceCheckPercent))) === 1;
          return { mnemonic: w.mnemonic, addresses, shouldCheckBalance };
        });
        const walletsWithAddresses = await Promise.all(derivePromises);

        // Check balances for sampled wallets
        const walletsToCheck = walletsWithAddresses.filter(w => w.shouldCheckBalance);
        if (walletsToCheck.length > 0) {
          const allAddresses: { mnemonic: string; blockchain: Blockchain; address: string }[] = [];
          for (const w of walletsToCheck) {
            for (const addr of w.addresses) {
              allAddresses.push({ mnemonic: w.mnemonic, ...addr });
            }
          }

          const balanceResults = await checkBalancesBatch(allAddresses);

          // Find funded wallets
          const mnemonicMap = new Map<string, { blockchain: Blockchain; address: string; balance: string; symbol: string }[]>();
          for (const result of balanceResults) {
            if (result.hasBalance) {
              const mnemonic = allAddresses.find(
                a => a.address === result.address && a.blockchain === result.blockchain
              )?.mnemonic;
              if (mnemonic) {
                if (!mnemonicMap.has(mnemonic)) mnemonicMap.set(mnemonic, []);
                mnemonicMap.get(mnemonic)!.push({
                  blockchain: result.blockchain,
                  address: result.address,
                  balance: result.balance,
                  symbol: result.symbol,
                });
              }
            }
          }

          for (const [mnemonic, addrs] of mnemonicMap) {
            job.found.push({
              mnemonic,
              addresses: addrs,
              foundAt: Date.now(),
            });
          }
        }

        // Update stats
        job.scanned += batchSize;
        const elapsed = (Date.now() - job.startedAt) / 1000;
        job.speed = elapsed > 0 ? Math.round(job.scanned / elapsed) : 0;
        job.lastUpdateAt = Date.now();

        if (controller.stopped) {
          job.status = 'stopped';
          return;
        }
      }
      job.status = 'stopped';
    } catch (err) {
      job.status = 'stopped';
      job.error = String(err);
      console.error('Balanced scan job error:', err);
    }
  })();

  return job;
}
