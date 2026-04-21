// High-speed wallet scanner service
// Uses worker threads for parallel wallet generation + derivation
// Target: 100k+ wallets/minute

import { Worker } from 'worker_threads';
import { createHash } from 'crypto';
import { randomBytes } from 'crypto';
import * as bip39 from 'bip39';

type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp';

// ─── Types ───────────────────────────────────────────────────────────────────

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
  balanceCheckPercent: number;
  batchSize: number;
  error?: string;
  // Speed tracking
  speedHistory: { time: number; scanned: number }[];
}

interface FoundWallet {
  mnemonic: string;
  addresses: { blockchain: Blockchain; address: string; balance: string; symbol: string }[];
  foundAt: number;
}

interface PendingBatch {
  id: string;
  resolve: (wallets: any[]) => void;
  reject: (err: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Worker Pool ─────────────────────────────────────────────────────────────

const NUM_WORKERS = Math.max(2, Math.min((require('os').cpus?.length || 4) - 1, 8));
const workers: Worker[] = [];
let pendingBatches = new Map<string, PendingBatch>();
let batchCounter = 0;

function initWorkers() {
  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(require('path').join(__dirname, 'worker.ts'));
    worker.on('message', (msg: any) => {
      if (msg.type === 'batch_result') {
        const pending = pendingBatches.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingBatches.delete(msg.id);
          pending.resolve(msg.wallets);
        }
      }
    });
    worker.on('error', (err) => {
      console.error(`Worker ${i} error:`, err);
    });
    workers.push(worker);
  }
  console.log(`Scanner service initialized with ${NUM_WORKERS} workers`);
}

function dispatchBatch(count: number, wordCount: 12 | 24, chains: Blockchain[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const id = `batch_${++batchCounter}`;
    const workerIdx = batchCounter % workers.length;
    const worker = workers[workerIdx];
    
    const timer = setTimeout(() => {
      pendingBatches.delete(id);
      reject(new Error('Batch timeout'));
    }, 30000); // 30s timeout per batch
    
    pendingBatches.set(id, { id, resolve, reject, timer });
    
    worker.postMessage({
      type: 'batch',
      id,
      count,
      wordCount,
      chains,
    });
  });
}

// ─── In-memory job store ─────────────────────────────────────────────────────

const scanJobs = new Map<string, ScanJob>();
const scanControllers = new Map<string, { stopped: boolean }>();

// ─── Balance checking ────────────────────────────────────────────────────────

async function checkETHBalance(address: string): Promise<{ balance: string; symbol: string; hasBalance: boolean }> {
  try {
    const response = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (data.result) {
      const weiBigInt = BigInt(data.result as string);
      const eth = Number(weiBigInt) / 1e18;
      return { balance: eth.toFixed(8), symbol: 'ETH', hasBalance: eth > 0 };
    }
    return { balance: '0', symbol: 'ETH', hasBalance: false };
  } catch {
    return { balance: '0', symbol: 'ETH', hasBalance: false };
  }
}

async function checkBTCBalance(address: string): Promise<{ balance: string; symbol: string; hasBalance: boolean }> {
  try {
    const response = await fetch(`https://blockchain.info/balance?active=${address}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (data[address]) {
      const satoshi = data[address].final_balance as number;
      const btc = satoshi / 1e8;
      return { balance: btc.toFixed(8), symbol: 'BTC', hasBalance: satoshi > 0 };
    }
    return { balance: '0', symbol: 'BTC', hasBalance: false };
  } catch {
    return { balance: '0', symbol: 'BTC', hasBalance: false };
  }
}

async function checkSOLBalance(address: string): Promise<{ balance: string; symbol: string; hasBalance: boolean }> {
  try {
    const response = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'getBalance', params: [address], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (data.result) {
      const lamports = data.result.value as number;
      const sol = lamports / 1e9;
      return { balance: sol.toFixed(9), symbol: 'SOL', hasBalance: lamports > 0 };
    }
    return { balance: '0', symbol: 'SOL', hasBalance: false };
  } catch {
    return { balance: '0', symbol: 'SOL', hasBalance: false };
  }
}

async function checkXRPBalance(address: string): Promise<{ balance: string; symbol: string; hasBalance: boolean }> {
  try {
    const response = await fetch('https://s2.ripple.com:51234/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'account_info', params: [{ account: address, ledger_index: 'validated' }] }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (data.result?.account_data?.Balance) {
      const drops = Number(data.result.account_data.Balance);
      const xrp = drops / 1e6;
      return { balance: xrp.toFixed(6), symbol: 'XRP', hasBalance: drops > 0 };
    }
    return { balance: '0', symbol: 'XRP', hasBalance: false };
  } catch {
    return { balance: '0', symbol: 'XRP', hasBalance: false };
  }
}

async function checkBalance(chain: Blockchain, address: string): Promise<{ blockchain: Blockchain; address: string; balance: string; symbol: string; hasBalance: boolean }> {
  let result;
  switch (chain) {
    case 'eth': result = await checkETHBalance(address); break;
    case 'btc': result = await checkBTCBalance(address); break;
    case 'sol': result = await checkSOLBalance(address); break;
    case 'xrp': result = await checkXRPBalance(address); break;
  }
  return { blockchain: chain, address, ...result };
}

// Concurrent balance checking with rate limiting
async function checkBalancesConcurrent(
  addresses: { mnemonic: string; blockchain: Blockchain; address: string }[],
  maxConcurrency: number = 20
): Promise<Map<string, { blockchain: Blockchain; address: string; balance: string; symbol: string }[]>> {
  const fundedMap = new Map<string, { blockchain: Blockchain; address: string; balance: string; symbol: string }[]>();
  
  // Process in chunks for rate limiting
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

function startScanJob(
  wordCount: 12 | 24,
  chains: Blockchain[],
  mode: 'fast' | 'balanced' | 'full',
  batchSize: number = 200,
  balanceCheckPercent: number = 10
): ScanJob {
  const job: ScanJob = {
    id: crypto.randomUUID(),
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
    balanceCheckPercent,
    batchSize,
    speedHistory: [],
  };

  const controller = { stopped: false };
  scanControllers.set(job.id, controller);
  scanJobs.set(job.id, job);

  // Run the scan loop
  (async () => {
    let walletCounter = 0;
    let batchInProgress = 0;
    const MAX_CONCURRENT_BATCHES = NUM_WORKERS;

    try {
      while (!controller.stopped) {
        // Wait if too many batches are in flight
        while (batchInProgress >= MAX_CONCURRENT_BATCHES) {
          await new Promise(r => setTimeout(r, 10));
        }

        batchInProgress++;

        // Dispatch batch to worker
        dispatchBatch(batchSize, wordCount, chains)
          .then(async (wallets) => {
            batchInProgress--;

            if (controller.stopped) return;

            // Check balances for some wallets (based on mode)
            if (mode !== 'fast') {
              const walletsToCheck = mode === 'full'
                ? wallets
                : wallets.filter((_, idx) => {
                    walletCounter++;
                    return (walletCounter % Math.max(1, Math.round(100 / balanceCheckPercent))) === 1;
                  });

              if (walletsToCheck.length > 0) {
                const allAddresses: { mnemonic: string; blockchain: Blockchain; address: string }[] = [];
                for (const w of walletsToCheck) {
                  for (const addr of w.addresses) {
                    allAddresses.push({ mnemonic: w.mnemonic, ...addr });
                  }
                }

                const fundedMap = await checkBalancesConcurrent(allAddresses);

                for (const [mnemonic, addrs] of fundedMap) {
                  job.found.push({ mnemonic, addresses: addrs, foundAt: Date.now() });
                }
              }
            }

            // Update stats
            job.scanned += batchSize;
            const elapsed = (Date.now() - job.startedAt) / 1000;
            job.speed = elapsed > 0 ? Math.round(job.scanned / elapsed) : 0;
            job.lastUpdateAt = Date.now();

            // Track speed history for graph
            job.speedHistory.push({ time: Date.now(), scanned: job.scanned });
            if (job.speedHistory.length > 60) job.speedHistory.shift();
          })
          .catch((err) => {
            batchInProgress--;
            console.error('Batch error:', err);
          });

        // Small delay between batch dispatches to avoid overwhelming workers
        await new Promise(r => setTimeout(r, 5));
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

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const PORT = 3002;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // POST /scan - Start a new scan job
      if (method === 'POST' && path === '/scan') {
        const body = await req.json() as {
          wordCount?: 12 | 24;
          chains?: Blockchain[];
          mode?: 'fast' | 'balanced' | 'full';
          batchSize?: number;
          balanceCheckPercent?: number;
        };

        const wordCount = body.wordCount === 24 ? 24 : 12;
        const validBlockchains: Blockchain[] = ['btc', 'eth', 'sol', 'xrp'];
        const chains = (body.chains || ['eth']).filter(c => validBlockchains.includes(c));
        if (chains.length === 0) {
          return Response.json({ error: 'At least one blockchain must be selected' }, { status: 400, headers: corsHeaders });
        }

        const mode = body.mode || 'balanced';
        const batchSize = body.batchSize || (mode === 'fast' ? 500 : mode === 'balanced' ? 200 : 100);
        const balanceCheckPercent = body.balanceCheckPercent || 10;

        const job = startScanJob(wordCount, chains, mode, batchSize, balanceCheckPercent);

        return Response.json({
          jobId: job.id,
          status: job.status,
          wordCount: job.wordCount,
          chains: job.chains,
          checkBalance: job.checkBalance,
          mode,
          workers: NUM_WORKERS,
        }, { headers: corsHeaders });
      }

      // GET /scan?jobId=xxx - Get scan status
      if (method === 'GET' && path === '/scan') {
        const jobId = url.searchParams.get('jobId');
        if (!jobId) {
          return Response.json({ error: 'jobId is required' }, { status: 400, headers: corsHeaders });
        }

        const job = scanJobs.get(jobId);
        if (!job) {
          return Response.json({ error: 'Job not found' }, { status: 404, headers: corsHeaders });
        }

        return Response.json({
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
          speedHistory: job.speedHistory.slice(-30), // Last 30 data points
          error: job.error,
        }, { headers: corsHeaders });
      }

      // PATCH /scan?jobId=xxx - Stop a scan job
      if (method === 'PATCH' && path === '/scan') {
        const jobId = url.searchParams.get('jobId');
        if (!jobId) {
          return Response.json({ error: 'jobId is required' }, { status: 400, headers: corsHeaders });
        }

        const controller = scanControllers.get(jobId);
        if (controller) controller.stopped = true;

        const job = scanJobs.get(jobId);
        if (job && job.status === 'running') {
          job.status = 'stopped';
          return Response.json({
            jobId: job.id,
            status: job.status,
            scanned: job.scanned,
            speed: job.speed,
            found: job.found,
          }, { headers: corsHeaders });
        }

        return Response.json({ error: 'Job not found or already stopped' }, { status: 404, headers: corsHeaders });
      }

      // DELETE /scan?jobId=xxx - Delete a scan job
      if (method === 'DELETE' && path === '/scan') {
        const jobId = url.searchParams.get('jobId');
        if (!jobId) {
          return Response.json({ error: 'jobId is required' }, { status: 400, headers: corsHeaders });
        }

        const controller = scanControllers.get(jobId);
        if (controller) controller.stopped = true;
        scanControllers.delete(jobId);
        const deleted = scanJobs.delete(jobId);

        return Response.json({ success: deleted }, { headers: corsHeaders });
      }

      // GET /health - Health check
      if (method === 'GET' && path === '/health') {
        return Response.json({
          status: 'ok',
          workers: NUM_WORKERS,
          activeJobs: Array.from(scanJobs.values()).filter(j => j.status === 'running').length,
          totalJobs: scanJobs.size,
        }, { headers: corsHeaders });
      }

      return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error('Request error:', err);
      return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
    }
  },
});

// Initialize workers
initWorkers();

console.log(`🚀 Scanner service running on port ${PORT} with ${NUM_WORKERS} workers`);
