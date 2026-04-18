# Task 2: Add Multi-Path Auto-Retry Recovery Feature

## Agent: full-stack-developer

## Work Summary

### Changes Made

1. **RecoveryJob type extended** (`crypto-recovery.ts`):
   - Added `currentPathIndex?: number` - tracks which derivation path index is being tried
   - Added `triedPaths?: string[]` - list of paths already searched
   - Added `pathSwitchAt?: number` - timestamp when current path search started
   - Added `autoRetry?: boolean` - whether multi-path auto-retry is enabled
   - Added `validCombinationsEstimate?: number` - estimated valid combinations after BIP39 checksum filter

2. **createJob() updated** (`crypto-recovery.ts`):
   - Now accepts optional `autoRetry` parameter (5th argument)
   - Computes `currentPathIndex` by finding the derivation path in `getPathsForBlockchain()` results
   - Sets `validCombinationsEstimate = Math.floor(total * 0.0625)` (BIP39 checksum passes ~6.25%)
   - Initializes `triedPaths: []`, `pathSwitchAt: undefined`, `autoRetry` from parameter

3. **startMultiPathRecovery() function added** (`crypto-recovery.ts`):
   - Gets all derivation paths for the job's blockchain
   - If only 1 path exists, delegates to `startRecovery()` directly
   - Records initial path in `triedPaths` array
   - Sets `pathSwitchAt` timestamp
   - Starts recovery with `startRecovery()`
   - Polls every 500ms for job completion
   - On completion with empty result (no match), waits 500ms then:
     - Increments `currentPathIndex`
     - Updates `derivationPath` to next path
     - Resets job state (status, progress, speed, result, foundAt)
     - Sets new `pathSwitchAt` timestamp
     - Recursively calls `startMultiPathRecovery()`
   - Stops polling on `stopped`/`failed` status, or when match found
   - When all paths exhausted, job stays `completed` with `result: []`

4. **API route enhanced** (`route.ts`):
   - Imported `startMultiPathRecovery` from crypto-recovery
   - POST endpoint now reads `autoRetry` query parameter from URL
   - When `autoRetry=true`, calls `startMultiPathRecovery()` instead of `startRecovery()`
   - Backward compatible: without `autoRetry`, behavior unchanged

5. **GET endpoint**: Already returns full job object including new optional fields - no changes needed

### Backward Compatibility
- All new fields are optional (`?`) - existing code continues to work
- `createJob()` 5th parameter is optional - existing calls unchanged
- `startRecovery()` function unchanged
- API contracts only extended, never modified

### Lint Status
- `bun run lint` - Clean, no errors or warnings
