'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
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
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ───────────────────────────────────────────────────────────────────

type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp'

interface RecoveryJob {
  id: string
  partialMnemonic: (string | null)[]
  knownAddress: string
  blockchain: Blockchain
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  progress: number
  total: number
  speed: number
  result: string[] | null
  startedAt: number | null
  foundAt: number | null
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
  { name: string; symbol: string; icon: string; accent: string; placeholder: string; hint: string }
> = {
  btc: {
    name: 'Bitcoin',
    symbol: 'BTC',
    icon: '₿',
    accent: 'text-orange-400 border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20',
    placeholder: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa...',
    hint: 'Starts with 1, 3, or bc1',
  },
  eth: {
    name: 'Ethereum',
    symbol: 'ETH',
    icon: 'Ξ',
    accent: 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20',
    placeholder: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38...',
    hint: 'Starts with 0x, 42 characters',
  },
  sol: {
    name: 'Solana',
    symbol: 'SOL',
    icon: '◎',
    accent: 'text-cyan-400 border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20',
    placeholder: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU...',
    hint: 'Base58 encoded, 32-44 characters',
  },
  xrp: {
    name: 'XRP',
    symbol: 'XRP',
    icon: '✕',
    accent: 'text-teal-400 border-teal-500/50 bg-teal-500/10 hover:bg-teal-500/20',
    placeholder: 'rN7n3473SaZBCG4dFL83w7w1g2h2h4kQ7V...',
    hint: 'Starts with r, 25-35 characters',
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

  // Compute filtered words via useMemo instead of useEffect + setState
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
            className={`absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold pointer-events-none z-10 ${
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
              // Delay to allow click on dropdown item
              setTimeout(() => setDropdownOpen(false), 150)
            }}
            onKeyDown={handleKeyDown}
            disabled={isUnknown}
            placeholder={isUnknown ? '???' : 'word'}
            className={`h-10 pl-7 pr-1 text-sm font-mono transition-all duration-200 ${
              isUnknown
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 placeholder:text-amber-500/50'
                : 'bg-zinc-900/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-emerald-500/20'
            }`}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={`h-10 w-10 shrink-0 transition-all duration-200 ${
            isUnknown
              ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
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

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function Home() {
  // ── State ──
  const [words, setWords] = useState<(string | null)[]>(Array(12).fill(''))
  const [inputValues, setInputValues] = useState<string[]>(Array(12).fill(''))
  const [blockchain, setBlockchain] = useState<Blockchain>('eth')
  const [knownAddress, setKnownAddress] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<RecoveryJob | null>(null)
  const [wordlist, setWordlist] = useState<string[]>([])
  const [isStarting, setIsStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // ── Computed ──
  const knownCount = words.filter((w) => w !== null && w !== '').length
  const unknownCount = words.filter((w) => w === null).length
  const isRunning = jobStatus?.status === 'running' || jobStatus?.status === 'pending'
  const isCompleted = jobStatus?.status === 'completed'
  const isFailed = jobStatus?.status === 'failed'
  const isStopped = jobStatus?.status === 'stopped'
  const progressPct = jobStatus ? (jobStatus.progress / jobStatus.total) * 100 : 0
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
        // Currently unknown, toggle back to known (empty string)
        next[index] = inputValues[index].toLowerCase().trim() || ''
      } else {
        // Currently known, toggle to unknown
        next[index] = null
      }
      return next
    })
  }, [inputValues])

  const handleStartRecovery = async () => {
    // Validate
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

    // Build partial mnemonic - convert empty strings to null
    const partialMnemonic = words.map((w) => (w && w.trim().length > 0 ? w.trim() : null))

    // Validate that known words are in BIP39 wordlist
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
    setBlockchain('eth')
    setCopied(false)
  }

  const handleCopyResult = () => {
    if (jobStatus?.result && jobStatus.result.length > 0) {
      navigator.clipboard.writeText(jobStatus.result[0])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Seed phrase copied to clipboard')
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* ── Header ── */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30">
            <Shield className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Crypto<span className="text-emerald-400">Recover</span>
            </h1>
            <p className="text-xs text-zinc-500">Legitimate Wallet Recovery Tool</p>
          </div>
          <div className="ml-auto">
            <Badge
              variant="outline"
              className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px] gap-1"
            >
              <Fingerprint className="h-3 w-3" />
              Own-Wallet Only
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
                desc: 'Input your 12-word seed phrase, marking unknown words.',
              },
              {
                icon: <Wallet className="h-5 w-5 text-cyan-400" />,
                step: '02',
                title: 'Provide Address',
                desc: 'Enter your known wallet address for verification.',
              },
              {
                icon: <FileCheck className="h-5 w-5 text-teal-400" />,
                step: '03',
                title: 'Recover Wallet',
                desc: 'We brute-force unknown words and verify against your address.',
              },
            ].map((item) => (
              <Card
                key={item.step}
                className="bg-zinc-900/60 border-zinc-800/60 hover:border-zinc-700/80 transition-colors duration-300 py-4"
              >
                <CardContent className="pt-0 flex flex-col items-center text-center gap-2 px-4">
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
            ))}
          </div>
        </section>

        <Separator className="bg-zinc-800/60" />

        {/* ── Seed Phrase Input ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Key className="h-4 w-4 text-emerald-400" />
            <h2 className="text-lg font-semibold">Seed Phrase</h2>
            <div className="ml-auto flex items-center gap-2">
              <Badge
                variant="outline"
                className={`text-[10px] gap-1 ${
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
                className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-[10px] gap-1"
              >
                <EyeOff className="h-3 w-3" />
                {unknownCount} unknown
              </Badge>
            </div>
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            Enter the words you remember. Toggle the eye icon to mark words as unknown.
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
            <p className="mt-3 text-xs text-amber-400/80 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Need at least {8 - knownCount} more known word{(8 - knownCount) !== 1 ? 's' : ''} to
              proceed
            </p>
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
                    onClick={() => setBlockchain(key)}
                    className={`flex flex-col items-center gap-1.5 p-3 sm:p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer ${
                      blockchain === key
                        ? config.accent
                        : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60'
                    }`}
                  >
                    <span className="text-2xl">{config.icon}</span>
                    <span className="text-sm font-semibold">{config.symbol}</span>
                    <span className="text-[10px] text-zinc-500">{config.name}</span>
                  </button>
                )
              )}
            </div>
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
              className="h-11 bg-zinc-900/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 font-mono text-sm focus:border-emerald-500/50 focus:ring-emerald-500/20"
            />
            <p className="mt-2 text-xs text-zinc-500 flex items-center gap-1">
              <ArrowRight className="h-3 w-3" />
              {BLOCKCHAIN_CONFIG[blockchain].hint}
            </p>
          </div>
        </section>

        <Separator className="bg-zinc-800/60" />

        {/* ── Action Buttons ── */}
        <section className="flex flex-col sm:flex-row gap-3">
          {!isRunning && !isCompleted && !isFailed && !isStopped ? (
            <Button
              onClick={handleStartRecovery}
              disabled={isStarting || knownCount < 8 || !knownAddress.trim()}
              className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
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
        {jobStatus && (isRunning || jobStatus.status === 'pending') && (
          <section>
            <Card className="bg-zinc-900/60 border-zinc-800/60 overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                  <CardTitle className="text-sm font-semibold text-zinc-200">
                    Recovery In Progress
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-zinc-500">
                  Searching for matching wallet address...
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>{progressPct.toFixed(2)}% complete</span>
                    <span>
                      {formatNumber(jobStatus.progress)} / {formatNumber(jobStatus.total)}
                    </span>
                  </div>
                  <Progress
                    value={progressPct}
                    className="h-2.5 bg-zinc-800 [&>div]:bg-emerald-500"
                  />
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                      <Zap className="h-3 w-3 text-emerald-400" />
                      Speed
                    </div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {formatNumber(jobStatus.speed)}
                      <span className="text-[10px] text-zinc-500 ml-0.5">/s</span>
                    </p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                      <Search className="h-3 w-3 text-cyan-400" />
                      Checked
                    </div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {formatNumber(jobStatus.progress)}
                    </p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                      <Clock className="h-3 w-3 text-amber-400" />
                      ETA
                    </div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {formatTime(etaSeconds)}
                    </p>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                      <Sparkles className="h-3 w-3 text-teal-400" />
                      Elapsed
                    </div>
                    <p className="text-sm font-semibold text-zinc-200">
                      {formatTime(elapsedSeconds)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Results Display ── */}
        {isCompleted && jobStatus && (
          <section>
            {jobStatus.result && jobStatus.result.length > 0 ? (
              <Card className="bg-emerald-950/30 border-emerald-500/30 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CircleCheck className="h-5 w-5 text-emerald-400" />
                    <CardTitle className="text-emerald-300 font-semibold">
                      Wallet Recovered Successfully!
                    </CardTitle>
                  </div>
                  <CardDescription className="text-emerald-400/60 text-xs">
                    A matching seed phrase was found for your wallet address.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <div className="bg-zinc-900/80 rounded-xl p-4 border border-emerald-500/20">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3 font-semibold">
                      Recovered Seed Phrase
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {jobStatus.result[0].split(' ').map((word, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 bg-zinc-800/80 rounded-lg px-3 py-2 border border-zinc-700/50"
                        >
                          <span className="text-[10px] text-zinc-600 font-bold min-w-[16px]">
                            {i + 1}
                          </span>
                          <span className="font-mono text-sm text-emerald-300 font-medium">
                            {word}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button
                    onClick={handleCopyResult}
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-500/20"
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
                    <p className="text-xs text-zinc-400">
                      This could mean:
                    </p>
                    <ul className="text-xs text-zinc-500 space-y-1 list-disc list-inside">
                      <li>One or more known words are incorrect</li>
                      <li>The wallet address belongs to a different seed phrase</li>
                      <li>The selected blockchain is incorrect</li>
                      <li>The unknown words are beyond the search scope</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* ── Failed Display ── */}
        {isFailed && (
          <section>
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
          </section>
        )}

        {/* ── Stopped Display ── */}
        {isStopped && (
          <section>
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
          </section>
        )}

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
      <footer className="mt-auto border-t border-zinc-800/60 bg-zinc-950/80">
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
