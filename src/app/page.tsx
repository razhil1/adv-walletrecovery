'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Shield,
  Key,
  Search,
  Copy,
  Check,
  Eye,
  EyeOff,
  Zap,
  Clock,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Wallet,
  Fingerprint,
  FileCheck,
  StopCircle,
  RotateCcw,
  Sparkles,
  CircleCheck,
  CheckCircle2,
  XCircle,
  History,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Activity,
  Timer,
  Hash,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Types ───────────────────────────────────────────────────────────────────

type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp'
type AppTab = 'recover' | 'verify' | 'history'

interface RecoveryJob {
  id: string
  partialMnemonic: (string | null)[]
  knownAddress: string
  blockchain: Blockchain
  derivationPath: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  progress: number
  total: number
  speed: number
  result: string[] | null
  startedAt: number | null
  foundAt: number | null
}

interface VerifyResult {
  valid: boolean
  address: string | null
  match: boolean
  error?: string
}

interface PathOption {
  label: string
  path: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

const BLOCKCHAIN_CONFIG: Record<
  Blockchain,
  { name: string; symbol: string; icon: string; accent: string; accentBg: string; placeholder: string; hint: string; paths: PathOption[] }
> = {
  btc: {
    name: 'Bitcoin',
    symbol: 'BTC',
    icon: '₿',
    accent: 'text-orange-400',
    accentBg: 'bg-orange-500/10 border-orange-500/30',
    placeholder: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa...',
    hint: 'Starts with 1, 3, or bc1',
    paths: [
      { label: 'Legacy (P2PKH)', path: "m/44'/0'/0'/0/0" },
      { label: 'SegWit (P2SH)', path: "m/49'/0'/0'/0/0" },
      { label: 'Native SegWit', path: "m/84'/0'/0'/0/0" },
    ],
  },
  eth: {
    name: 'Ethereum',
    symbol: 'ETH',
    icon: 'Ξ',
    accent: 'text-emerald-400',
    accentBg: 'bg-emerald-500/10 border-emerald-500/30',
    placeholder: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38...',
    hint: 'Starts with 0x, 42 characters',
    paths: [
      { label: 'Standard', path: "m/44'/60'/0'/0/0" },
      { label: 'Ledger Live', path: "m/44'/60'/0'/0/0" },
    ],
  },
  sol: {
    name: 'Solana',
    symbol: 'SOL',
    icon: '◎',
    accent: 'text-cyan-400',
    accentBg: 'bg-cyan-500/10 border-cyan-500/30',
    placeholder: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU...',
    hint: 'Base58 encoded, 32-44 characters',
    paths: [
      { label: 'Standard (BIP44)', path: "m/44'/501'/0'/0'" },
      { label: 'Phantom', path: "m/44'/501'/0'/0'" },
    ],
  },
  xrp: {
    name: 'XRP',
    symbol: 'XRP',
    icon: '✕',
    accent: 'text-teal-400',
    accentBg: 'bg-teal-500/10 border-teal-500/30',
    placeholder: 'rN7n3473SaZBCG4dFL83w7w1g2h2h4kQ7V...',
    hint: 'Starts with r, 25-35 characters',
    paths: [
      { label: 'Standard', path: "m/44'/144'/0'/0/0" },
    ],
  },
}

// ─── Autocomplete Component ──────────────────────────────────────────────────

function WordInput({
  index,
  value,
  isUnknown,
  onValueChange,
  onToggleUnknown,
  wordlist,
}: {
  index: number
  value: string
  isUnknown: boolean
  onValueChange: (val: string) => void
  onToggleUnknown: () => void
  wordlist: string[]
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (value.length > 0 && !isUnknown) {
      const lower = value.toLowerCase()
      return wordlist.filter((w) => w.startsWith(lower)).slice(0, 8)
    }
    return []
  }, [value, isUnknown, wordlist])

  const showDropdown =
    dropdownOpen &&
    filtered.length > 0 &&
    !(filtered.length === 1 && filtered[0] === value.toLowerCase())

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault()
      onValueChange(filtered[highlightIndex])
      setDropdownOpen(false)
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <span
            className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold pointer-events-none z-10 ${
              isUnknown ? 'text-amber-500' : 'text-zinc-500'
            }`}
          >
            {index + 1}
          </span>
          <Input
            ref={inputRef}
            value={isUnknown ? '???' : value}
            onChange={(e) => {
              if (!isUnknown) {
                onValueChange(e.target.value)
                setDropdownOpen(true)
                setHighlightIndex(-1)
              }
            }}
            onFocus={() => {
              if (value.length > 0 && !isUnknown) {
                setDropdownOpen(true)
              }
            }}
            onBlur={() => {
              setTimeout(() => setDropdownOpen(false), 150)
            }}
            onKeyDown={handleKeyDown}
            disabled={isUnknown}
            placeholder={isUnknown ? '???' : 'word'}
            className={`h-11 pl-7 pr-2 text-sm font-mono transition-all duration-200 ${
              isUnknown
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 placeholder:text-amber-500/50 shadow-inner shadow-amber-500/5'
                : value && wordlist.includes(value.toLowerCase())
                  ? 'bg-zinc-900/80 border-emerald-500/40 text-emerald-300 placeholder:text-zinc-600 shadow-inner shadow-emerald-500/5'
                  : 'bg-zinc-900/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-emerald-500/20'
            }`}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={`h-11 w-11 shrink-0 transition-all duration-200 rounded-lg ${
            isUnknown
              ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/30'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
          onClick={onToggleUnknown}
          title={isUnknown ? 'Mark as known' : 'Mark as unknown'}
        >
          {isUnknown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      {/* Autocomplete Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 top-full mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 overflow-hidden"
        >
          {filtered.map((word, i) => (
            <button
              key={word}
              className={`w-full text-left px-3 py-1.5 text-sm font-mono transition-colors ${
                i === highlightIndex
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-zinc-300 hover:bg-zinc-700'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                onValueChange(word)
                setDropdownOpen(false)
                inputRef.current?.focus()
              }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              {word}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── FAQ Item Component ──────────────────────────────────────────────────────

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-zinc-800/60 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-900/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-medium text-zinc-300">{question}</span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-zinc-500 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-3 text-xs text-zinc-500 leading-relaxed">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function Home() {
  // ── State ──
  const [words, setWords] = useState<(string | null)[]>(Array(12).fill(''))
  const [inputValues, setInputValues] = useState<string[]>(Array(12).fill(''))
  const [blockchain, setBlockchain] = useState<Blockchain>('eth')
  const [derivationPath, setDerivationPath] = useState<string>("m/44'/60'/0'/0/0")
  const [knownAddress, setKnownAddress] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<RecoveryJob | null>(null)
  const [wordlist, setWordlist] = useState<string[]>([])
  const [isStarting, setIsStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('recover')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Verify tab state
  const [verifyMnemonic, setVerifyMnemonic] = useState('')
  const [verifyAddress, setVerifyAddress] = useState('')
  const [verifyBlockchain, setVerifyBlockchain] = useState<Blockchain>('eth')
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  // History state
  const [jobHistory, setJobHistory] = useState<RecoveryJob[]>([])

  // Estimate warning state
  const [showEstimateWarning, setShowEstimateWarning] = useState(false)

  // ── Fetch wordlist ──
  useEffect(() => {
    fetch('/api/wordlist')
      .then((r) => r.json())
      .then((data) => setWordlist(data.words || []))
      .catch(() => console.error('Failed to fetch wordlist'))
  }, [])

  // ── Polling ──
  useEffect(() => {
    if (jobId && (!jobStatus || jobStatus.status === 'pending' || jobStatus.status === 'running')) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/recover?jobId=${jobId}`)
          const data = await res.json()
          setJobStatus(data)
          if (data.status === 'completed' || data.status === 'failed' || data.status === 'stopped') {
            if (pollRef.current) clearInterval(pollRef.current)
            // Refresh history
            fetchHistory()
          }
        } catch {
          console.error('Polling error')
        }
      }, 500)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobId, jobStatus?.status])

  // ── Fetch history ──
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/recover')
      const data = await res.json()
      if (data.jobs) setJobHistory(data.jobs)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // ── Computed ──
  const knownCount = words.filter((w) => w !== null && w !== '').length
  const unknownCount = words.filter((w) => w === null).length
  const isRunning = jobStatus?.status === 'running' || jobStatus?.status === 'pending'
  const isCompleted = jobStatus?.status === 'completed'
  const isFailed = jobStatus?.status === 'failed'
  const isStopped = jobStatus?.status === 'stopped'
  const progressPct = jobStatus ? Math.min((jobStatus.progress / jobStatus.total) * 100, 100) : 0
  const elapsedSeconds =
    jobStatus?.startedAt && isRunning
      ? (Date.now() - jobStatus.startedAt) / 1000
      : jobStatus?.startedAt && jobStatus?.foundAt
        ? (jobStatus.foundAt - jobStatus.startedAt) / 1000
        : 0
  const etaSeconds =
    jobStatus && isRunning && jobStatus.speed > 0
      ? (jobStatus.total - jobStatus.progress) / jobStatus.speed
      : 0

  // Estimate for current config
  const estimatedSeconds = useMemo(() => {
    if (unknownCount === 0) return 0
    const total = Math.pow(2048, unknownCount)
    return total / 1000 // assuming ~1000 combos/sec
  }, [unknownCount])

  // ── Handlers ──
  const handleWordChange = useCallback((index: number, val: string) => {
    setInputValues((prev) => {
      const next = [...prev]
      next[index] = val
      return next
    })
    setWords((prev) => {
      const next = [...prev]
      const lower = val.toLowerCase().trim()
      next[index] = lower.length > 0 ? lower : ''
      return next
    })
  }, [])

  const handleToggleUnknown = useCallback((index: number) => {
    setWords((prev) => {
      const next = [...prev]
      if (next[index] === null) {
        next[index] = inputValues[index].toLowerCase().trim() || ''
      } else {
        next[index] = null
      }
      return next
    })
  }, [inputValues])

  const handleBlockchainChange = useCallback((chain: Blockchain) => {
    setBlockchain(chain)
    const paths = BLOCKCHAIN_CONFIG[chain].paths
    if (paths.length > 0) {
      setDerivationPath(paths[0].path)
    }
  }, [])

  const handleStartRecovery = async () => {
    if (knownCount < 8) {
      toast.error('At least 8 known words required', {
        description: `You have ${knownCount} known words. Please fill in more slots or mark fewer as unknown.`,
      })
      return
    }
    if (!knownAddress.trim()) {
      toast.error('Known address is required', {
        description: 'Please enter your known wallet address for verification.',
      })
      return
    }

    // Show estimate warning for large searches
    if (unknownCount >= 3 && !showEstimateWarning) {
      setShowEstimateWarning(true)
      return
    }
    setShowEstimateWarning(false)

    const partialMnemonic = words.map((w) => (w && w.trim().length > 0 ? w.trim() : null))

    for (let i = 0; i < 12; i++) {
      const w = partialMnemonic[i]
      if (w !== null && wordlist.length > 0 && !wordlist.includes(w)) {
        toast.error(`Invalid word at position ${i + 1}: "${w}"`, {
          description: 'All known words must be from the BIP39 wordlist.',
        })
        return
      }
    }

    setIsStarting(true)
    try {
      const res = await fetch('/api/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partialMnemonic,
          knownAddress: knownAddress.trim(),
          blockchain,
          derivationPath,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to start recovery')
        return
      }
      setJobId(data.jobId)
      setJobStatus(null)
      toast.success('Recovery job started!', {
        description: 'Searching for your wallet...',
      })
    } catch {
      toast.error('Network error', {
        description: 'Could not connect to the server.',
      })
    } finally {
      setIsStarting(false)
    }
  }

  const handleStopRecovery = async () => {
    if (!jobId) return
    try {
      await fetch(`/api/recover?jobId=${jobId}`, { method: 'DELETE' })
      toast.info('Recovery job stopped')
    } catch {
      toast.error('Failed to stop recovery job')
    }
  }

  const handleReset = () => {
    setWords(Array(12).fill(''))
    setInputValues(Array(12).fill(''))
    setKnownAddress('')
    setJobId(null)
    setJobStatus(null)
    setCopied(false)
    setShowEstimateWarning(false)
  }

  const handleCopyResult = () => {
    if (jobStatus?.result && jobStatus.result.length > 0) {
      navigator.clipboard.writeText(jobStatus.result[0])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Seed phrase copied to clipboard')
    }
  }

  const handleVerify = async () => {
    if (!verifyMnemonic.trim()) {
      toast.error('Seed phrase is required')
      return
    }
    if (!verifyAddress.trim()) {
      toast.error('Wallet address is required')
      return
    }
    setIsVerifying(true)
    setVerifyResult(null)
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mnemonic: verifyMnemonic.trim(),
          knownAddress: verifyAddress.trim(),
          blockchain: verifyBlockchain,
          derivationPath,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Verification failed')
        return
      }
      setVerifyResult(data)
    } catch {
      toast.error('Network error')
    } finally {
      setIsVerifying(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* ── Header ── */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30">
            <Shield className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Crypto<span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">Recover</span>
            </h1>
            <p className="text-[10px] text-zinc-500 tracking-wide">Legitimate Wallet Recovery Tool</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px] gap-1"
            >
              <Fingerprint className="h-3 w-3" />
              Own-Wallet Only
            </Badge>
            <Badge
              variant="outline"
              className="border-cyan-500/30 text-cyan-400 bg-cyan-500/10 text-[10px] gap-1"
            >
              <Activity className="h-3 w-3" />
              {wordlist.length > 0 ? 'Online' : 'Loading...'}
            </Badge>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 w-full">
        {/* ── How It Works ── */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: <Key className="h-5 w-5 text-emerald-400" />,
                step: '01',
                title: 'Enter Partial Seed',
                desc: 'Input your 12-word seed phrase, marking unknown words with the eye toggle.',
                glow: 'from-emerald-500/10',
              },
              {
                icon: <Wallet className="h-5 w-5 text-cyan-400" />,
                step: '02',
                title: 'Provide Address',
                desc: 'Enter your known wallet address for verification against derived addresses.',
                glow: 'from-cyan-500/10',
              },
              {
                icon: <FileCheck className="h-5 w-5 text-teal-400" />,
                step: '03',
                title: 'Recover Wallet',
                desc: 'We brute-force unknown words and verify against your known address.',
                glow: 'from-teal-500/10',
              },
            ].map((item, idx) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.4 }}
              >
                <Card className="bg-zinc-900/60 border-zinc-800/60 hover:border-zinc-700/80 transition-all duration-300 py-4 relative overflow-hidden group">
                  <div className={`absolute inset-0 bg-gradient-to-b ${item.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                  <CardContent className="pt-0 flex flex-col items-center text-center gap-2 px-4 relative z-10">
                    <div className="flex items-center justify-center h-10 w-10 rounded-full bg-zinc-800 border border-zinc-700">
                      {item.icon}
                    </div>
                    <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                      Step {item.step}
                    </span>
                    <h3 className="font-semibold text-sm text-zinc-200">{item.title}</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        <Separator className="bg-zinc-800/60" />

        {/* ── Tab Navigation ── */}
        <div className="flex gap-1 bg-zinc-900/60 p-1 rounded-xl border border-zinc-800/60">
          {([
            { id: 'recover' as AppTab, label: 'Recovery', icon: <Search className="h-4 w-4" /> },
            { id: 'verify' as AppTab, label: 'Quick Verify', icon: <CheckCircle2 className="h-4 w-4" /> },
            { id: 'history' as AppTab, label: 'History', icon: <History className="h-4 w-4" /> },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/5'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Recovery Tab ── */}
        <AnimatePresence mode="wait">
          {activeTab === 'recover' && (
            <motion.div
              key="recover"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* ── Seed Phrase Input ── */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Key className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-lg font-semibold">Seed Phrase</h2>
                  <div className="ml-auto flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] gap-1 transition-colors ${
                        knownCount >= 8
                          ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                          : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                      }`}
                    >
                      <Check className="h-3 w-3" />
                      {knownCount} known
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] gap-1 ${
                        unknownCount > 0
                          ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                          : 'border-zinc-700 text-zinc-500 bg-zinc-900'
                      }`}
                    >
                      <EyeOff className="h-3 w-3" />
                      {unknownCount} unknown
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mb-4">
                  Enter the words you remember. Click the eye icon to mark words as unknown.
                  At least <span className="text-emerald-400 font-semibold">8 known words</span> are
                  required.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <WordInput
                      key={i}
                      index={i}
                      value={inputValues[i]}
                      isUnknown={words[i] === null}
                      onValueChange={(val) => handleWordChange(i, val)}
                      onToggleUnknown={() => handleToggleUnknown(i)}
                      wordlist={wordlist}
                    />
                  ))}
                </div>
                {knownCount < 8 && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-3 text-xs text-amber-400/80 flex items-center gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Need at least {8 - knownCount} more known word{(8 - knownCount) !== 1 ? 's' : ''} to
                    proceed
                  </motion.p>
                )}
                {unknownCount > 0 && knownCount >= 8 && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-3 text-xs text-cyan-400/80 flex items-center gap-1"
                  >
                    <Timer className="h-3 w-3" />
                    Estimated search: ~{formatTime(estimatedSeconds)} ({formatNumber(Math.pow(2048, unknownCount))} combinations)
                  </motion.p>
                )}
              </section>

              <Separator className="bg-zinc-800/60" />

              {/* ── Configuration ── */}
              <section className="space-y-6">
                {/* Blockchain Selector */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-lg font-semibold">Blockchain</h2>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                    {(Object.entries(BLOCKCHAIN_CONFIG) as [Blockchain, typeof BLOCKCHAIN_CONFIG[Blockchain]][]).map(
                      ([key, config]) => (
                        <button
                          key={key}
                          onClick={() => handleBlockchainChange(key)}
                          className={`flex flex-col items-center gap-1.5 p-3 sm:p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer relative overflow-hidden group ${
                            blockchain === key
                              ? config.accentBg + ' ' + config.accent
                              : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60'
                          }`}
                        >
                          {blockchain === key && (
                            <motion.div
                              layoutId="blockchain-glow"
                              className={`absolute inset-0 bg-gradient-to-b ${
                                key === 'btc' ? 'from-orange-500/5' :
                                key === 'eth' ? 'from-emerald-500/5' :
                                key === 'sol' ? 'from-cyan-500/5' :
                                'from-teal-500/5'
                              } to-transparent`}
                            />
                          )}
                          <span className="text-2xl relative z-10">{config.icon}</span>
                          <span className="text-sm font-semibold relative z-10">{config.symbol}</span>
                          <span className="text-[10px] text-zinc-500 relative z-10">{config.name}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Derivation Path */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Hash className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold">Derivation Path</h2>
                    <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500">
                      Advanced
                    </Badge>
                  </div>
                  <Select value={derivationPath} onValueChange={setDerivationPath}>
                    <SelectTrigger className="bg-zinc-900/80 border-zinc-700 text-zinc-100 font-mono text-xs h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      {BLOCKCHAIN_CONFIG[blockchain].paths.map((p) => (
                        <SelectItem key={p.path + p.label} value={p.path} className="font-mono text-xs">
                          <span className="text-zinc-400">{p.label}:</span>{' '}
                          <span className="text-emerald-400">{p.path}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Known Address */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Fingerprint className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-lg font-semibold">Known Wallet Address</h2>
                  </div>
                  <Input
                    value={knownAddress}
                    onChange={(e) => setKnownAddress(e.target.value)}
                    placeholder={BLOCKCHAIN_CONFIG[blockchain].placeholder}
                    disabled={isRunning}
                    className="h-12 bg-zinc-900/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 font-mono text-sm focus:border-emerald-500/50 focus:ring-emerald-500/20"
                  />
                  <p className="mt-2 text-xs text-zinc-500 flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" />
                    {BLOCKCHAIN_CONFIG[blockchain].hint}
                  </p>
                </div>
              </section>

              <Separator className="bg-zinc-800/60" />

              {/* ── Estimate Warning ── */}
              <AnimatePresence>
                {showEstimateWarning && unknownCount >= 3 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Card className="bg-amber-950/30 border-amber-500/30 mb-4">
                      <CardContent className="flex gap-3 px-4 py-3">
                        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold text-amber-300">Large Search Warning</h3>
                          <p className="text-xs text-zinc-400">
                            With {unknownCount} unknown words, there are{' '}
                            <strong className="text-amber-300">{formatNumber(Math.pow(2048, unknownCount))}</strong>{' '}
                            combinations. At ~1,000 combos/sec, this could take{' '}
                            <strong className="text-amber-300">{formatTime(estimatedSeconds)}</strong>.
                            Consider reducing unknown words for a practical recovery time.
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              className="bg-amber-600 hover:bg-amber-500 text-white text-xs h-8"
                              onClick={handleStartRecovery}
                            >
                              Proceed Anyway
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-zinc-700 text-zinc-400 text-xs h-8"
                              onClick={() => setShowEstimateWarning(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Action Buttons ── */}
              <section className="flex flex-col sm:flex-row gap-3">
                {!isRunning && !isCompleted && !isFailed && !isStopped ? (
                  <Button
                    onClick={handleStartRecovery}
                    disabled={isStarting || knownCount < 8 || !knownAddress.trim() || showEstimateWarning}
                    className="flex-1 h-12 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isStarting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        Start Recovery
                      </>
                    )}
                  </Button>
                ) : isRunning ? (
                  <Button
                    onClick={handleStopRecovery}
                    variant="destructive"
                    className="flex-1 h-12 font-semibold text-sm transition-all duration-200"
                  >
                    <StopCircle className="h-4 w-4" />
                    Stop Recovery
                  </Button>
                ) : null}

                {(isCompleted || isFailed || isStopped) && (
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    className="flex-1 h-12 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 font-semibold text-sm transition-all duration-200"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Start New Recovery
                  </Button>
                )}
              </section>

              {/* ── Progress Display ── */}
              <AnimatePresence>
                {jobStatus && (isRunning || jobStatus.status === 'pending') && (
                  <motion.section
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <Card className="bg-zinc-900/60 border-zinc-800/60 overflow-hidden relative">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500 via-cyan-500 to-teal-500 animate-pulse" />
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                          <CardTitle className="text-sm font-semibold text-zinc-200">
                            Recovery In Progress
                          </CardTitle>
                          <Badge variant="outline" className="ml-auto text-[9px] border-emerald-500/30 text-emerald-400">
                            <Activity className="h-3 w-3 mr-1" />
                            Live
                          </Badge>
                        </div>
                        <CardDescription className="text-xs text-zinc-500">
                          Searching for matching wallet address...
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4 pt-0">
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs text-zinc-400">
                            <span>{progressPct.toFixed(2)}% complete</span>
                            <span>
                              {formatNumber(jobStatus.progress)} / {formatNumber(jobStatus.total)}
                            </span>
                          </div>
                          <div className="relative">
                            <Progress
                              value={progressPct}
                              className="h-3 bg-zinc-800 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-cyan-500"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { icon: <Zap className="h-3 w-3 text-emerald-400" />, label: 'Speed', value: `${formatNumber(jobStatus.speed)}/s` },
                            { icon: <Search className="h-3 w-3 text-cyan-400" />, label: 'Checked', value: formatNumber(jobStatus.progress) },
                            { icon: <Clock className="h-3 w-3 text-amber-400" />, label: 'ETA', value: formatTime(etaSeconds) },
                            { icon: <Sparkles className="h-3 w-3 text-teal-400" />, label: 'Elapsed', value: formatTime(elapsedSeconds) },
                          ].map((stat) => (
                            <div key={stat.label} className="bg-zinc-800/50 rounded-lg p-3 text-center border border-zinc-800/50">
                              <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                                {stat.icon}
                                {stat.label}
                              </div>
                              <p className="text-sm font-semibold text-zinc-200">{stat.value}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.section>
                )}
              </AnimatePresence>

              {/* ── Results Display ── */}
              <AnimatePresence>
                {isCompleted && jobStatus && (
                  <motion.section
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    {jobStatus.result && jobStatus.result.length > 0 ? (
                      <Card className="bg-emerald-950/30 border-emerald-500/30 overflow-hidden relative">
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-cyan-500 to-teal-500" />
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-2">
                            <CircleCheck className="h-5 w-5 text-emerald-400" />
                            <CardTitle className="text-emerald-300 font-semibold">
                              Wallet Recovered Successfully!
                            </CardTitle>
                          </div>
                          <CardDescription className="text-emerald-400/60 text-xs">
                            A matching seed phrase was found for your wallet address.
                            {jobStatus.foundAt && jobStatus.startedAt && (
                              <span className="ml-1">
                                Took {formatTime((jobStatus.foundAt - jobStatus.startedAt) / 1000)}.
                              </span>
                            )}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-0">
                          <div className="bg-zinc-900/80 rounded-xl p-4 border border-emerald-500/20">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3 font-semibold">
                              Recovered Seed Phrase
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                              {jobStatus.result[0].split(' ').map((word, i) => (
                                <motion.div
                                  key={i}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: i * 0.05 }}
                                  className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${
                                    words[i] === null
                                      ? 'bg-emerald-500/10 border-emerald-500/30'
                                      : 'bg-zinc-800/80 border-zinc-700/50'
                                  }`}
                                >
                                  <span className="text-[10px] text-zinc-600 font-bold min-w-[16px]">
                                    {i + 1}
                                  </span>
                                  <span className={`font-mono text-sm font-medium ${
                                    words[i] === null ? 'text-emerald-300' : 'text-zinc-300'
                                  }`}>
                                    {word}
                                  </span>
                                </motion.div>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={handleCopyResult}
                              className="flex-1 h-11 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold text-sm shadow-lg shadow-emerald-500/20"
                            >
                              {copied ? (
                                <>
                                  <Check className="h-4 w-4" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="h-4 w-4" />
                                  Copy Seed Phrase
                                </>
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="bg-zinc-900/60 border-zinc-800/60">
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-400" />
                            <CardTitle className="text-amber-300 font-semibold">
                              No Match Found
                            </CardTitle>
                          </div>
                          <CardDescription className="text-zinc-500 text-xs">
                            The recovery search completed but no matching address was found.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
                            <p className="text-xs text-zinc-400">This could mean:</p>
                            <ul className="text-xs text-zinc-500 space-y-1 list-disc list-inside">
                              <li>One or more known words are incorrect</li>
                              <li>The wallet address belongs to a different seed phrase</li>
                              <li>The selected blockchain or derivation path is incorrect</li>
                              <li>The unknown words are beyond the search scope</li>
                            </ul>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </motion.section>
                )}
              </AnimatePresence>

              {/* ── Failed Display ── */}
              {isFailed && (
                <Card className="bg-red-950/20 border-red-500/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-400" />
                      <CardTitle className="text-red-300 font-semibold">Recovery Failed</CardTitle>
                    </div>
                    <CardDescription className="text-red-400/60 text-xs">
                      An error occurred during the recovery process. Please try again.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}

              {/* ── Stopped Display ── */}
              {isStopped && (
                <Card className="bg-zinc-900/60 border-zinc-800/60">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <StopCircle className="h-5 w-5 text-zinc-400" />
                      <CardTitle className="text-zinc-300 font-semibold">Recovery Stopped</CardTitle>
                    </div>
                    <CardDescription className="text-zinc-500 text-xs">
                      The recovery job was stopped before completion.{' '}
                      {jobStatus && (
                        <span>
                          {formatNumber(jobStatus.progress)} of {formatNumber(jobStatus.total)}{' '}
                          combinations were checked.
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </motion.div>
          )}

          {/* ── Quick Verify Tab ── */}
          {activeTab === 'verify' && (
            <motion.div
              key="verify"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <Card className="bg-zinc-900/60 border-zinc-800/60">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <CardTitle className="text-lg">Quick Verify</CardTitle>
                  </div>
                  <CardDescription className="text-xs text-zinc-500">
                    Already have a complete seed phrase? Verify it matches your wallet address instantly.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-2 block">Seed Phrase (12 words)</label>
                    <textarea
                      value={verifyMnemonic}
                      onChange={(e) => setVerifyMnemonic(e.target.value)}
                      placeholder="Enter your 12-word seed phrase separated by spaces..."
                      className="w-full h-24 bg-zinc-900/80 border border-zinc-700 rounded-lg px-4 py-3 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-emerald-500/20 resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-2 block">Blockchain</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(Object.entries(BLOCKCHAIN_CONFIG) as [Blockchain, typeof BLOCKCHAIN_CONFIG[Blockchain]][]).map(
                        ([key, config]) => (
                          <button
                            key={key}
                            onClick={() => setVerifyBlockchain(key)}
                            className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg border transition-all duration-200 text-xs font-medium ${
                              verifyBlockchain === key
                                ? config.accentBg + ' ' + config.accent
                                : 'border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700'
                            }`}
                          >
                            <span>{config.icon}</span>
                            {config.symbol}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-2 block">Wallet Address</label>
                    <Input
                      value={verifyAddress}
                      onChange={(e) => setVerifyAddress(e.target.value)}
                      placeholder={BLOCKCHAIN_CONFIG[verifyBlockchain].placeholder}
                      className="h-11 bg-zinc-900/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 font-mono text-sm"
                    />
                  </div>

                  <Button
                    onClick={handleVerify}
                    disabled={isVerifying || !verifyMnemonic.trim() || !verifyAddress.trim()}
                    className="w-full h-12 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold text-sm shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Verify Seed Phrase
                      </>
                    )}
                  </Button>

                  {/* Verify Result */}
                  <AnimatePresence>
                    {verifyResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                      >
                        {verifyResult.match ? (
                          <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                              <span className="font-semibold text-emerald-300">Match Found!</span>
                            </div>
                            <p className="text-xs text-zinc-400">
                              This seed phrase derives the address:
                            </p>
                            <p className="text-xs font-mono text-emerald-300 mt-1 break-all">
                              {verifyResult.address}
                            </p>
                            <p className="text-xs text-emerald-400/60 mt-1">
                              This matches your provided wallet address.
                            </p>
                          </div>
                        ) : verifyResult.valid ? (
                          <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <XCircle className="h-5 w-5 text-amber-400" />
                              <span className="font-semibold text-amber-300">No Match</span>
                            </div>
                            <p className="text-xs text-zinc-400">
                              The seed phrase is valid but derives a different address:
                            </p>
                            <p className="text-xs font-mono text-amber-300 mt-1 break-all">
                              {verifyResult.address}
                            </p>
                            <p className="text-xs text-zinc-500 mt-1">
                              This does not match your provided wallet address. Check the blockchain or derivation path.
                            </p>
                          </div>
                        ) : (
                          <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <XCircle className="h-5 w-5 text-red-400" />
                              <span className="font-semibold text-red-300">Invalid Seed Phrase</span>
                            </div>
                            <p className="text-xs text-zinc-400">
                              {verifyResult.error || 'The mnemonic checksum validation failed. Check your words.'}
                            </p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── History Tab ── */}
          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <Card className="bg-zinc-900/60 border-zinc-800/60">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-emerald-400" />
                    <CardTitle className="text-lg">Recovery History</CardTitle>
                  </div>
                  <CardDescription className="text-xs text-zinc-500">
                    View all recovery jobs from this session. Jobs are not persisted after server restart.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {jobHistory.length === 0 ? (
                    <div className="text-center py-8">
                      <History className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
                      <p className="text-sm text-zinc-500">No recovery jobs yet</p>
                      <p className="text-xs text-zinc-600">Start a recovery to see it here</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                      {jobHistory
                        .sort((a, b) => b.startedAt - a.startedAt)
                        .map((job) => (
                          <div
                            key={job.id}
                            className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-800/50 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{BLOCKCHAIN_CONFIG[job.blockchain].icon}</span>
                                <div>
                                  <p className="text-xs font-medium text-zinc-300">
                                    {BLOCKCHAIN_CONFIG[job.blockchain].name} Recovery
                                  </p>
                                  <p className="text-[10px] text-zinc-600 font-mono">
                                    {job.derivationPath}
                                  </p>
                                </div>
                              </div>
                              <Badge
                                variant="outline"
                                className={`text-[9px] ${
                                  job.status === 'completed'
                                    ? job.result && job.result.length > 0
                                      ? 'border-emerald-500/30 text-emerald-400'
                                      : 'border-amber-500/30 text-amber-400'
                                    : job.status === 'running'
                                      ? 'border-cyan-500/30 text-cyan-400'
                                      : job.status === 'failed'
                                        ? 'border-red-500/30 text-red-400'
                                        : job.status === 'stopped'
                                          ? 'border-zinc-600 text-zinc-400'
                                          : 'border-zinc-700 text-zinc-500'
                                }`}
                              >
                                {job.status === 'completed' && job.result && job.result.length > 0
                                  ? 'Found'
                                  : job.status === 'completed'
                                    ? 'No Match'
                                    : job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                              <span className="flex items-center gap-1">
                                <Search className="h-3 w-3" />
                                {formatNumber(job.progress)}/{formatNumber(job.total)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Zap className="h-3 w-3" />
                                {formatNumber(job.speed)}/s
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '—'}
                              </span>
                            </div>
                            <p className="text-[10px] text-zinc-600 font-mono truncate">
                              {job.knownAddress}
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── FAQ Section ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <HelpCircle className="h-4 w-4 text-emerald-400" />
            <h2 className="text-lg font-semibold">FAQ</h2>
          </div>
          <div className="space-y-2">
            <FaqItem
              question="How does the recovery process work?"
              answer="The tool takes your partial seed phrase (with known and unknown words) and systematically tries all possible BIP39 words in the unknown positions. For each valid combination (verified by BIP39 checksum), it derives the wallet address and compares it against your known address. When a match is found, the complete seed phrase is returned."
            />
            <FaqItem
              question="Why do I need to provide a wallet address?"
              answer="This is a critical security and legitimacy feature. The known address ensures the tool only recovers YOUR wallet. Without address verification, the tool could potentially find seed phrases for other people's wallets. By requiring your known address, we ensure this tool is used exclusively for legitimate self-recovery."
            />
            <FaqItem
              question="How many unknown words can I have?"
              answer="Theoretically up to 4, but practically 1-2 unknowns. With 1 unknown word (2,048 combinations), recovery takes seconds. With 2 unknowns (~4.2 million combinations), it takes about an hour. With 3 unknowns (~8.6 billion combinations), it would take months. The BIP39 checksum pre-filter eliminates ~93.75% of invalid candidates, but the remaining combinations still need full address derivation."
            />
            <FaqItem
              question="What is a derivation path?"
              answer="A derivation path defines how the seed phrase is converted into a wallet address. Different blockchains use different paths (e.g., m/44'/60'/0'/0/0 for Ethereum, m/44'/0'/0'/0/0 for Bitcoin). Some wallets use non-standard paths, so if the default path doesn't find your wallet, try an alternative path."
            />
            <FaqItem
              question="Is my seed phrase stored or transmitted?"
              answer="Your seed phrase is processed entirely server-side in memory and is never persisted to disk or transmitted to third parties. Job data is stored in memory only and is lost when the server restarts. We strongly recommend copying your recovered seed phrase and storing it offline in a secure location."
            />
            <FaqItem
              question="What is the Quick Verify feature?"
              answer="Quick Verify allows you to instantly check if a complete 12-word seed phrase matches a specific wallet address. This is useful when you have a seed phrase but want to confirm it corresponds to a particular wallet address before importing it into a wallet application."
            />
          </div>
        </section>

        {/* ── Important Notice ── */}
        <section>
          <Card className="bg-amber-950/20 border-amber-500/20">
            <CardContent className="flex gap-3 px-4 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-amber-300">Important Notice</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  This tool is designed <strong className="text-amber-300">exclusively</strong> for
                  recovering your own wallets. It requires a known wallet address for verification
                  and only checks derived addresses against your provided address. It does not check
                  balances or attempt to access others&apos; wallets.
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Never share your seed phrase with anyone. Store your recovery in a secure,
                  offline location. This tool processes everything server-side and does not store
                  your seed phrase after the recovery session ends.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t border-zinc-800/60 bg-zinc-950/90">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-zinc-600" />
              <span className="text-xs text-zinc-600">
                &copy; {new Date().getFullYear()} CryptoRecover
              </span>
            </div>
            <p className="text-[10px] text-zinc-700 text-center sm:text-right">
              For legitimate self-recovery only. Unauthorized use is prohibited. No data is stored after session ends.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
