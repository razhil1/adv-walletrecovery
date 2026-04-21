// Worker thread for high-speed wallet generation + derivation
// Receives batch jobs from the main scanner service

import { parentPort, workerData } from 'worker_threads';
import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { createHash } from 'crypto';
import { derivePath as ed25519DerivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import bs58Module from 'bs58';
const bs58 = bs58Module.default || bs58Module;
import { randomBytes } from 'crypto';

type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp';

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

const DEFAULT_PATHS: Record<Blockchain, string> = {
  eth: "m/44'/60'/0'/0/0",
  btc: "m/84'/0'/0'/0/0",
  sol: "m/44'/501'/0'/0'",
  xrp: "m/44'/144'/0'/0/0",
};

// Derive addresses from a mnemonic using SYNC methods (much faster)
function deriveAddressesSync(mnemonic: string, chains: Blockchain[]): { blockchain: Blockchain; address: string }[] {
  const results: { blockchain: Blockchain; address: string }[] = [];
  
  // Use SYNC seed derivation - this is the key optimization
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const hdNode = HDNodeWallet.fromSeed(seed);
  const seedHex = seed.toString('hex');

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
          const uncompressedHex = child.signingKey.publicKey;
          const pubKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
          const h160 = hash160(pubKeyBytes);
          // Native SegWit (m/84') uses version 0x00 for P2WPKH wrapped in P2SH
          // For simplicity, we output the hash160 as a legacy address
          let versionByte = 0x00; // Default: Legacy
          if (path.startsWith("m/84'")) versionByte = 0x00;
          else if (path.startsWith("m/49'")) versionByte = 0x05;
          const versionedPayload = Buffer.concat([Buffer.from([versionByte]), h160]);
          const checksum = doubleSha256(versionedPayload).slice(0, 4);
          const addressBytes = Buffer.concat([versionedPayload, checksum]);
          address = base58Encode(addressBytes, BTC_BASE58_ALPHABET);
          break;
        }
        case 'sol': {
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

// Generate bulk wallets with sync derivation
function generateAndDeriveBatch(
  count: number,
  wordCount: 12 | 24,
  chains: Blockchain[]
): { mnemonic: string; addresses: { blockchain: Blockchain; address: string }[] }[] {
  const strength = wordCount === 24 ? 256 : 128;
  const entropyBytes = strength / 8;
  const results: { mnemonic: string; addresses: { blockchain: Blockchain; address: string }[] }[] = [];

  for (let i = 0; i < count; i++) {
    const entropy = randomBytes(entropyBytes);
    const mnemonic = bip39.entropyToMnemonic(entropy);
    const addresses = deriveAddressesSync(mnemonic, chains);
    results.push({ mnemonic, addresses });
  }

  return results;
}

// Handle messages from parent
parentPort?.on('message', (msg: { type: string; id: string; count: number; wordCount: 12 | 24; chains: Blockchain[] }) => {
  if (msg.type === 'batch') {
    const startTime = Date.now();
    const wallets = generateAndDeriveBatch(msg.count, msg.wordCount, msg.chains);
    const duration = Date.now() - startTime;
    
    parentPort?.postMessage({
      type: 'batch_result',
      id: msg.id,
      wallets,
      duration,
      count: msg.count,
    });
  }
});
