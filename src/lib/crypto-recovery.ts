import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { createHash } from 'crypto';
import { derivePath as ed25519DerivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp';

export interface DerivationPath {
  label: string;
  path: string;
  blockchain: Blockchain;
}

export const DERIVATION_PATHS: DerivationPath[] = [
  { label: 'Standard (MetaMask)', path: "m/44'/60'/0'/0/0", blockchain: 'eth' },
  { label: 'Ledger Live (Acct 1)', path: "m/44'/60'/1'/0/0", blockchain: 'eth' },
  { label: 'Second Address', path: "m/44'/60'/0'/0/1", blockchain: 'eth' },
  { label: 'Legacy (P2PKH)', path: "m/44'/0'/0'/0/0", blockchain: 'btc' },
  { label: 'SegWit (P2SH)', path: "m/49'/0'/0'/0/0", blockchain: 'btc' },
  { label: 'Native SegWit', path: "m/84'/0'/0'/0/0", blockchain: 'btc' },
  { label: 'Standard (BIP44)', path: "m/44'/501'/0'/0'", blockchain: 'sol' },
  { label: 'Solflare/Phantom (Deprecated)', path: "m/501'/0'/0'", blockchain: 'sol' },
  { label: 'Standard', path: "m/44'/144'/0'/0/0", blockchain: 'xrp' },
];

export function getPathsForBlockchain(blockchain: Blockchain): DerivationPath[] {
  return DERIVATION_PATHS.filter(p => p.blockchain === blockchain);
}

export function getDefaultPath(blockchain: Blockchain): string {
  switch (blockchain) {
    case 'eth': return "m/44'/60'/0'/0/0";
    case 'btc': return "m/44'/0'/0'/0/0";
    case 'sol': return "m/44'/501'/0'/0'";
    case 'xrp': return "m/44'/144'/0'/0/0";
  }
}

export interface RecoveryJob {
  id: string;
  partialMnemonic: (string | null)[];
  knownAddress: string;
  knownAddresses: string[]; // multiple addresses to verify against
  blockchain: Blockchain;
  derivationPath: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  progress: number;
  total: number;
  speed: number; // combinations per second
  result: string[] | null;
  startedAt: number;
  foundAt?: number;
  // Multi-path auto-retry fields
  currentPathIndex?: number; // which derivation path index is currently being tried
  triedPaths?: string[]; // list of paths that have already been searched
  pathSwitchAt?: number; // timestamp when the current path search started
  autoRetry?: boolean; // whether multi-path auto-retry is enabled
  // BIP39 checksum estimate
  validCombinationsEstimate?: number; // estimated valid combinations after BIP39 checksum filter
  // Checksum-first mode
  checksumFirst?: boolean; // if true, skip address derivation for invalid BIP39 checksums (two-phase approach)
}

// ─── In-memory job store ─────────────────────────────────────────────────────

const jobs = new Map<string, RecoveryJob>();
const jobControllers = new Map<string, { stopped: boolean }>();

// ─── Base58 encoding with custom alphabet ────────────────────────────────────

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

  // Add leading alphabet[0] characters for each leading zero byte
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result = alphabet[0] + result;
  }

  return result;
}

// ─── Hash utilities ──────────────────────────────────────────────────────────

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

function base58CheckEncode(versionByte: number, payload: Buffer, alphabet: string = BTC_BASE58_ALPHABET): string {
  const versionedPayload = Buffer.concat([Buffer.from([versionByte]), payload]);
  const checksum = doubleSha256(versionedPayload).slice(0, 4);
  return base58Encode(Buffer.concat([versionedPayload, checksum]), alphabet);
}

function getCompressedPublicKey(publicKey: string): Buffer {
  const publicKeyBytes = Buffer.from(publicKey.replace(/^0x/, ''), 'hex');
  if (publicKeyBytes.length === 33) return publicKeyBytes;

  const x = publicKeyBytes.subarray(1, 33);
  const y = publicKeyBytes.subarray(33, 65);
  const prefix = y[y.length - 1] % 2 === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), x]);
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;

  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if (((top >> i) & 1) === 1) chk ^= generators[i];
    }
  }

  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const values: number[] = [];
  for (let i = 0; i < hrp.length; i++) values.push(hrp.charCodeAt(i) >> 5);
  values.push(0);
  for (let i = 0; i < hrp.length; i++) values.push(hrp.charCodeAt(i) & 31);
  return values;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const checksum: number[] = [];

  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 31);
  }

  return checksum;
}

function convertBits(data: Buffer, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv);
  }

  return result;
}

function encodeBech32Address(hrp: string, witnessVersion: number, witnessProgram: Buffer): string {
  const data = [witnessVersion, ...convertBits(witnessProgram, 8, 5, true)];
  const combined = [...data, ...bech32CreateChecksum(hrp, data)];
  return `${hrp}1${combined.map(value => BECH32_CHARSET[value]).join('')}`;
}

// ─── Wordlist ────────────────────────────────────────────────────────────────

let cachedWordlist: string[] | null = null;

export function getWordlist(): string[] {
  if (cachedWordlist) return cachedWordlist;
  cachedWordlist = bip39.wordlists.english;
  return cachedWordlist;
}

// ─── Address derivation ──────────────────────────────────────────────────────

async function deriveETHAddress(mnemonic: string, path: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const child = hdNode.derivePath(path);
  return child.address;
}

async function deriveBTCAddress(mnemonic: string, path: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const child = hdNode.derivePath(path);

  const compressedPublicKey = getCompressedPublicKey(child.signingKey.publicKey);
  const publicKeyHash = hash160(compressedPublicKey);

  if (path.startsWith("m/84'")) {
    return encodeBech32Address('bc', 0, publicKeyHash);
  }

  if (path.startsWith("m/49'")) {
    const redeemScript = Buffer.concat([Buffer.from([0x00, 0x14]), publicKeyHash]);
    return base58CheckEncode(0x05, hash160(redeemScript));
  }

  return base58CheckEncode(0x00, publicKeyHash);
}

async function deriveSOLAddress(mnemonic: string, path: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const seedHex = seed.toString('hex');
  const { key } = ed25519DerivePath(path, seedHex);
  const keypair = nacl.sign.keyPair.fromSeed(key);
  return base58Encode(Buffer.from(keypair.publicKey));
}

async function deriveXRPAddress(mnemonic: string, path: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const child = hdNode.derivePath(path);

  // Get uncompressed public key (remove 0x04 prefix byte)
  const uncompressedHex = child.signingKey.publicKey;
  const pubKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');

  // Hash160: SHA256 then RIPEMD160
  const h160 = hash160(pubKeyBytes);

  // Add version byte 0x00 for XRP
  const versionedPayload = Buffer.concat([Buffer.from([0x00]), h160]);

  // Calculate checksum: double SHA256, first 4 bytes
  const checksum = doubleSha256(versionedPayload).slice(0, 4);

  // Concatenate payload + checksum
  const addressBytes = Buffer.concat([versionedPayload, checksum]);

  // Base58 encode with XRP alphabet
  return base58Encode(addressBytes, XRP_BASE58_ALPHABET);
}

export async function deriveAddress(mnemonic: string, blockchain: Blockchain, derivationPath?: string): Promise<string> {
  const path = derivationPath || getDefaultPath(blockchain);
  switch (blockchain) {
    case 'eth':
      return deriveETHAddress(mnemonic, path);
    case 'btc':
      return deriveBTCAddress(mnemonic, path);
    case 'sol':
      return deriveSOLAddress(mnemonic, path);
    case 'xrp':
      return deriveXRPAddress(mnemonic, path);
    default:
      throw new Error(`Unsupported blockchain: ${blockchain}`);
  }
}

// ─── Quick Verify ────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  address: string | null;
  match: boolean;
  error?: string;
}

export async function verifyMnemonic(
  mnemonic: string,
  knownAddress: string,
  blockchain: Blockchain,
  derivationPath?: string
): Promise<VerifyResult> {
  // Validate mnemonic format
  if (!bip39.validateMnemonic(mnemonic)) {
    return { valid: false, address: null, match: false, error: 'Invalid mnemonic checksum' };
  }

  try {
    const address = await deriveAddress(mnemonic, blockchain, derivationPath);
    const match = compareAddresses(address, knownAddress, blockchain);
    return { valid: true, address, match };
  } catch (err) {
    return { valid: true, address: null, match: false, error: String(err) };
  }
}

// ─── Combination generation ──────────────────────────────────────────────────

function counterToIndices(
  counter: number,
  unknownCount: number,
  base: number
): number[] {
  const indices: number[] = new Array(unknownCount);
  let c = counter;
  for (let i = unknownCount - 1; i >= 0; i--) {
    indices[i] = c % base;
    c = Math.floor(c / base);
  }
  return indices;
}

function buildCandidate(
  partialMnemonic: (string | null)[],
  unknownPositions: number[],
  wordlist: string[],
  indices: number[]
): string {
  const words = [...partialMnemonic];
  for (let i = 0; i < unknownPositions.length; i++) {
    words[unknownPositions[i]] = wordlist[indices[i]];
  }
  return words.join(' ');
}

// ─── Estimate helpers ────────────────────────────────────────────────────────

export function estimateTotalCombinations(unknownCount: number): number {
  return Math.pow(2048, unknownCount);
}

export function estimateTime(unknownCount: number, speedPerSec: number = 1000): number {
  const total = estimateTotalCombinations(unknownCount);
  // After BIP39 checksum pre-filter, only ~6.25% of candidates are valid
  // But we still need to check them all to find the valid ones
  return total / speedPerSec;
}

// ─── Job management ──────────────────────────────────────────────────────────

export function createJob(
  partialMnemonic: (string | null)[],
  knownAddress: string,
  blockchain: Blockchain,
  derivationPath?: string,
  autoRetry?: boolean,
  knownAddresses?: string[],
  checksumFirst?: boolean
): RecoveryJob {
  const wordlist = getWordlist();
  const unknownPositions = partialMnemonic.reduce((acc, word, i) => {
    if (word === null) acc.push(i);
    return acc;
  }, [] as number[]);

  const unknownCount = unknownPositions.length;
  const total = Math.pow(wordlist.length, unknownCount);
  const path = derivationPath || getDefaultPath(blockchain);

  // Determine current path index within the blockchain's available paths
  const blockchainPaths = getPathsForBlockchain(blockchain);
  const pathIndex = blockchainPaths.findIndex(p => p.path === path);

  // BIP39 checksum filters out ~93.75% of candidates, so ~6.25% pass
  const validCombinationsEstimate = Math.floor(total * 0.0625);

  // Build knownAddresses array: if provided use it, otherwise wrap single knownAddress
  const addresses = knownAddresses && knownAddresses.length > 0
    ? knownAddresses.filter(a => a.trim().length > 0)
    : [knownAddress];

  const job: RecoveryJob = {
    id: randomUUID(),
    partialMnemonic,
    knownAddress,
    knownAddresses: addresses,
    blockchain,
    derivationPath: path,
    status: 'pending',
    progress: 0,
    total,
    speed: 0,
    result: null,
    startedAt: 0,
    currentPathIndex: pathIndex >= 0 ? pathIndex : 0,
    triedPaths: [],
    pathSwitchAt: undefined,
    autoRetry: autoRetry ?? false,
    validCombinationsEstimate,
    checksumFirst: checksumFirst ?? false,
  };

  jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): RecoveryJob | undefined {
  return jobs.get(jobId);
}

export function getAllJobs(): RecoveryJob[] {
  return Array.from(jobs.values());
}

export function stopRecovery(jobId: string): boolean {
  const controller = jobControllers.get(jobId);
  if (controller) {
    controller.stopped = true;
  }
  const job = jobs.get(jobId);
  if (job && (job.status === 'running' || job.status === 'pending')) {
    job.status = 'stopped';
    return true;
  }
  return false;
}

export function deleteJob(jobId: string): boolean {
  stopRecovery(jobId);
  jobControllers.delete(jobId);
  return jobs.delete(jobId);
}

// ─── Recovery engine ─────────────────────────────────────────────────────────

export function startRecovery(job: RecoveryJob): void {
  const wordlist = getWordlist();
  const wordlistLength = wordlist.length;

  const unknownPositions = job.partialMnemonic.reduce((acc, word, i) => {
    if (word === null) acc.push(i);
    return acc;
  }, [] as number[]);

  const unknownCount = unknownPositions.length;

  if (unknownCount === 0) {
    // No unknowns - just validate the single candidate
    const mnemonic = job.partialMnemonic.join(' ');
    job.status = 'running';
    job.startedAt = Date.now();
    job.total = 1;

    (async () => {
      try {
        if (bip39.validateMnemonic(mnemonic)) {
          const address = await deriveAddress(mnemonic, job.blockchain, job.derivationPath);
          const match = job.knownAddresses.some(knownAddr =>
            compareAddresses(address, knownAddr, job.blockchain)
          );
          if (match) {
            job.result = [mnemonic];
            job.foundAt = Date.now();
          } else {
            job.result = [];
          }
        } else {
          job.result = [];
        }
        job.progress = 1;
        job.status = 'completed';
      } catch (err) {
        job.status = 'failed';
        job.result = null;
        console.error('Recovery error:', err);
      }
    })();
    return;
  }

  // Set up controller for cancellation
  const controller = { stopped: false };
  jobControllers.set(job.id, controller);

  job.status = 'running';
  job.startedAt = Date.now();

  const total = job.total;
  const BATCH_SIZE = job.checksumFirst ? 2000 : 500;

  let counter = 0;

  async function processBatch(): Promise<void> {
    if (controller.stopped) return;
    if (counter >= total) {
      job.status = 'completed';
      job.result = job.result || [];
      return;
    }

    const batchEnd = Math.min(counter + BATCH_SIZE, total);
    const batchSize = batchEnd - counter;

    if (job.checksumFirst) {
      // Two-phase approach: Phase 1 - validate checksums (fast), Phase 2 - derive addresses (slow)
      const validMnemonics: string[] = [];

      // Phase 1: Build candidates and validate BIP39 checksums (CPU-bound, fast)
      for (let i = 0; i < batchSize; i++) {
        const indices = counterToIndices(counter + i, unknownCount, wordlistLength);
        const mnemonic = buildCandidate(job.partialMnemonic, unknownPositions, wordlist, indices);
        if (bip39.validateMnemonic(mnemonic)) {
          validMnemonics.push(mnemonic);
        }
      }

      // Phase 2: Derive addresses only for valid mnemonics (async, slow)
      const promises: Promise<string | null>[] = validMnemonics.map(mnemonic =>
        (async (): Promise<string | null> => {
          try {
            const address = await deriveAddress(mnemonic, job.blockchain, job.derivationPath);
            if (job.knownAddresses.some(knownAddr =>
              compareAddresses(address, knownAddr, job.blockchain)
            )) {
              return mnemonic;
            }
            return null;
          } catch {
            return null;
          }
        })()
      );

      try {
        const results = await Promise.all(promises);

        counter = batchEnd;
        job.progress = counter;

        const elapsed = (Date.now() - job.startedAt) / 1000;
        job.speed = elapsed > 0 ? Math.round(counter / elapsed) : 0;

        const matches = results.filter((r): r is string => r !== null);

        if (matches.length > 0) {
          job.result = matches;
          job.status = 'completed';
          job.foundAt = Date.now();
          return;
        }

        if (counter >= total) {
          job.status = 'completed';
          job.result = [];
          return;
        }

        setTimeout(processBatch, 0);
      } catch (err) {
        job.status = 'failed';
        console.error('Recovery batch error:', err);
      }
    } else {
      // Normal mode: validate checksum + derive in same pass
      const promises: Promise<string | null>[] = [];

      for (let i = 0; i < batchSize; i++) {
        const indices = counterToIndices(counter + i, unknownCount, wordlistLength);
        const mnemonic = buildCandidate(job.partialMnemonic, unknownPositions, wordlist, indices);

        promises.push(
          (async (): Promise<string | null> => {
            try {
              // Validate mnemonic checksum first - eliminates ~93.75% of candidates
              if (!bip39.validateMnemonic(mnemonic)) {
                return null;
              }
              // Derive address and compare against all known addresses
              const address = await deriveAddress(mnemonic, job.blockchain, job.derivationPath);
              if (job.knownAddresses.some(knownAddr =>
                compareAddresses(address, knownAddr, job.blockchain)
              )) {
                return mnemonic;
              }
              return null;
            } catch {
              return null;
            }
          })()
        );
      }

      try {
        const results = await Promise.all(promises);

        counter = batchEnd;
        job.progress = counter;

        const elapsed = (Date.now() - job.startedAt) / 1000;
        job.speed = elapsed > 0 ? Math.round(counter / elapsed) : 0;

        // Check for matches
        const matches = results.filter((r): r is string => r !== null);

        if (matches.length > 0) {
          job.result = matches;
          job.status = 'completed';
          job.foundAt = Date.now();
          return;
        }

        // Check if we've exhausted all combinations
        if (counter >= total) {
          job.status = 'completed';
          job.result = [];
          return;
        }

        // Schedule next batch (setTimeout to not block event loop)
        setTimeout(processBatch, 0);
      } catch (err) {
        job.status = 'failed';
        console.error('Recovery batch error:', err);
      }
    }
  }

  // Kick off the first batch
  processBatch();
}

// ─── Multi-path auto-retry recovery ──────────────────────────────────────────

export function startMultiPathRecovery(job: RecoveryJob): void {
  const blockchainPaths = getPathsForBlockchain(job.blockchain);

  if (blockchainPaths.length <= 1) {
    // Only one path available - just run normal recovery
    job.pathSwitchAt = Date.now();
    startRecovery(job);
    return;
  }

  // Record the initial path as being tried
  const initialPath = job.derivationPath;
  if (!job.triedPaths) job.triedPaths = [];
  if (!job.triedPaths.includes(initialPath)) {
    job.triedPaths.push(initialPath);
  }

  job.pathSwitchAt = Date.now();

  // Start the first path search
  startRecovery(job);

  // Poll for completion to decide whether to auto-retry with next path
  const pollInterval = setInterval(() => {
    // If job was stopped, failed, or found a result — stop polling
    if (job.status === 'stopped' || job.status === 'failed') {
      clearInterval(pollInterval);
      return;
    }

    // If job completed
    if (job.status === 'completed') {
      clearInterval(pollInterval);

      // If result found (non-empty), we're done
      if (job.result && job.result.length > 0) {
        return;
      }

      // No match on current path — try next path
      const currentIdx = job.currentPathIndex ?? 0;
      const nextIdx = currentIdx + 1;

      // No more paths to try
      if (nextIdx >= blockchainPaths.length) {
        // All paths exhausted with no match
        // Job stays completed with result: []
        return;
      }

      // Switch to next derivation path after a short delay
      setTimeout(() => {
        const nextPath = blockchainPaths[nextIdx];

        // Record the tried path
        job.triedPaths!.push(nextPath.path);

        // Reset job for next path search
        job.derivationPath = nextPath.path;
        job.currentPathIndex = nextIdx;
        job.status = 'pending';
        job.progress = 0;
        job.speed = 0;
        job.result = null;
        job.foundAt = undefined;
        job.pathSwitchAt = Date.now();

        // Start recovery with the new path
        startMultiPathRecovery(job);
      }, 500);

      return;
    }
  }, 500);
}

// ─── Address comparison ──────────────────────────────────────────────────────

function compareAddresses(derived: string, known: string, blockchain: Blockchain): boolean {
  switch (blockchain) {
    case 'eth':
      // ETH addresses are hex, compare case-insensitively
      return derived.toLowerCase() === known.toLowerCase();
    case 'btc':
    case 'sol':
    case 'xrp':
      // Base58 addresses - exact match
      return derived === known;
    default:
      return derived === known;
  }
}
