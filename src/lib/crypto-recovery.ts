import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { createHash } from 'crypto';
import { derivePath as ed25519DerivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import bs58Module from 'bs58';
const bs58 = bs58Module.default || bs58Module;
import { v4 as uuidv4 } from 'uuid';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp';

export interface RecoveryJob {
  id: string;
  partialMnemonic: (string | null)[];
  knownAddress: string;
  blockchain: Blockchain;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  progress: number;
  total: number;
  speed: number; // combinations per second
  result: string[] | null;
  startedAt: number;
  foundAt?: number;
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

// ─── Wordlist ────────────────────────────────────────────────────────────────

let cachedWordlist: string[] | null = null;

export function getWordlist(): string[] {
  if (cachedWordlist) return cachedWordlist;
  cachedWordlist = bip39.wordlists.english;
  return cachedWordlist;
}

// ─── Address derivation ──────────────────────────────────────────────────────

async function deriveETHAddress(mnemonic: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const child = hdNode.derivePath("m/44'/60'/0'/0/0");
  return child.address;
}

async function deriveBTCAddress(mnemonic: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const child = hdNode.derivePath("m/44'/0'/0'/0/0");

  // Get uncompressed public key (remove 0x04 prefix byte)
  const uncompressedHex = child.signingKey.publicKey;
  const pubKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');

  // Hash160: SHA256 then RIPEMD160
  const h160 = hash160(pubKeyBytes);

  // Add version byte 0x00 for mainnet P2PKH
  const versionedPayload = Buffer.concat([Buffer.from([0x00]), h160]);

  // Calculate checksum: double SHA256, first 4 bytes
  const checksum = doubleSha256(versionedPayload).slice(0, 4);

  // Concatenate payload + checksum
  const addressBytes = Buffer.concat([versionedPayload, checksum]);

  // Base58Check encode
  return base58Encode(addressBytes, BTC_BASE58_ALPHABET);
}

async function deriveSOLAddress(mnemonic: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const seedHex = seed.toString('hex');
  const { key } = ed25519DerivePath("m/44'/501'/0'/0'", seedHex);
  const keypair = nacl.sign.keyPair.fromSeed(key);
  return bs58.encode(Buffer.from(keypair.publicKey));
}

async function deriveXRPAddress(mnemonic: string): Promise<string> {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const child = hdNode.derivePath("m/44'/144'/0'/0/0");

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

export async function deriveAddress(mnemonic: string, blockchain: Blockchain): Promise<string> {
  switch (blockchain) {
    case 'eth':
      return deriveETHAddress(mnemonic);
    case 'btc':
      return deriveBTCAddress(mnemonic);
    case 'sol':
      return deriveSOLAddress(mnemonic);
    case 'xrp':
      return deriveXRPAddress(mnemonic);
    default:
      throw new Error(`Unsupported blockchain: ${blockchain}`);
  }
}

// ─── Combination generation ──────────────────────────────────────────────────

/**
 * Converts a flat counter into an array of indices for each unknown position.
 * This is essentially converting the counter to base-{wordlist.length} digits.
 */
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

/**
 * Builds a candidate mnemonic from the partial mnemonic and a set of
 * word indices for the unknown positions.
 */
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

// ─── Job management ──────────────────────────────────────────────────────────

export function createJob(
  partialMnemonic: (string | null)[],
  knownAddress: string,
  blockchain: Blockchain
): RecoveryJob {
  const wordlist = getWordlist();
  const unknownPositions = partialMnemonic.reduce((acc, word, i) => {
    if (word === null) acc.push(i);
    return acc;
  }, [] as number[]);

  const unknownCount = unknownPositions.length;
  const total = Math.pow(wordlist.length, unknownCount);

  const job: RecoveryJob = {
    id: uuidv4(),
    partialMnemonic,
    knownAddress,
    blockchain,
    status: 'pending',
    progress: 0,
    total,
    speed: 0,
    result: null,
    startedAt: 0,
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
          const address = await deriveAddress(mnemonic, job.blockchain);
          const match = compareAddresses(address, job.knownAddress, job.blockchain);
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
  const BATCH_SIZE = 500;

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
            // Derive address and compare
            const address = await deriveAddress(mnemonic, job.blockchain);
            if (compareAddresses(address, job.knownAddress, job.blockchain)) {
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

  // Kick off the first batch
  processBatch();
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
