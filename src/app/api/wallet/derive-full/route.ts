import { NextRequest, NextResponse } from 'next/server';
import * as bip39 from 'bip39';
import { HDNodeWallet } from 'ethers';
import { derivePath as ed25519DerivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { type Blockchain, DERIVATION_PATHS, getDefaultPath } from '@/lib/crypto-recovery';

export const runtime = 'nodejs';

// Pure JS Base58 encode (avoids bs58 ESM import issues with Turbopack)
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

interface DerivedAddress {
  blockchain: Blockchain;
  label: string;
  derivationPath: string;
  address: string;
  privateKey: string;
}

// POST /api/wallet/derive-full - Derive all addresses + private keys from a seed phrase
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mnemonic, blockchains } = body as {
      mnemonic: string;
      blockchains?: Blockchain[];
    };

    if (!mnemonic || typeof mnemonic !== 'string') {
      return NextResponse.json({ error: 'mnemonic is required' }, { status: 400 });
    }

    if (!bip39.validateMnemonic(mnemonic.trim())) {
      return NextResponse.json({ error: 'Invalid mnemonic checksum' }, { status: 400 });
    }

    const seed = await bip39.mnemonicToSeed(mnemonic.trim());
    const hdNode = HDNodeWallet.fromSeed(seed);

    const targetChains: Blockchain[] = blockchains && blockchains.length > 0
      ? blockchains
      : ['btc', 'eth', 'sol', 'xrp'];

    const addresses: DerivedAddress[] = [];

    for (const chain of targetChains) {
      const paths = DERIVATION_PATHS.filter(p => p.blockchain === chain);
      // Only derive the first (default) path for each chain
      const path = paths.length > 0 ? paths[0] : { label: 'Standard', path: getDefaultPath(chain) };

      try {
        let address: string;
        let privateKey: string;

        switch (chain) {
          case 'eth': {
            const child = hdNode.derivePath(path.path);
            address = child.address;
            privateKey = child.privateKey;
            break;
          }
          case 'btc': {
            const child = hdNode.derivePath(path.path);
            const uncompressedHex = child.signingKey.publicKey;
            const pubKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
            const h160 = hash160(pubKeyBytes);
            let versionByte = 0x00;
            if (path.path.startsWith("m/84'")) versionByte = 0x00;
            else if (path.path.startsWith("m/49'")) versionByte = 0x05;
            const versionedPayload = Buffer.concat([Buffer.from([versionByte]), h160]);
            const checksum = doubleSha256(versionedPayload).slice(0, 4);
            const addressBytes = Buffer.concat([versionedPayload, checksum]);
            address = base58Encode(addressBytes);
            privateKey = child.privateKey;
            break;
          }
          case 'sol': {
            const seedHex = seed.toString('hex');
            const { key } = ed25519DerivePath(path.path, seedHex);
            const keypair = nacl.sign.keyPair.fromSeed(key);
            address = base58Encode(Buffer.from(keypair.publicKey));
            // Solana private key is the full 64-byte keypair (private + public)
            privateKey = base58Encode(Buffer.from(keypair.secretKey));
            break;
          }
          case 'xrp': {
            const child = hdNode.derivePath(path.path);
            const uncompressedHex = child.signingKey.publicKey;
            const pubKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
            const h160 = hash160(pubKeyBytes);
            const versionedPayload = Buffer.concat([Buffer.from([0x00]), h160]);
            const checksum = doubleSha256(versionedPayload).slice(0, 4);
            const addressBytes = Buffer.concat([versionedPayload, checksum]);
            address = base58Encode(addressBytes, XRP_BASE58_ALPHABET);
            privateKey = child.privateKey;
            break;
          }
          default:
            continue;
        }

        addresses.push({
          blockchain: chain,
          label: path.label,
          derivationPath: path.path,
          address,
          privateKey,
        });
      } catch (err) {
        console.error(`Failed to derive ${chain}:`, err);
      }
    }

    return NextResponse.json({
      mnemonic: mnemonic.trim(),
      addresses,
    });
  } catch (err) {
    console.error('Wallet derive-full error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
