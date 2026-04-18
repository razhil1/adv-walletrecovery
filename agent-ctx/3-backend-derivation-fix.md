# Task 3: Fix Backend Derivation Paths

## Agent: Backend Fix Agent
## Date: 2026-03-05

## Summary
Fixed duplicate derivation paths in `DERIVATION_PATHS` array and the hardcoded path in `deriveSOLAddress()` function.

## Changes Made

### 1. Updated DERIVATION_PATHS array (`/src/lib/crypto-recovery.ts`)
- **ETH Standard (MetaMask)**: `m/44'/60'/0'/0/0` — unchanged (first address)
- **ETH Ledger Live (Acct 1)**: `m/44'/60'/1'/0/0` — changed from duplicate `m/44'/60'/0'/0/0`
- **ETH Second Address**: `m/44'/60'/0'/0/1` — newly added
- **SOL Standard (BIP44)**: `m/44'/501'/0'/0'` — unchanged
- **SOL Solflare/Phantom (Deprecated)**: `m/501'/0'/0'` — changed from duplicate `m/44'/501'/0'/0'`
- Labels also updated for clarity (shorter names matching spec)

### 2. Fixed deriveSOLAddress function
- Renamed `_path` parameter to `path`
- Changed `ed25519DerivePath("m/44'/501'/0'/0'", seedHex)` to `ed25519DerivePath(path, seedHex)`
- Now correctly uses the provided derivation path, enabling the deprecated `m/501'/0'/0'` path to work

## Verification
- `bun run lint` — passed with no errors
- Dev server running without errors
