'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  Download,
  Lock,
  Globe,
  Cpu,
  Database,
  ToggleLeft,
  ToggleRight,
  Info,
  ExternalLink,
  Eye as EyeIcon,
  MapPin,
  ClipboardPaste,
  TrendingUp,
  BarChart3,
  Github,
  Code2,
  Server,
  BookOpen,
  RefreshCw,
  Gauge,
  Route,
  Sun,
  Moon,
  Plus,
  X as XIcon,
  FileDown,
  Command,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ───────────────────────────────────────────────────────────────────

type Blockchain = 'btc' | 'eth' | 'sol' | 'xrp'
type AppTab = 'recover' | 'verify' | 'history' | 'wordlist' | 'wallet'

interface RecoveryJob {
  id: string
  partialMnemonic: (string | null)[]
  knownAddress: string
  knownAddresses: string[]
  blockchain: Blockchain
  derivationPath: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  progress: number
  total: number
  speed: number
  result: string[] | null
  startedAt: number | null
  foundAt: number | null
  currentPathIndex?: number
  triedPaths?: string[]
  pathSwitchAt?: number
  autoRetry?: boolean
  validCombinationsEstimate?: number
  checksumFirst?: boolean
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

interface PersistedHistoryEntry {
  id: string
  blockchain: Blockchain
  derivationPath: string
  knownAddress: string
  found: boolean
  timestamp: number
}

interface DeriveResult {
  address: string
  blockchain: string
  derivationPath: string
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

function validateAddress(address: string, blockchain: Blockchain): { valid: boolean; hint: string } {
  const trimmed = address.trim()
  if (!trimmed) return { valid: false, hint: 'Address is required' }
  switch (blockchain) {
    case 'eth':
      if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return { valid: true, hint: 'Valid Ethereum address' }
      if (trimmed.startsWith('0x')) return { valid: false, hint: 'ETH addresses are 42 chars (0x + 40 hex)' }
      return { valid: false, hint: 'ETH addresses start with 0x' }
    case 'btc':
      if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return { valid: true, hint: 'Valid Legacy/SegWit address' }
      if (/^bc1[a-zA-HJ-NP-Z0-9]{25,90}$/.test(trimmed)) return { valid: true, hint: 'Valid Native SegWit address' }
      return { valid: false, hint: 'BTC addresses start with 1, 3, or bc1' }
    case 'sol':
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return { valid: true, hint: 'Valid Solana address' }
      return { valid: false, hint: 'SOL addresses are Base58, 32-44 chars' }
    case 'xrp':
      if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(trimmed)) return { valid: true, hint: 'Valid XRP address' }
      return { valid: false, hint: 'XRP addresses start with r, 25-35 chars' }
    default:
      return { valid: false, hint: 'Unknown blockchain' }
  }
}

const SUPPORTED_WALLETS: Record<Blockchain, { name: string; icon: string }[]> = {
  btc: [
    { name: 'Electrum', icon: '⚡' },
    { name: 'Ledger', icon: '🔐' },
    { name: 'Trezor', icon: '🛡' },
    { name: 'Wasabi', icon: '🟢' },
  ],
  eth: [
    { name: 'MetaMask', icon: '🦊' },
    { name: 'Trust Wallet', icon: '🛡' },
    { name: 'Ledger', icon: '🔐' },
    { name: 'MyEtherWallet', icon: '💎' },
  ],
  sol: [
    { name: 'Phantom', icon: '👻' },
    { name: 'Solflare', icon: '☀' },
    { name: 'Ledger', icon: '🔐' },
  ],
  xrp: [
    { name: 'Xumm', icon: '✕' },
    { name: 'Ledger', icon: '🔐' },
    { name: 'Trust Wallet', icon: '🛡' },
  ],
}

const BLOCKCHAIN_CONFIG: Record<
  Blockchain,
  { name: string; symbol: string; icon: string; color: string; accent: string; accentBg: string; placeholder: string; hint: string; paths: PathOption[] }
> = {
  btc: {
    name: 'Bitcoin',
    symbol: 'BTC',
    icon: '₿',
    color: 'orange',
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
    color: 'emerald',
    accent: 'text-emerald-400',
    accentBg: 'bg-emerald-500/10 border-emerald-500/30',
    placeholder: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38...',
    hint: 'Starts with 0x, 42 characters',
    paths: [
      { label: 'Standard (MetaMask)', path: "m/44'/60'/0'/0/0" },
      { label: 'Ledger Live (Acct 1)', path: "m/44'/60'/1'/0/0" },
      { label: 'Second Address', path: "m/44'/60'/0'/0/1" },
    ],
  },
  sol: {
    name: 'Solana',
    symbol: 'SOL',
    icon: '◎',
    color: 'cyan',
    accent: 'text-cyan-400',
    accentBg: 'bg-cyan-500/10 border-cyan-500/30',
    placeholder: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU...',
    hint: 'Base58 encoded, 32-44 characters',
    paths: [
      { label: 'Standard (BIP44)', path: "m/44'/501'/0'/0'" },
      { label: 'Solflare/Phantom (Deprecated)', path: "m/501'/0'/0'" },
    ],
  },
  xrp: {
    name: 'XRP',
    symbol: 'XRP',
    icon: '✕',
    color: 'teal',
    accent: 'text-teal-400',
    accentBg: 'bg-teal-500/10 border-teal-500/30',
    placeholder: 'rN7n3473SaZBCG4dFL83w7w1g2h2h4kQ7V...',
    hint: 'Starts with r, 25-35 characters',
    paths: [
      { label: 'Standard', path: "m/44'/144'/0'/0/0" },
    ],
  },
}

// ─── Wallet Presets ─────────────────────────────────────────────────────────

const WALLET_PRESETS: { name: string; icon: string; blockchain: Blockchain; path: string }[] = [
  { name: 'MetaMask', icon: '🦊', blockchain: 'eth', path: "m/44'/60'/0'/0/0" },
  { name: 'Ledger', icon: '🔐', blockchain: 'btc', path: "m/84'/0'/0'/0/0" },
  { name: 'Phantom', icon: '👻', blockchain: 'sol', path: "m/44'/501'/0'/0'" },
  { name: 'Electrum', icon: '⚡', blockchain: 'btc', path: "m/44'/0'/0'/0/0" },
]

// ─── Autocomplete Component ──────────────────────────────────────────────────

function WordInput({
  index,
  value,
  isUnknown,
  onValueChange,
  onToggleUnknown,
  wordlist,
  onNext,
}: {
  index: number
  value: string
  isUnknown: boolean
  onValueChange: (val: string) => void
  onToggleUnknown: () => void
  wordlist: string[]
  onNext?: () => void
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

  const isValidWord = value && wordlist.includes(value.toLowerCase())

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
    if (showDropdown) {
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
        onNext?.()
      } else if (e.key === 'Escape') {
        setDropdownOpen(false)
      }
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (isValidWord) {
        e.preventDefault()
        onNext?.()
      }
    }
  }

  function selectWord(word: string) {
    onValueChange(word)
    setDropdownOpen(false)
    setTimeout(() => onNext?.(), 50)
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <span
            className={`absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold pointer-events-none z-10 transition-colors ${
              isUnknown ? 'text-amber-500' : isValidWord ? 'text-emerald-500/70' : 'text-zinc-500'
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
            className={`h-11 pl-7 pr-2 text-sm font-mono transition-all duration-200 rounded-lg ${
              isUnknown
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 placeholder:text-amber-500/50 shadow-inner shadow-amber-500/5'
                : isValidWord
                  ? 'bg-zinc-900/80 border-emerald-500/40 text-emerald-300 placeholder:text-zinc-600 shadow-inner shadow-emerald-500/5'
                  : 'bg-zinc-900/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-emerald-500/20'
            }`}
          />
          {isValidWord && !isUnknown && (
            <Check className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-500/60" />
          )}
        </div>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-11 w-11 shrink-0 transition-all duration-200 rounded-lg ${
                  isUnknown
                    ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/30'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
                onClick={onToggleUnknown}
              >
                {isUnknown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {isUnknown ? 'Mark as known' : 'Mark as unknown'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Autocomplete Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 top-full mt-1 w-full bg-zinc-800/95 backdrop-blur-sm border border-zinc-700 rounded-lg shadow-xl shadow-black/40 overflow-hidden"
        >
          {filtered.map((word, i) => (
            <button
              key={word}
              className={`w-full text-left px-3 py-1.5 text-sm font-mono transition-colors flex items-center gap-2 ${
                i === highlightIndex
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-zinc-300 hover:bg-zinc-700/80'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                selectWord(word)
              }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <span className="text-emerald-400/40 text-[10px] font-bold w-4">{i + 1}</span>
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
    <div className="border border-zinc-800/60 rounded-xl overflow-hidden transition-colors hover:border-zinc-700/80">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-zinc-900/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-medium text-zinc-300">{question}</span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-5 pb-4 text-xs text-zinc-500 leading-relaxed">
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
  const { theme, setTheme } = useTheme()
  // ── State ──
  const [wordCount, setWordCount] = useState<12 | 24>(12)
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
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

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

  // Persisted history state
  const STORAGE_KEY = 'cryptorecover-history'
  const [persistedHistory, setPersistedHistory] = useState<PersistedHistoryEntry[]>([])

  // Derive preview state
  const [deriveResult, setDeriveResult] = useState<DeriveResult | null>(null)
  const [isDeriving, setIsDeriving] = useState(false)

  // Confetti state
  const [showConfetti, setShowConfetti] = useState(false)

  // Paste dialog state
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [pasteText, setPasteText] = useState('')

  // Auto-retry state
  const [autoRetry, setAutoRetry] = useState(true)

  // Multi-address verification state
  const [additionalAddresses, setAdditionalAddresses] = useState<string[]>([])

  // Checksum-first (priority mode) state
  const [checksumFirst, setChecksumFirst] = useState(false)

  // Keyboard shortcuts dialog state
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)

  // Live elapsed timer state
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0)

  // Searching dots animation state
  const [searchingDots, setSearchingDots] = useState(0)

  // Word list tab state
  const [wordlistSearch, setWordlistSearch] = useState('')
  const [wordlistCopiedIdx, setWordlistCopiedIdx] = useState<number | null>(null)

  // Recovery event log state
  const [recoveryLog, setRecoveryLog] = useState<{ time: number; msg: string }[]>([])
  const recoveryLogRef = useRef<HTMLDivElement>(null)

  // Batch derive state
  const [batchDeriveResults, setBatchDeriveResults] = useState<{ path: string; label: string; address: string }[]>([])
  const [isBatchDeriving, setIsBatchDeriving] = useState(false)

  // Track previous path index for path switch notification
  const prevPathIndexRef = useRef<number | undefined>(undefined)

  // Wallet generator state
  const [walletWordCount, setWalletWordCount] = useState<12 | 24>(12)
  const [generatedMnemonic, setGeneratedMnemonic] = useState('')
  const [derivedAddresses, setDerivedAddresses] = useState<{ blockchain: Blockchain; label: string; derivationPath: string; address: string; privateKey: string }[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [visiblePrivateKeys, setVisiblePrivateKeys] = useState<Set<number>>(new Set())
  const [walletBalances, setWalletBalances] = useState<Record<string, { balance: string; symbol: string; error?: string }>>({})
  const [isCheckingBalances, setIsCheckingBalances] = useState(false)
  const [autoScanActive, setAutoScanActive] = useState(false)
  const [autoScanCount, setAutoScanCount] = useState(0)
  const [autoScanFound, setAutoScanFound] = useState<{ mnemonic: string; address: string; blockchain: Blockchain; balance: string }[]>([])
  const [showPrivateKeyWarning, setShowPrivateKeyWarning] = useState(false)
  const autoScanRef = useRef(false)
  const [walletsGenerated, setWalletsGenerated] = useState(0)
  const [lastGeneratedAt, setLastGeneratedAt] = useState<number | null>(null)
  const [autoScanStartTime, setAutoScanStartTime] = useState<number | null>(null)
  const [autoScanElapsed, setAutoScanElapsed] = useState(0)
  // Wallet import state
  const [walletMode, setWalletMode] = useState<'generate' | 'import'>('generate')
  const [importMnemonic, setImportMnemonic] = useState('')
  const [importError, setImportError] = useState('')

  // High-speed scan state
  const [scanJobId, setScanJobId] = useState<string | null>(null)
  const [scanStatus, setScanStatus] = useState<{
    status: string; scanned: number; speed: number; found: { mnemonic: string; addresses: { blockchain: Blockchain; address: string; balance: string; symbol: string }[]; foundAt: number }[];
    foundCount: number; elapsed: number; wordCount: number; chains: Blockchain[]; checkBalance: boolean; mode?: string; balanceCheckPercent?: number;
    speedHistory?: { time: number; scanned: number }[]; error?: string;
  } | null>(null)
  const [scanMode, setScanMode] = useState<'fast' | 'balanced' | 'full'>('balanced')
  const [scanChains, setScanChains] = useState<Blockchain[]>(['eth', 'btc', 'sol', 'xrp'])
  const [scanBalancePercent, setScanBalancePercent] = useState(10)
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Count-up animation for stats ──
  const [countUpDone, setCountUpDone] = useState(false)
  const [countUpValues, setCountUpValues] = useState({ blockchains: 0, words: 0, paths: 0 })
  useEffect(() => {
    const targets = { blockchains: 4, words: 2048, paths: 9 }
    const duration = 1500
    const steps = 60
    const interval = duration / steps
    let step = 0
    const timer = setInterval(() => {
      step++
      const t = step / steps
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)
      setCountUpValues({
        blockchains: Math.round(targets.blockchains * ease),
        words: Math.round(targets.words * ease),
        paths: Math.round(targets.paths * ease),
      })
      if (step >= steps) {
        clearInterval(timer)
        setCountUpValues(targets)
        setCountUpDone(true)
      }
    }, interval)
    return () => clearInterval(timer)
  }, [])

  // ── Success sound via Web Audio API ──
  const playSuccessSound = useCallback(() => {
    try {
      if (typeof window === 'undefined') return
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReduced) return
      const ctx = new AudioContext()
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      osc1.type = 'sine'
      osc2.type = 'sine'
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime) // C5
      osc1.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15) // E5
      osc1.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3) // G5
      osc2.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3) // G5
      osc2.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.45) // C6
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.3)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(ctx.destination)
      osc1.start(ctx.currentTime)
      osc2.start(ctx.currentTime + 0.3)
      osc1.stop(ctx.currentTime + 0.6)
      osc2.stop(ctx.currentTime + 0.8)
    } catch {
      // Web Audio not available, silently skip
    }
  }, [])

  // Results ref for auto-scroll
  const resultsRef = useRef<HTMLDivElement>(null)

  // ── Address validation ──
  const addressValidation = useMemo(() => {
    if (!knownAddress.trim()) return null
    return validateAddress(knownAddress, blockchain)
  }, [knownAddress, blockchain])

  const verifyAddressValidation = useMemo(() => {
    if (!verifyAddress.trim()) return null
    return validateAddress(verifyAddress, verifyBlockchain)
  }, [verifyAddress, verifyBlockchain])

  // ── Fetch wordlist ──
  useEffect(() => {
    fetch('/api/wordlist')
      .then((r) => r.json())
      .then((data) => setWordlist(data.words || []))
      .catch(() => console.error('Failed to fetch wordlist'))
  }, [])

  // ── Load persisted history on mount ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) setPersistedHistory(parsed)
      }
    } catch {
      // ignore
    }
  }, [])

  // ── Save to localStorage when a job completes ──
  useEffect(() => {
    if (jobStatus && (jobStatus.status === 'completed' || jobStatus.status === 'stopped') && jobStatus.result) {
      const entry: PersistedHistoryEntry = {
        id: jobStatus.id,
        blockchain: jobStatus.blockchain,
        derivationPath: jobStatus.derivationPath,
        knownAddress: jobStatus.knownAddress,
        found: jobStatus.result.length > 0,
        timestamp: Date.now(),
      }
      setPersistedHistory(prev => {
        const next = [entry, ...prev.filter(e => e.id !== entry.id)].slice(0, 50)
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    }
  }, [jobStatus, STORAGE_KEY])

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
    return total / 1000
  }, [unknownCount])

  // ── Confetti, sound, and auto-scroll on success ──
  useEffect(() => {
    if (isCompleted && jobStatus && jobStatus.result && jobStatus.result.length > 0) {
      setShowConfetti(true)
      playSuccessSound()
      setTimeout(() => setShowConfetti(false), 3000)
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300)
    }
  }, [isCompleted, jobStatus])

  // ── Live elapsed timer ──
  useEffect(() => {
    if (isRunning && jobStatus?.startedAt) {
      const interval = setInterval(() => {
        setLiveElapsedSeconds((Date.now() - jobStatus.startedAt!) / 1000)
      }, 1000)
      return () => clearInterval(interval)
    } else {
      setLiveElapsedSeconds(elapsedSeconds)
    }
  }, [isRunning, jobStatus?.startedAt, elapsedSeconds])

  // ── Searching dots animation ──
  useEffect(() => {
    if (isRunning) {
      const interval = setInterval(() => {
        setSearchingDots((d) => (d + 1) % 4)
      }, 500)
      return () => clearInterval(interval)
    }
    setSearchingDots(0)
  }, [isRunning])

  // ── Path switch toast notification ──
  useEffect(() => {
    if (jobStatus?.autoRetry && jobStatus.currentPathIndex !== undefined && isRunning) {
      if (prevPathIndexRef.current !== undefined && prevPathIndexRef.current !== jobStatus.currentPathIndex) {
        const paths = BLOCKCHAIN_CONFIG[jobStatus.blockchain]?.paths || []
        const prevPath = paths[prevPathIndexRef.current]
        const nextPath = paths[jobStatus.currentPathIndex]
        if (prevPath && nextPath) {
          toast.info(`No match on ${prevPath.label}, trying ${nextPath.label}...`, {
            description: `Switching derivation path (${jobStatus.currentPathIndex + 1} of ${paths.length})`,
          })
        }
      }
      prevPathIndexRef.current = jobStatus.currentPathIndex
    }
  }, [jobStatus?.currentPathIndex, jobStatus?.autoRetry, jobStatus?.blockchain, isRunning])

  // ── Recovery event log ──
  useEffect(() => {
    if (jobStatus && isRunning) {
      const now = Date.now()
      setRecoveryLog(prev => {
        const last = prev[prev.length - 1]
        // Deduplicate rapid same-message logs
        const msg = `Checked ${formatNumber(jobStatus.progress)}/${formatNumber(jobStatus.total)} combos · ${formatNumber(jobStatus.speed)}/s`
        if (last && last.msg === msg && now - last.time < 2000) return prev
        return [...prev, { time: now, msg }]
      })
    }
    if (isCompleted && jobStatus) {
      if (jobStatus.result && jobStatus.result.length > 0) {
        setRecoveryLog(prev => [...prev, { time: Date.now(), msg: 'Match found! Recovery successful.' }])
      } else {
        setRecoveryLog(prev => [...prev, { time: Date.now(), msg: 'Search complete. No match found.' }])
      }
    }
  }, [jobStatus?.progress, isCompleted])

  // ── Auto-scroll recovery log ──
  useEffect(() => {
    if (recoveryLog.length > 0) {
      recoveryLogRef.current?.scrollTo({ top: recoveryLogRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [recoveryLog.length])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+1/2/3/4 to switch tabs
      if (e.ctrlKey && e.key === '1') {
        e.preventDefault()
        setActiveTab('recover')
      } else if (e.ctrlKey && e.key === '2') {
        e.preventDefault()
        setActiveTab('verify')
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault()
        setActiveTab('history')
      } else if (e.ctrlKey && e.key === '4') {
        e.preventDefault()
        setActiveTab('wordlist')
      } else if (e.ctrlKey && e.key === '5') {
        e.preventDefault()
        setActiveTab('wallet')
      }
      // Ctrl+Enter to start recovery (when on Recovery tab)
      if (e.ctrlKey && e.key === 'Enter' && activeTab === 'recover') {
        e.preventDefault()
        if (!isRunning && !isCompleted && !isFailed && !isStopped) {
          handleStartRecovery()
        }
      }
      // Ctrl+Shift+V to open paste dialog (when on Recovery tab)
      if (e.ctrlKey && e.shiftKey && e.key === 'V' && activeTab === 'recover') {
        e.preventDefault()
        if (!isRunning) setShowPasteDialog(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, isRunning, isCompleted, isFailed, isStopped])

  // ── Batch derive handler ──
  const handleBatchDerive = async () => {
    if (!verifyMnemonic.trim()) {
      toast.error('Seed phrase is required')
      return
    }
    setIsBatchDeriving(true)
    setBatchDeriveResults([])
    const paths = BLOCKCHAIN_CONFIG[verifyBlockchain].paths
    const results: { path: string; label: string; address: string }[] = []
    for (const p of paths) {
      try {
        const res = await fetch('/api/derive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mnemonic: verifyMnemonic.trim(), blockchain: verifyBlockchain, derivationPath: p.path }),
        })
        const data = await res.json()
        if (res.ok && data.address) {
          results.push({ path: p.path, label: p.label, address: data.address })
        }
      } catch {
        // skip failed derivations
      }
    }
    setBatchDeriveResults(results)
    setIsBatchDeriving(false)
    if (results.length > 0) {
      toast.success(`Derived ${results.length} addresses across all paths`)
    }
  }

  // Check if all words are valid BIP39 words
  const allWordsValid = useMemo(() => {
    if (wordlist.length === 0) return false
    return words.every((w) => w === null || (w && w.length > 0 && wordlist.includes(w)))
  }, [words, wordlist])

  // Count filled valid words
  const validWordCount = useMemo(() => {
    if (wordlist.length === 0) return 0
    return words.filter((w) => w !== null && w.length > 0 && wordlist.includes(w)).length
  }, [words, wordlist])

  // ── Seed phrase strength analysis ──
  const strengthInfo = useMemo(() => {
    const minKnown = wordCount === 12 ? 8 : 16
    if (knownCount < minKnown) {
      return { level: 'weak', color: 'red', label: 'Too Few Words', description: `Need at least ${minKnown} known words`, pct: (knownCount / minKnown) * 50 }
    }
    if (wordCount === 12) {
      if (knownCount <= 9) return { level: 'low', color: 'red', label: 'Low', description: 'Recovery likelihood: Low', pct: 30 }
      if (knownCount === 10) return { level: 'moderate', color: 'amber', label: 'Moderate', description: 'Recovery likelihood: Moderate', pct: 55 }
      if (knownCount === 11) return { level: 'high', color: 'green', label: 'High', description: 'Recovery likelihood: High', pct: 80 }
      return { level: 'complete', color: 'green', label: 'Complete', description: 'All words known', pct: 100 }
    } else {
      // 24-word
      if (knownCount <= 18) return { level: 'low', color: 'red', label: 'Low', description: 'Recovery likelihood: Low', pct: 30 }
      if (knownCount <= 20) return { level: 'moderate', color: 'amber', label: 'Moderate', description: 'Recovery likelihood: Moderate', pct: 55 }
      if (knownCount <= 22) return { level: 'high', color: 'green', label: 'High', description: 'Recovery likelihood: High', pct: 80 }
      return { level: 'complete', color: 'green', label: 'Complete', description: 'All words known', pct: 100 }
    }
  }, [knownCount, wordCount])

  // Derive preview handler
  const handleDerivePreview = async () => {
    if (!verifyMnemonic.trim()) {
      toast.error('Seed phrase is required')
      return
    }
    setIsDeriving(true)
    setDeriveResult(null)
    try {
      const res = await fetch('/api/derive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mnemonic: verifyMnemonic.trim(),
          blockchain: verifyBlockchain,
          derivationPath,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Derivation failed')
        return
      }
      setDeriveResult(data)
    } catch {
      toast.error('Network error')
    } finally {
      setIsDeriving(false)
    }
  }

  // ── Handlers ──
  const handleWordCountChange = useCallback((count: 12 | 24) => {
    setWordCount(count)
    const newWords = Array(count).fill('')
    const newInputValues = Array(count).fill('')
    // Preserve existing values
    const minLen = Math.min(words.length, count)
    for (let i = 0; i < minLen; i++) {
      newWords[i] = words[i]
      newInputValues[i] = inputValues[i]
    }
    setWords(newWords)
    setInputValues(newInputValues)
  }, [words, inputValues])

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

  const focusNextInput = useCallback((currentIndex: number) => {
    const nextIndex = currentIndex + 1
    if (nextIndex < wordCount) {
      inputRefs.current[nextIndex]?.focus()
    }
  }, [wordCount])

  const handleStartRecovery = async () => {
    const minKnown = wordCount === 12 ? 8 : 16
    if (knownCount < minKnown) {
      toast.error(`At least ${minKnown} known words required`, {
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
    if (addressValidation && !addressValidation.valid) {
      toast.error('Invalid wallet address format', {
        description: addressValidation.hint,
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

    for (let i = 0; i < wordCount; i++) {
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
      const autoRetryParam = autoRetry && BLOCKCHAIN_CONFIG[blockchain].paths.length > 1 ? '?autoRetry=true' : ''
      const allAddresses = [knownAddress.trim(), ...additionalAddresses.map(a => a.trim()).filter(a => a.length > 0)]
      const res = await fetch(`/api/recover${autoRetryParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partialMnemonic,
          knownAddress: knownAddress.trim(),
          knownAddresses: allAddresses.length > 1 ? allAddresses : undefined,
          blockchain,
          derivationPath,
          checksumFirst,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to start recovery')
        return
      }
      setJobId(data.jobId)
      setJobStatus(null)
      prevPathIndexRef.current = undefined
      toast.success('Recovery job started!', {
        description: autoRetry && BLOCKCHAIN_CONFIG[blockchain].paths.length > 1
          ? 'Searching for your wallet (auto-retry enabled)...'
          : 'Searching for your wallet...',
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
    setWords(Array(wordCount).fill(''))
    setInputValues(Array(wordCount).fill(''))
    setKnownAddress('')
    setAdditionalAddresses([])
    setJobId(null)
    setJobStatus(null)
    setCopied(false)
    setShowEstimateWarning(false)
    setShowConfetti(false)
    setRecoveryLog([])
  }

  const handleClearPersistedHistory = () => {
    setPersistedHistory([])
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    toast.success('History cleared')
  }

  const handlePasteSeedPhrase = () => {
    if (!pasteText.trim()) {
      toast.error('Please paste a seed phrase first')
      return
    }

    // Parse the pasted text: split by spaces/newlines, trim, lowercase
    const parsedWords = pasteText
      .trim()
      .split(/[\s\n]+/)
      .map((w: string) => w.trim().toLowerCase())
      .filter((w: string) => w.length > 0)

    if (parsedWords.length === 0) {
      toast.error('No words found in the pasted text')
      return
    }

    if (parsedWords.length !== 12 && parsedWords.length !== 24) {
      toast.error(`Expected 12 or 24 words, but found ${parsedWords.length}`, {
        description: 'Seed phrases must be exactly 12 or 24 words.',
      })
      return
    }

    // Auto-switch word count if needed
    const targetCount = parsedWords.length as 12 | 24
    if (targetCount !== wordCount) {
      setWordCount(targetCount)
    }

    // Fill the words array - mark non-BIP39 words as unknown (null)
    let recognized = 0
    let unrecognized = 0
    const newWords: (string | null)[] = Array(targetCount).fill('')
    const newInputValues: string[] = Array(targetCount).fill('')

    for (let i = 0; i < targetCount; i++) {
      const word = parsedWords[i] || ''
      if (wordlist.length > 0 && wordlist.includes(word)) {
        newWords[i] = word
        newInputValues[i] = word
        recognized++
      } else if (word) {
        // Not in BIP39 wordlist - mark as unknown
        newWords[i] = null
        newInputValues[i] = word
        unrecognized++
      }
    }

    setWords(newWords)
    setInputValues(newInputValues)
    setShowPasteDialog(false)
    setPasteText('')

    if (unrecognized > 0) {
      toast.success(`Pasted ${parsedWords.length} words`, {
        description: `${recognized} recognized, ${unrecognized} unrecognized (marked as unknown)`,
      })
    } else {
      toast.success(`Pasted ${parsedWords.length} words`, {
        description: 'All words recognized from BIP39 wordlist',
      })
    }
  }

  const handleCopyResult = () => {
    if (jobStatus?.result && jobStatus.result.length > 0) {
      navigator.clipboard.writeText(jobStatus.result[0])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Seed phrase copied to clipboard')
    }
  }

  const handleExportHistory = (format: 'json' | 'csv') => {
    // Combine persisted history and session jobs
    const entries = [
      ...persistedHistory.map(e => ({
        date: new Date(e.timestamp).toISOString(),
        blockchain: BLOCKCHAIN_CONFIG[e.blockchain]?.name || e.blockchain,
        derivationPath: e.derivationPath,
        address: e.knownAddress,
        status: e.found ? 'Found' : 'No Match',
        found: e.found,
      })),
      ...jobHistory
        .filter(j => j.status === 'completed' || j.status === 'stopped')
        .map(j => ({
          date: j.startedAt ? new Date(j.startedAt).toISOString() : '',
          blockchain: BLOCKCHAIN_CONFIG[j.blockchain]?.name || j.blockchain,
          derivationPath: j.derivationPath,
          address: j.knownAddress,
          status: j.result && j.result.length > 0 ? 'Found' : 'No Match',
          found: !!(j.result && j.result.length > 0),
        })),
    ]

    if (entries.length === 0) {
      toast.error('No history to export')
      return
    }

    let content: string
    let filename: string
    let mimeType: string

    if (format === 'csv') {
      const header = 'Date,Blockchain,Derivation Path,Address,Status,Found'
      const rows = entries.map(e =>
        `${e.date},${e.blockchain},"${e.derivationPath}","${e.address}",${e.status},${e.found}`
      )
      content = [header, ...rows].join('\n')
      filename = `cryptorecover-history-${Date.now()}.csv`
      mimeType = 'text/csv'
    } else {
      content = JSON.stringify(entries, null, 2)
      filename = `cryptorecover-history-${Date.now()}.json`
      mimeType = 'application/json'
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`History exported as ${format.toUpperCase()}`)
  }

  const handleExportResult = () => {
    if (jobStatus?.result && jobStatus.result.length > 0) {
      const result = jobStatus.result[0]
      const content = [
        'CryptoRecover - Recovery Result',
        '================================',
        `Date: ${new Date().toISOString()}`,
        `Blockchain: ${BLOCKCHAIN_CONFIG[blockchain].name}`,
        `Derivation Path: ${derivationPath}`,
        `Wallet Address: ${knownAddress}`,
        '',
        'Recovered Seed Phrase:',
        result,
        '',
        'IMPORTANT: Store this securely and delete this file after use.',
        'This file was generated by CryptoRecover for legitimate self-recovery only.',
      ].join('\n')
      
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cryptorecover-${blockchain}-${Date.now()}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Recovery result exported')
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
    if (verifyAddressValidation && !verifyAddressValidation.valid) {
      toast.error('Invalid wallet address format', {
        description: verifyAddressValidation.hint,
      })
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

  // ── Wallet Generator Handlers ──
  const handleGenerateWallet = async () => {
    setIsGenerating(true)
    setDerivedAddresses([])
    setWalletBalances({})
    try {
      const res = await fetch('/api/wallet/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordCount: walletWordCount }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to generate wallet')
        return
      }
      setGeneratedMnemonic(data.mnemonic)
      setWalletsGenerated(prev => prev + 1)
      setLastGeneratedAt(Date.now())
      // Derive addresses
      const deriveRes = await fetch('/api/wallet/derive-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mnemonic: data.mnemonic }),
      })
      const deriveData = await deriveRes.json()
      if (deriveRes.ok && deriveData.addresses) {
        setDerivedAddresses(deriveData.addresses)
        toast.success(`Wallet generated! ${deriveData.addresses.length} addresses derived`)
      }
    } catch {
      toast.error('Network error')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleImportWallet = async () => {
    const mnemonic = importMnemonic.trim().toLowerCase()
    if (!mnemonic) {
      toast.error('Please enter a seed phrase')
      return
    }
    const words = mnemonic.split(/\s+/)
    if (words.length !== 12 && words.length !== 24) {
      toast.error('Seed phrase must be 12 or 24 words', {
        description: `You entered ${words.length} words.`,
      })
      return
    }
    // Check all words are in BIP39 wordlist
    if (wordlist.length > 0) {
      const invalidWords = words.filter(w => !wordlist.includes(w))
      if (invalidWords.length > 0) {
        setImportError(`Invalid BIP39 words: ${invalidWords.slice(0, 3).join(', ')}${invalidWords.length > 3 ? '...' : ''}`)
        toast.error('Some words are not in the BIP39 wordlist', {
          description: `Found ${invalidWords.length} invalid word(s)`,
        })
        return
      }
    }
    setImportError('')
    setIsGenerating(true)
    setDerivedAddresses([])
    setWalletBalances({})
    try {
      const deriveRes = await fetch('/api/wallet/derive-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mnemonic }),
      })
      const deriveData = await deriveRes.json()
      if (!deriveRes.ok) {
        toast.error(deriveData.error || 'Invalid seed phrase')
        setImportError(deriveData.error || 'Invalid seed phrase checksum')
        return
      }
      setGeneratedMnemonic(mnemonic)
      setDerivedAddresses(deriveData.addresses)
      setWalletsGenerated(prev => prev + 1)
      setLastGeneratedAt(Date.now())
      toast.success(`Wallet imported! ${deriveData.addresses.length} addresses derived`)
      // Auto-check balances
      setIsCheckingBalances(true)
      const newBalances: Record<string, { balance: string; symbol: string; error?: string }> = {}
      for (const addr of deriveData.addresses) {
        try {
          const res = await fetch('/api/wallet/balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr.address, blockchain: addr.blockchain }),
          })
          const data = await res.json()
          newBalances[addr.address] = { balance: data.balance, symbol: data.symbol, error: data.error }
        } catch {
          newBalances[addr.address] = { balance: '0', symbol: '', error: 'Network error' }
        }
      }
      setWalletBalances(newBalances)
      setIsCheckingBalances(false)
      toast.success('Balance check complete')
    } catch {
      toast.error('Network error')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCheckBalances = async () => {
    if (derivedAddresses.length === 0) return
    setIsCheckingBalances(true)
    const newBalances: Record<string, { balance: string; symbol: string; error?: string }> = {}
    for (const addr of derivedAddresses) {
      try {
        const res = await fetch('/api/wallet/balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr.address, blockchain: addr.blockchain }),
        })
        const data = await res.json()
        newBalances[addr.address] = { balance: data.balance, symbol: data.symbol, error: data.error }
      } catch {
        newBalances[addr.address] = { balance: '0', symbol: '', error: 'Network error' }
      }
    }
    setWalletBalances(newBalances)
    setIsCheckingBalances(false)
    toast.success('Balance check complete')
  }

  const handleTogglePrivateKey = (index: number) => {
    setVisiblePrivateKeys(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleCopyMnemonic = () => {
    if (generatedMnemonic) {
      navigator.clipboard.writeText(generatedMnemonic)
      toast.success('Seed phrase copied to clipboard')
    }
  }

  const handleCopyAddress = (address: string) => {
    navigator.clipboard.writeText(address)
    toast.success('Address copied to clipboard')
  }

  const handleCopyPrivateKey = (key: string) => {
    navigator.clipboard.writeText(key)
    toast.success('Private key copied to clipboard')
  }

  const handleRecoverWallet = (targetBlockchain: Blockchain) => {
    if (!generatedMnemonic) return
    // Fill the seed phrase into the Recovery tab
    const mnemonicWords = generatedMnemonic.trim().split(/\s+/)
    const targetCount = (mnemonicWords.length === 24 ? 24 : 12) as 12 | 24
    setWordCount(targetCount)
    const newWords: (string | null)[] = Array(targetCount).fill('')
    const newInputValues: string[] = Array(targetCount).fill('')
    for (let i = 0; i < Math.min(mnemonicWords.length, targetCount); i++) {
      newWords[i] = mnemonicWords[i].toLowerCase()
      newInputValues[i] = mnemonicWords[i].toLowerCase()
    }
    setWords(newWords)
    setInputValues(newInputValues)
    // Set blockchain selector
    setBlockchain(targetBlockchain)
    const paths = BLOCKCHAIN_CONFIG[targetBlockchain].paths
    if (paths.length > 0) {
      setDerivationPath(paths[0].path)
    }
    // Switch to Recovery tab
    setActiveTab('recover')
    toast.success('Seed phrase loaded into Recovery tab')
  }

  const handleCopyAllAddresses = () => {
    if (derivedAddresses.length === 0) return
    const lines = derivedAddresses.map(addr => {
      const chainConfig = BLOCKCHAIN_CONFIG[addr.blockchain as Blockchain]
      const balanceInfo = walletBalances[addr.address]
      const balanceStr = balanceInfo ? ` | Balance: ${balanceInfo.balance} ${balanceInfo.symbol}` : ''
      return `${chainConfig?.name || addr.blockchain} (${addr.label}): ${addr.address}${balanceStr}`
    })
    navigator.clipboard.writeText(lines.join('\n'))
    toast.success('All addresses copied to clipboard')
  }

  // Auto-scan: continuously generate wallets and check balances
  const handleAutoScan = async () => {
    if (autoScanActive) {
      autoScanRef.current = false
      setAutoScanActive(false)
      setAutoScanStartTime(null)
      toast.info('Auto-scan stopped')
      return
    }

    autoScanRef.current = true
    setAutoScanActive(true)
    setAutoScanFound([])
    setAutoScanCount(0)
    setAutoScanStartTime(Date.now())
    setAutoScanElapsed(0)
    toast.info('Auto-scan started! Generating wallets and checking balances...')

    let count = 0
    while (autoScanRef.current) {
      try {
        // Generate a new wallet
        const genRes = await fetch('/api/wallet/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wordCount: walletWordCount }),
        })
        const genData = await genRes.json()
        if (!genRes.ok || !genData.mnemonic) break

        // Derive addresses
        const deriveRes = await fetch('/api/wallet/derive-full', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mnemonic: genData.mnemonic }),
        })
        const deriveData = await deriveRes.json()
        if (!deriveRes.ok || !deriveData.addresses) continue

        count++
        setAutoScanCount(count)
        setGeneratedMnemonic(genData.mnemonic)
        setDerivedAddresses(deriveData.addresses)

        // Check balances for all derived addresses
        for (const addr of deriveData.addresses) {
          if (!autoScanRef.current) break
          try {
            const balRes = await fetch('/api/wallet/balance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: addr.address, blockchain: addr.blockchain }),
            })
            const balData = await balRes.json()
            const balance = parseFloat(balData.balance || '0')
            if (balance > 0) {
              setAutoScanFound(prev => [...prev, {
                mnemonic: genData.mnemonic,
                address: addr.address,
                blockchain: addr.blockchain,
                balance: balData.balance,
              }])
              toast.success(`Found funded wallet! ${balData.balance} ${balData.symbol} on ${addr.blockchain.toUpperCase()}`)
            }
            setWalletBalances(prev => ({
              ...prev,
              [addr.address]: { balance: balData.balance, symbol: balData.symbol, error: balData.error },
            }))
          } catch {
            // skip
          }
        }
      } catch {
        // Continue on error
        await new Promise(r => setTimeout(r, 1000))
      }
      // Small delay between wallets
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // ── Auto-scan elapsed timer ──
  useEffect(() => {
    if (autoScanActive && autoScanStartTime) {
      const interval = setInterval(() => {
        setAutoScanElapsed((Date.now() - autoScanStartTime) / 1000)
      }, 1000)
      return () => clearInterval(interval)
    } else {
      setAutoScanElapsed(0)
    }
  }, [autoScanActive, autoScanStartTime])

  // ── High-speed scan polling ──
  useEffect(() => {
    if (scanJobId && scanStatus?.status === 'running') {
      scanPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/wallet/scan?jobId=${scanJobId}`)
          const data = await res.json()
          if (res.ok) {
            setScanStatus(data)
            if (data.status !== 'running') {
              if (scanPollRef.current) clearInterval(scanPollRef.current)
            }
          }
        } catch {
          // ignore poll errors
        }
      }, 500)
    }
    return () => {
      if (scanPollRef.current) clearInterval(scanPollRef.current)
    }
  }, [scanJobId, scanStatus?.status])

  // ── High-speed scan handlers ──
  const handleStartScan = async () => {
    try {
      const res = await fetch('/api/wallet/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wordCount: walletWordCount,
          chains: scanChains,
          mode: scanMode,
          batchSize: scanMode === 'fast' ? 100 : scanMode === 'balanced' ? 50 : 25,
          balanceCheckPercent: scanBalancePercent,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to start scan')
        return
      }
      setScanJobId(data.jobId)
      setScanStatus(null)
      toast.success('High-speed scan started!', {
        description: `Mode: ${scanMode} | Chains: ${scanChains.map(c => c.toUpperCase()).join(', ')}`,
      })
    } catch {
      toast.error('Network error')
    }
  }

  const handleStopScan = async () => {
    if (!scanJobId) return
    try {
      await fetch(`/api/wallet/scan?jobId=${scanJobId}`, { method: 'PATCH' })
      if (scanPollRef.current) clearInterval(scanPollRef.current)
      // Final poll
      const res = await fetch(`/api/wallet/scan?jobId=${scanJobId}`)
      if (res.ok) setScanStatus(await res.json())
      toast.info('Scan stopped')
    } catch {
      toast.error('Failed to stop scan')
    }
  }

  const isScanRunning = scanStatus?.status === 'running'
  const scanSpeed = scanStatus?.speed ?? 0
  const scanScanned = scanStatus?.scanned ?? 0
  const scanFound = scanStatus?.found ?? []
  const scanElapsed = scanStatus?.elapsed ?? 0

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ── Background (Pure CSS, no DOM-heavy elements) ── */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden crypto-bg" />

      {/* ── Header ── */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 shadow-lg shadow-emerald-500/5">
            <Shield className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-tight">
              Crypto<span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">Recover</span>
            </h1>
            <p className="text-[9px] text-zinc-600 tracking-wider uppercase">Legitimate Wallet Recovery Tool</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  >
                    {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                    onClick={() => setShowShortcutsDialog(true)}
                  >
                    <Command className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Keyboard shortcuts
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Badge
              variant="outline"
              className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[9px] gap-1 h-6"
            >
              <Lock className="h-2.5 w-2.5" />
              Own-Wallet Only
            </Badge>
            <Badge
              variant="outline"
              className={`text-[9px] gap-1 h-6 ${
                wordlist.length > 0
                  ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10'
                  : 'border-zinc-700 text-zinc-500 bg-zinc-900'
              }`}
            >
              <Activity className="h-2.5 w-2.5" />
              {wordlist.length > 0 ? 'Online' : 'Loading...'}
            </Badge>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 w-full relative z-10">
        {/* ── Hero / How It Works ── */}
        <section>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-6"
          >
            {/* Animated badge above title */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-4"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-medium text-emerald-400">Secure &amp; Private Recovery</span>
            </motion.div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-zinc-100 via-emerald-200 to-zinc-100 bg-clip-text text-transparent animated-gradient-text">
              Recover Your Crypto Wallet
            </h2>
            <p className="text-sm text-zinc-500 mt-2 max-w-xl mx-auto">
              Lost some words from your seed phrase? Enter the ones you remember and we&apos;ll help you find the rest by matching against your known wallet address.
            </p>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                icon: <Key className="h-5 w-5 text-emerald-400" />,
                step: '01',
                badge: '①',
                title: 'Enter Partial Seed',
                desc: 'Input your seed phrase, marking unknown words with the eye toggle.',
                gradient: 'from-emerald-500/8 to-emerald-500/0',
                border: 'hover:border-emerald-500/20',
              },
              {
                icon: <Wallet className="h-5 w-5 text-cyan-400" />,
                step: '02',
                badge: '②',
                title: 'Provide Address',
                desc: 'Enter your known wallet address for verification against derived addresses.',
                gradient: 'from-cyan-500/8 to-cyan-500/0',
                border: 'hover:border-cyan-500/20',
              },
              {
                icon: <FileCheck className="h-5 w-5 text-teal-400" />,
                step: '03',
                badge: '③',
                title: 'Recover Wallet',
                desc: 'We brute-force unknown words and verify against your known address.',
                gradient: 'from-teal-500/8 to-teal-500/0',
                border: 'hover:border-teal-500/20',
              },
            ].map((item, idx) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 + 0.2, duration: 0.4 }}
              >
                <Card className={`bg-zinc-900/40 border-zinc-800/50 ${item.border} transition-all duration-300 py-4 relative overflow-hidden group card-lift`}>
                  <div className={`absolute inset-0 bg-gradient-to-b ${item.gradient} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                  <CardContent className="pt-0 flex flex-col items-center text-center gap-2 px-4 relative z-10">
                    <div className="flex items-center justify-center h-9 w-9 rounded-full bg-zinc-800/80 border border-zinc-700/80 shadow-inner shadow-white/5">
                      {item.icon}
                    </div>
                    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
                      Step {item.step}
                    </span>
                    <h3 className="font-semibold text-sm text-zinc-200 flex items-center gap-1.5">
                      <span className="text-emerald-400/60 text-xs">{item.badge}</span>
                      {item.title}
                    </h3>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Gradient divider between steps and content ── */}
        <div className="relative h-px">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
          <div className="absolute left-1/2 -translate-x-1/2 -top-1 h-2 w-2 rounded-full bg-emerald-500/40 border border-emerald-500/20" />
        </div>

        {/* ── Security Stats ── */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: <Globe className="h-3.5 w-3.5" />, label: 'Blockchains', value: countUpDone ? '4' : String(countUpValues.blockchains), accent: 'text-emerald-400', bgAccent: 'bg-emerald-500/5 border-emerald-500/10' },
              { icon: <Database className="h-3.5 w-3.5" />, label: 'BIP39 Words', value: countUpDone ? '2,048' : formatNumber(countUpValues.words), accent: 'text-cyan-400', bgAccent: 'bg-cyan-500/5 border-cyan-500/10' },
              { icon: <Cpu className="h-3.5 w-3.5" />, label: 'Derivation Paths', value: countUpDone ? '9' : String(countUpValues.paths), accent: 'text-teal-400', bgAccent: 'bg-teal-500/5 border-teal-500/10' },
              { icon: <Lock className="h-3.5 w-3.5" />, label: 'Data Stored', value: 'None', accent: 'text-amber-400', bgAccent: 'bg-amber-500/5 border-amber-500/10' },
            ].map((stat) => (
              <div key={stat.label} className={`flex items-center gap-2.5 ${stat.bgAccent} border rounded-lg px-3 py-2.5 transition-all duration-200 hover:scale-[1.02]`}>
                <div className={stat.accent}>{stat.icon}</div>
                <div>
                  <p className="text-xs font-semibold text-zinc-300">{stat.value}</p>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        <Separator className="bg-zinc-800/40" />

        {/* ── Supported Wallets ── */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Compatible Wallets</span>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-2.5 w-2.5 text-zinc-700" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-xs">
                  These are popular wallets that use standard derivation paths. Your wallet may still be supported even if not listed.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
            {SUPPORTED_WALLETS[blockchain].map((wallet) => (
              <span
                key={wallet.name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/40 border border-zinc-700/40 text-[10px] text-zinc-400 whitespace-nowrap hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-zinc-300 transition-all duration-200 cursor-default group"
              >
                <span className="text-sm group-hover:scale-110 transition-transform">{wallet.icon}</span>
                {wallet.name}
              </span>
            ))}
            <span className="text-[9px] text-zinc-600 ml-1 whitespace-nowrap italic">+more</span>
          </div>
        </motion.section>

        <Separator className="bg-zinc-800/40" />

        {/* ── Tab Navigation ── */}
        <div className="flex gap-1 bg-muted/40 p-1 rounded-xl border border-border/50">
          {([
            { id: 'recover' as AppTab, label: 'Recovery', icon: <Search className="h-3.5 w-3.5" /> },
            { id: 'verify' as AppTab, label: 'Quick Verify', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
            { id: 'history' as AppTab, label: 'History', icon: <History className="h-3.5 w-3.5" /> },
            { id: 'wordlist' as AppTab, label: 'Word List', icon: <BookOpen className="h-3.5 w-3.5" /> },
            { id: 'wallet' as AppTab, label: 'Wallet', icon: <Wallet className="h-3.5 w-3.5" /> },
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
              className="space-y-5"
            >
              {/* ── Seed Phrase Input ── */}
              <Card className={`bg-zinc-900/40 border-zinc-800/50 overflow-hidden transition-all duration-500 ${
                isRunning
                  ? 'recovery-gradient-border'
                  : allWordsValid && validWordCount === wordCount
                    ? 'border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                    : ''
              }`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400/60 text-xs font-bold">①</span>
                    <Key className="h-4 w-4 text-emerald-400" />
                    <CardTitle className="text-base font-semibold">Seed Phrase</CardTitle>
                    <div className="ml-auto flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[9px] gap-1 h-5 transition-colors ${
                          knownCount >= (wordCount === 12 ? 8 : 16)
                            ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                            : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                        }`}
                      >
                        {knownCount >= (wordCount === 12 ? 8 : 16) ? (
                          <span className="checkmark-pop"><CheckCircle2 className="h-2.5 w-2.5" /></span>
                        ) : (
                          <Check className="h-2.5 w-2.5" />
                        )}
                        {knownCount} known
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[9px] gap-1 h-5 ${
                          unknownCount > 0
                            ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                            : 'border-zinc-700 text-zinc-500 bg-zinc-900'
                        }`}
                      >
                        <EyeOff className="h-2.5 w-2.5" />
                        {unknownCount} unknown
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardDescription className="text-xs text-zinc-500">
                      Enter the words you remember. Click the eye icon to mark unknown words.
                    </CardDescription>
                    <div className="flex items-center gap-3">
                      {/* Paste button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[10px] gap-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-cyan-500/20 px-2.5"
                        onClick={() => setShowPasteDialog(true)}
                      >
                        <ClipboardPaste className="h-3 w-3" />
                        Paste
                      </Button>
                      {/* Word count toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-600">12</span>
                        <Switch
                          checked={wordCount === 24}
                          onCheckedChange={(checked) => handleWordCountChange(checked ? 24 : 12)}
                          className="scale-75"
                        />
                        <span className="text-[10px] text-zinc-600">24</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {knownCount < (wordCount === 12 ? 8 : 16) && wordlist.length > 0 && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mb-3 text-[11px] text-amber-400/80 flex items-center gap-1"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      Need at least {wordCount === 12 ? 8 : 16} known words to proceed ({knownCount}/{wordCount === 12 ? 8 : 16})
                    </motion.p>
                  )}
                  {wordlist.length === 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-2 py-2">
                        <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                        <span className="text-xs text-zinc-500">Loading wordlist...</span>
                      </div>
                      <div className={`grid gap-2 ${
                        wordCount === 12
                          ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
                          : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                      }`}>
                        {Array.from({ length: wordCount }).map((_, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <div className="flex-1 h-11 rounded-lg bg-zinc-800/50 animate-pulse border border-zinc-700/30 flex items-center pl-7">
                              <div className="h-3 w-12 rounded bg-zinc-700/40" />
                            </div>
                            <div className="h-11 w-11 rounded-lg bg-zinc-800/30 animate-pulse border border-zinc-700/20" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                  <div className={`grid gap-2 ${
                    wordCount === 12
                      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
                      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                  }`}>
                    {Array.from({ length: wordCount }).map((_, i) => (
                      <WordInput
                        key={i}
                        index={i}
                        value={inputValues[i]}
                        isUnknown={words[i] === null}
                        onValueChange={(val) => handleWordChange(i, val)}
                        onToggleUnknown={() => handleToggleUnknown(i)}
                        wordlist={wordlist}
                        onNext={() => focusNextInput(i)}
                      />
                    ))}
                  </div>
                  )}
                  {unknownCount > 0 && knownCount >= (wordCount === 12 ? 8 : 16) && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-3 text-[11px] text-cyan-400/80 flex items-center gap-1"
                    >
                      <Timer className="h-3 w-3" />
                      Estimated search: ~{formatTime(estimatedSeconds)} ({formatNumber(Math.pow(2048, unknownCount))} combinations)
                      <span className="text-zinc-600 ml-1">
                        (~{formatNumber(Math.floor(Math.pow(2048, unknownCount) * 0.0625))} valid after BIP39 filter)
                      </span>
                    </motion.p>
                  )}
                  {/* ── Seed Phrase Strength Analyzer ── */}
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-medium text-zinc-500 flex items-center gap-1">
                        <Gauge className="h-3 w-3" />
                        Recovery Strength
                      </span>
                      <span className={`text-[10px] font-bold ${
                        strengthInfo.color === 'red' ? 'text-red-400' :
                        strengthInfo.color === 'amber' ? 'text-amber-400' :
                        'text-emerald-400'
                      }`}>
                        {strengthInfo.label}
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${strengthInfo.pct}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className={`h-full rounded-full ${
                          strengthInfo.color === 'red' ? 'bg-red-500' :
                          strengthInfo.color === 'amber' ? 'bg-amber-500' :
                          'bg-emerald-500'
                        }`}
                      />
                    </div>
                    <p className={`text-[9px] mt-1 ${
                      strengthInfo.color === 'red' ? 'text-red-400/60' :
                      strengthInfo.color === 'amber' ? 'text-amber-400/60' :
                      'text-emerald-400/60'
                    }`}>
                      {strengthInfo.description}
                    </p>
                  </motion.div>
                </CardContent>
              </Card>

              {/* ── Configuration ── */}
              <Card className="bg-zinc-900/40 border-zinc-800/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400/60 text-xs font-bold">②</span>
                    <Wallet className="h-4 w-4 text-emerald-400" />
                    <CardTitle className="text-base font-semibold">Configuration</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-5">
                  {/* Wallet Presets */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-3 w-3 text-emerald-400" />
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Quick Presets</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {WALLET_PRESETS.map((preset) => {
                        const isActive = blockchain === preset.blockchain && derivationPath === preset.path
                        return (
                          <button
                            key={preset.name}
                            onClick={() => {
                              setBlockchain(preset.blockchain)
                              setDerivationPath(preset.path)
                            }}
                            disabled={isRunning}
                            className={`preset-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-200 ${
                              isActive
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/10'
                                : 'bg-zinc-800/40 border-zinc-700/40 text-zinc-400 hover:border-emerald-500/20 hover:bg-emerald-500/5 hover:text-zinc-300'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <span className="text-sm">{preset.icon}</span>
                            {preset.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Blockchain Selector */}
                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-2 block text-center sm:text-left">Blockchain Network</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(Object.entries(BLOCKCHAIN_CONFIG) as [Blockchain, typeof BLOCKCHAIN_CONFIG[Blockchain]][]).map(
                        ([key, config]) => (
                          <button
                            key={key}
                            onClick={() => handleBlockchainChange(key)}
                            className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-200 cursor-pointer relative overflow-hidden group ${
                              blockchain === key
                                ? config.accentBg + ' ' + config.accent + ' blockchain-shimmer'
                                : 'border-zinc-800/60 bg-zinc-900/30 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900/50'
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
                                style={{
                                  backgroundImage: `linear-gradient(90deg, transparent 0%, ${
                                    key === 'btc' ? 'rgba(249,115,22,0.06)' :
                                    key === 'eth' ? 'rgba(16,185,129,0.06)' :
                                    key === 'sol' ? 'rgba(6,182,212,0.06)' :
                                    'rgba(20,184,166,0.06)'
                                  } 50%, transparent 100%)`,
                                }}
                              />
                            )}
                            <span className="text-xl relative z-10">{config.icon}</span>
                            <span className="text-xs font-semibold relative z-10">{config.symbol}</span>
                            <span className="text-[9px] text-zinc-500 relative z-10">{config.name}</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Derivation Path */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-xs font-medium text-zinc-400 text-center sm:text-left">Derivation Path</label>
                      <Badge variant="outline" className="text-[8px] border-zinc-700 text-zinc-500 h-4 px-1.5">
                        Advanced
                      </Badge>
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-zinc-600" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs space-y-1.5">
                            <p className="font-semibold text-zinc-200">What are derivation paths?</p>
                            <p>A derivation path defines how your seed phrase is converted into a specific wallet address. Think of it as a map from your seed to a particular address.</p>
                            <p className="font-semibold text-zinc-200">Why change paths?</p>
                            <p>Different wallets use different paths. If the default path doesn&apos;t find your wallet, it may have been created with a different wallet that uses an alternative path.</p>
                            <p className="font-semibold text-zinc-200">Which to try first?</p>
                            <p>Start with the Standard/default path. If that doesn&apos;t match, try other paths listed for your blockchain. ETH users: try Ledger Live if you used a Ledger hardware wallet.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Select value={derivationPath} onValueChange={setDerivationPath}>
                      <SelectTrigger className="bg-zinc-900/80 border-zinc-800 text-zinc-100 font-mono text-xs h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        {BLOCKCHAIN_CONFIG[blockchain].paths.map((p) => (
                          <SelectItem key={p.path} value={p.path} className="font-mono text-xs">
                            <span className="text-zinc-400">{p.label}:</span>{' '}
                            <span className="text-emerald-400">{p.path}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Auto-Retry Toggle */}
                  {BLOCKCHAIN_CONFIG[blockchain].paths.length > 1 && (
                    <div className="flex items-center gap-3 bg-zinc-800/20 rounded-lg px-3 py-2.5 border border-zinc-800/40">
                      <Switch
                        id="auto-retry"
                        checked={autoRetry}
                        onCheckedChange={setAutoRetry}
                        disabled={isRunning}
                        className="scale-90"
                      />
                      <div className="flex-1">
                        <Label htmlFor="auto-retry" className="text-xs font-medium text-zinc-300 cursor-pointer">
                          Auto-retry all paths
                        </Label>
                        <p className="text-[10px] text-zinc-600 mt-0.5">
                          {autoRetry
                            ? `Will try all ${BLOCKCHAIN_CONFIG[blockchain].paths.length} paths for ${BLOCKCHAIN_CONFIG[blockchain].name}`
                            : 'Only search the selected derivation path'}
                        </p>
                      </div>
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-zinc-600" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            If no match is found with the current derivation path, automatically retry with alternative paths for this blockchain.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}

                  {/* Known Address */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-xs font-medium text-zinc-400 text-center sm:text-left">Known Wallet Address</label>
                      {addressValidation && (
                        <Badge
                          variant="outline"
                          className={`text-[8px] h-4 px-1.5 ${
                            addressValidation.valid
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-red-500/30 text-red-400'
                          }`}
                        >
                          {addressValidation.valid ? 'Valid' : 'Invalid'}
                        </Badge>
                      )}
                    </div>
                    <Input
                      value={knownAddress}
                      onChange={(e) => setKnownAddress(e.target.value)}
                      placeholder={BLOCKCHAIN_CONFIG[blockchain].placeholder}
                      disabled={isRunning}
                      className={`h-11 bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 font-mono text-sm focus:border-emerald-500/50 focus:ring-emerald-500/20 ${
                        addressValidation && !addressValidation.valid ? 'border-red-500/40 focus:border-red-500/50' : ''
                      }`}
                    />
                    <p className="mt-1.5 text-[10px] text-zinc-600 flex items-center gap-1">
                      <ArrowRight className="h-2.5 w-2.5" />
                      {BLOCKCHAIN_CONFIG[blockchain].hint}
                    </p>

                    {/* Multi-address verification */}
                    {!isRunning && (
                      <div className="mt-2">
                        <button
                          onClick={() => setAdditionalAddresses(prev => [...prev, ''])}
                          className="text-[10px] text-cyan-400/80 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          Add another address
                        </button>
                        {additionalAddresses.length > 0 && (
                          <p className="text-[9px] text-zinc-600 mt-1">
                            Will match against any of the provided addresses
                          </p>
                        )}
                      </div>
                    )}
                    {additionalAddresses.map((addr, idx) => (
                      <div key={idx} className="mt-2 flex items-center gap-2">
                        <Input
                          value={addr}
                          onChange={(e) => {
                            const next = [...additionalAddresses]
                            next[idx] = e.target.value
                            setAdditionalAddresses(next)
                          }}
                          placeholder={`Additional address ${idx + 2}...`}
                          disabled={isRunning}
                          className="h-9 bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 font-mono text-xs focus:border-emerald-500/50 focus:ring-emerald-500/20"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => {
                            setAdditionalAddresses(prev => prev.filter((_, i) => i !== idx))
                          }}
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Priority Mode (Checksum First) */}
                  <div className="flex items-center gap-3 bg-zinc-800/20 rounded-lg px-3 py-2.5 border border-zinc-800/40">
                    <Switch
                      id="checksum-first"
                      checked={checksumFirst}
                      onCheckedChange={setChecksumFirst}
                      disabled={isRunning}
                      className="scale-90"
                    />
                    <div className="flex-1">
                      <Label htmlFor="checksum-first" className="text-xs font-medium text-zinc-300 cursor-pointer">
                        Checksum First Mode
                      </Label>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        {checksumFirst
                          ? 'Two-phase: validate BIP39 checksums first, then derive addresses only for valid ones'
                          : 'Normal: validate checksum + derive address in same pass'}
                      </p>
                    </div>
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-3 w-3 text-zinc-600" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          <p className="font-semibold text-zinc-200">Checksum First Mode</p>
                          <p>Uses a two-phase approach: first rapidly validates all BIP39 checksums in the batch (eliminating ~93.75% of candidates), then only derives addresses for valid combinations. This can be faster for large searches since address derivation is the slowest step.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </CardContent>
              </Card>

              {/* ── Estimate Warning ── */}
              <AnimatePresence>
                {showEstimateWarning && unknownCount >= 3 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Card className="bg-amber-950/20 border-amber-500/30">
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
                    disabled={isStarting || knownCount < (wordCount === 12 ? 8 : 16) || !knownAddress.trim() || showEstimateWarning || (addressValidation !== null && !addressValidation.valid)}
                    className="flex-1 h-12 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl relative overflow-hidden group"
                  >
                    {/* Glow animation on the button */}
                    {!isStarting && knownCount >= (wordCount === 12 ? 8 : 16) && knownAddress.trim() && (addressValidation === null || addressValidation.valid) && (
                      <span className="absolute inset-0 rounded-xl animate-pulse bg-gradient-to-r from-emerald-400/20 to-cyan-400/20" />
                    )}
                    <span className="relative z-10 flex items-center justify-center gap-2">
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
                    </span>
                  </Button>
                ) : isRunning ? (
                  <Button
                    onClick={handleStopRecovery}
                    variant="destructive"
                    className="flex-1 h-12 font-semibold text-sm transition-all duration-200 rounded-xl"
                  >
                    <StopCircle className="h-4 w-4" />
                    Stop Recovery
                  </Button>
                ) : null}

                {(isCompleted || isFailed || isStopped) && (
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    className="flex-1 h-12 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 font-semibold text-sm transition-all duration-200 rounded-xl"
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
                    <Card className="bg-zinc-900/40 border-zinc-800/50 overflow-hidden relative pulse-ring">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500 via-cyan-500 to-teal-500 animate-pulse" />
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                          <CardTitle className="text-sm font-semibold text-zinc-200">
                            Searching{'.'.repeat(searchingDots)}
                          </CardTitle>
                          <Badge variant="outline" className="ml-auto text-[8px] border-emerald-500/30 text-emerald-400 h-5">
                            <Activity className="h-2.5 w-2.5 mr-0.5" />
                            Live
                          </Badge>
                        </div>
                        <CardDescription className="text-xs text-zinc-500">
                          Searching for matching wallet address
                          {jobStatus.derivationPath && (
                            <span className="font-mono text-cyan-400/70 ml-1">
                              ({BLOCKCHAIN_CONFIG[jobStatus.blockchain]?.paths?.find(p => p.path === jobStatus.derivationPath)?.label || jobStatus.derivationPath})
                            </span>
                          )}
                        </CardDescription>
                        {/* Auto-retry path indicator */}
                        {jobStatus.autoRetry && jobStatus.currentPathIndex !== undefined && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[9px] text-zinc-500">
                              Path {jobStatus.currentPathIndex + 1} of {BLOCKCHAIN_CONFIG[jobStatus.blockchain]?.paths?.length || 1}
                            </span>
                            <div className="flex items-center gap-1">
                              {BLOCKCHAIN_CONFIG[jobStatus.blockchain]?.paths?.map((p, idx) => (
                                <div
                                  key={p.path}
                                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                                    idx === jobStatus.currentPathIndex
                                      ? 'bg-emerald-400 scale-125'
                                      : jobStatus.triedPaths?.includes(p.path)
                                        ? 'bg-amber-500/50'
                                        : 'bg-zinc-700'
                                  }`}
                                  title={p.label}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Tried paths list when auto-retry is active */}
                        {jobStatus.autoRetry && jobStatus.triedPaths && jobStatus.triedPaths.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {jobStatus.triedPaths.map((triedPath) => {
                              const pathInfo = BLOCKCHAIN_CONFIG[jobStatus.blockchain]?.paths?.find(p => p.path === triedPath)
                              return (
                                <span key={triedPath} className="text-[8px] text-amber-400/60 bg-amber-500/5 border border-amber-500/10 rounded px-1.5 py-0.5">
                                  ✗ {pathInfo?.label || triedPath}
                                </span>
                              )
                            })}
                          </div>
                        )}
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
                              className="h-2.5 bg-zinc-800 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-cyan-500"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { icon: <Zap className="h-3 w-3 text-emerald-400" />, label: 'Speed', value: `${formatNumber(jobStatus.speed)}/s` },
                            { icon: <Search className="h-3 w-3 text-cyan-400" />, label: 'Checked', value: formatNumber(jobStatus.progress) },
                            { icon: <Clock className="h-3 w-3 text-amber-400" />, label: 'ETA', value: formatTime(etaSeconds) },
                            { icon: <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-teal-400" /><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /></span>, label: 'Elapsed', value: formatTime(isRunning ? liveElapsedSeconds : elapsedSeconds) },
                          ].map((stat) => (
                            <div key={stat.label} className="bg-zinc-800/40 rounded-lg p-2.5 text-center border border-zinc-800/40">
                              <div className="flex items-center justify-center gap-1 text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">
                                {stat.icon}
                                {stat.label}
                              </div>
                              <p className="text-xs font-semibold text-zinc-200">{stat.value}</p>
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
                    ref={resultsRef}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    {jobStatus.result && jobStatus.result.length > 0 ? (
                      <Card className="bg-emerald-950/20 border-emerald-500/30 overflow-hidden relative success-glow">
                        {/* Confetti particles */}
                        {showConfetti && (
                          <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
                            {Array.from({ length: 30 }).map((_, i) => {
                              const colors = ['bg-emerald-400', 'bg-cyan-400', 'bg-teal-400', 'bg-amber-400', 'bg-emerald-300']
                              const animations = ['confetti-fall', 'confetti-left', 'confetti-right']
                              return (
                                <div
                                  key={i}
                                  className={`confetti-particle ${colors[i % colors.length]} ${animations[i % animations.length]}`}
                                  style={{
                                    left: `${Math.random() * 100}%`,
                                    top: `${Math.random() * 30}%`,
                                    animationDelay: `${Math.random() * 0.8}s`,
                                    width: `${4 + Math.random() * 6}px`,
                                    height: `${4 + Math.random() * 6}px`,
                                  }}
                                />
                              )
                            })}
                          </div>
                        )}
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
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-3 font-semibold">
                              Recovered Seed Phrase
                            </p>
                            <div className={`grid gap-1.5 ${
                              wordCount === 12
                                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
                                : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                            }`}>
                              {jobStatus.result[0].split(' ').map((word, i) => (
                                <motion.div
                                  key={i}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: i * 0.03 }}
                                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 border ${
                                    words[i] === null
                                      ? 'bg-emerald-500/10 border-emerald-500/30'
                                      : 'bg-zinc-800/80 border-zinc-700/50'
                                  }`}
                                >
                                  <span className="text-[9px] text-zinc-600 font-bold min-w-[14px]">
                                    {i + 1}
                                  </span>
                                  <span className={`font-mono text-xs font-medium ${
                                    words[i] === null ? 'text-emerald-300' : 'text-zinc-400'
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
                              className="flex-1 h-11 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold text-sm shadow-lg shadow-emerald-500/20 rounded-xl"
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
                            <Button
                              onClick={handleExportResult}
                              variant="outline"
                              className="h-11 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 font-semibold text-sm rounded-xl"
                            >
                              <Download className="h-4 w-4" />
                              <span className="hidden sm:inline">Export</span>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="bg-zinc-900/40 border-zinc-800/50">
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
                        <CardContent className="pt-0 space-y-4">
                          {/* Visual illustration */}
                          <div className="relative flex items-center justify-center py-4">
                            <div className="relative">
                              <div className="flex items-center gap-3 opacity-30">
                                <Key className="h-8 w-8 text-amber-400" />
                                <ArrowRight className="h-4 w-4 text-zinc-600" />
                                <div className="h-8 w-12 border border-dashed border-zinc-600 rounded-md" />
                                <ArrowRight className="h-4 w-4 text-zinc-600" />
                                <Search className="h-8 w-8 text-zinc-500" />
                              </div>
                              <div className="absolute -top-1 -right-1">
                                <XCircle className="h-5 w-5 text-amber-500/60" />
                              </div>
                            </div>
                          </div>
                          {/* Detailed suggestions with icons */}
                          <div className="space-y-2">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Suggestions</p>
                            {[
                              { icon: <Route className="h-3.5 w-3.5 text-cyan-400" />, text: 'Try a different derivation path', desc: 'Your wallet may use a non-standard path' },
                              { icon: <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />, text: 'Enable auto-retry all paths', desc: 'Automatically searches all derivation paths' },
                              { icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />, text: 'Double-check known words', desc: 'Even one wrong word will prevent a match' },
                              { icon: <Globe className="h-3.5 w-3.5 text-teal-400" />, text: 'Verify the blockchain network', desc: 'Ensure you selected the correct blockchain' },
                            ].map((suggestion, idx) => (
                              <div key={idx} className="flex items-start gap-2.5 bg-zinc-800/30 rounded-lg p-2.5 border border-zinc-800/40">
                                <div className="mt-0.5 shrink-0">{suggestion.icon}</div>
                                <div>
                                  <p className="text-xs text-zinc-300 font-medium">{suggestion.text}</p>
                                  <p className="text-[10px] text-zinc-500">{suggestion.desc}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Try Different Path button */}
                          {BLOCKCHAIN_CONFIG[blockchain].paths.length > 1 && !autoRetry && (
                            <Button
                              onClick={() => {
                                setAutoRetry(true)
                                handleReset()
                              }}
                              variant="outline"
                              className="w-full h-10 border-cyan-500/30 bg-cyan-500/5 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300 font-semibold text-sm rounded-xl"
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Try All Paths (Auto-Retry)
                            </Button>
                          )}
                          {/* Progress info */}
                          {jobStatus && (
                            <div className="flex items-center gap-4 text-[10px] text-zinc-500 bg-zinc-800/20 rounded-lg px-3 py-2 border border-zinc-800/30">
                              <span className="flex items-center gap-1">
                                <Search className="h-2.5 w-2.5" />
                                {formatNumber(jobStatus.progress)} combinations checked
                              </span>
                              <span className="flex items-center gap-1">
                                <Zap className="h-2.5 w-2.5" />
                                Avg {formatNumber(Math.round(jobStatus.speed))}/s
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </motion.section>
                )}
              </AnimatePresence>

              {/* ── Recovery Complete Summary Card ── */}
              {(isCompleted || isStopped) && jobStatus && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                >
                  <Card className="bg-zinc-900/40 border-zinc-800/50">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-zinc-400" />
                        <CardTitle className="text-sm font-semibold text-zinc-300">Recovery Summary</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-zinc-800/30 rounded-lg p-2.5 text-center border border-zinc-800/40">
                          <div className="flex items-center justify-center gap-1 text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            Time
                          </div>
                          <p className="text-xs font-semibold text-zinc-200">{
                            jobStatus.startedAt
                              ? formatTime(
                                  jobStatus.foundAt
                                    ? (jobStatus.foundAt - jobStatus.startedAt) / 1000
                                    : isStopped
                                      ? liveElapsedSeconds || 0
                                      : (Date.now() - jobStatus.startedAt) / 1000
                                )
                              : '—'
                          }</p>
                        </div>
                        <div className="bg-zinc-800/30 rounded-lg p-2.5 text-center border border-zinc-800/40">
                          <div className="flex items-center justify-center gap-1 text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">
                            <Search className="h-2.5 w-2.5" />
                            Checked
                          </div>
                          <p className="text-xs font-semibold text-zinc-200">{formatNumber(jobStatus.progress)}</p>
                        </div>
                        <div className="bg-zinc-800/30 rounded-lg p-2.5 text-center border border-zinc-800/40">
                          <div className="flex items-center justify-center gap-1 text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">
                            <Zap className="h-2.5 w-2.5" />
                            Avg Speed
                          </div>
                          <p className="text-xs font-semibold text-zinc-200">{formatNumber(Math.round(jobStatus.speed))}/s</p>
                        </div>
                        <div className="bg-zinc-800/30 rounded-lg p-2.5 text-center border border-zinc-800/40">
                          <div className="flex items-center justify-center gap-1 text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">
                            <Route className="h-2.5 w-2.5" />
                            Path(s)
                          </div>
                          <p className="text-xs font-semibold text-zinc-200">{
                            jobStatus.triedPaths && jobStatus.triedPaths.length > 0
                              ? `${jobStatus.triedPaths.length + 1}`
                              : '1'
                          }</p>
                        </div>
                      </div>
                      {/* Paths tried detail */}
                      {jobStatus.triedPaths && jobStatus.triedPaths.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {jobStatus.triedPaths.map((triedPath) => {
                            const pathInfo = BLOCKCHAIN_CONFIG[jobStatus.blockchain]?.paths?.find(p => p.path === triedPath)
                            return (
                              <span key={triedPath} className="text-[8px] text-amber-400/60 bg-amber-500/5 border border-amber-500/10 rounded px-1.5 py-0.5">
                                ✗ {pathInfo?.label || triedPath}
                              </span>
                            )
                          })}
                          <span className="text-[8px] text-zinc-500 bg-zinc-800/30 border border-zinc-800/40 rounded px-1.5 py-0.5">
                            {BLOCKCHAIN_CONFIG[jobStatus.blockchain]?.paths?.find(p => p.path === jobStatus.derivationPath)?.label || jobStatus.derivationPath}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {/* ── Failed Display ── */}
              {isFailed && (
                <Card className="bg-red-950/10 border-red-500/20">
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
                <Card className="bg-zinc-900/40 border-zinc-800/50">
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

              {/* ── Recovery Event Log ── */}
              {(isRunning || (isCompleted && recoveryLog.length > 0) || (isStopped && recoveryLog.length > 0)) && (
                <Card className="bg-zinc-900/40 border-zinc-800/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-cyan-400" />
                        <CardTitle className="text-sm font-semibold">Recovery Log</CardTitle>
                        <Badge variant="outline" className="text-[8px] border-zinc-700 text-zinc-500 h-4 px-1.5">
                          {recoveryLog.length} events
                        </Badge>
                      </div>
                      {recoveryLog.length > 0 && !isRunning && (
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] text-zinc-500 hover:text-zinc-300" onClick={() => setRecoveryLog([])}>
                          Clear
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div ref={recoveryLogRef} className="max-h-40 overflow-y-auto space-y-0.5 font-mono text-[11px] rounded-lg bg-zinc-950/50 border border-zinc-800/40 p-2">
                      {recoveryLog.map((entry, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="text-zinc-600 shrink-0">{new Date(entry.time).toLocaleTimeString()}</span>
                          <span className={entry.msg.includes('Match found') ? 'text-emerald-400' : entry.msg.includes('No match') ? 'text-amber-400' : 'text-zinc-400'}>{entry.msg}</span>
                        </div>
                      ))}
                      {isRunning && (
                        <div className="flex gap-2 text-zinc-600">
                          <span>{new Date().toLocaleTimeString()}</span>
                          <span>Searching{'.'.repeat(searchingDots + 1)}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
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
              className="space-y-5"
            >
              <Card className="bg-zinc-900/40 border-zinc-800/50">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <CardTitle className="text-base">Quick Verify</CardTitle>
                  </div>
                  <CardDescription className="text-xs text-zinc-500">
                    Already have a complete seed phrase? Verify it matches your wallet address instantly.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-2 block text-center sm:text-left">Seed Phrase (12 or 24 words)</label>
                    <textarea
                      value={verifyMnemonic}
                      onChange={(e) => setVerifyMnemonic(e.target.value)}
                      placeholder="Enter your seed phrase separated by spaces..."
                      className="w-full h-24 bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:ring-emerald-500/20 resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-zinc-400 mb-2 block text-center sm:text-left">Blockchain</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(Object.entries(BLOCKCHAIN_CONFIG) as [Blockchain, typeof BLOCKCHAIN_CONFIG[Blockchain]][]).map(
                        ([key, config]) => (
                          <button
                            key={key}
                            onClick={() => setVerifyBlockchain(key)}
                            className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg border transition-all duration-200 text-xs font-medium ${
                              verifyBlockchain === key
                                ? config.accentBg + ' ' + config.accent
                                : 'border-zinc-800/60 bg-zinc-900/30 text-zinc-500 hover:border-zinc-700'
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
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-xs font-medium text-zinc-400 text-center sm:text-left">Wallet Address</label>
                      {verifyAddressValidation && (
                        <Badge
                          variant="outline"
                          className={`text-[8px] h-4 px-1.5 ${
                            verifyAddressValidation.valid
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-red-500/30 text-red-400'
                          }`}
                        >
                          {verifyAddressValidation.valid ? 'Valid' : 'Invalid'}
                        </Badge>
                      )}
                    </div>
                    <Input
                      value={verifyAddress}
                      onChange={(e) => setVerifyAddress(e.target.value)}
                      placeholder={BLOCKCHAIN_CONFIG[verifyBlockchain].placeholder}
                      className={`h-11 bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 font-mono text-sm rounded-xl ${
                        verifyAddressValidation && !verifyAddressValidation.valid ? 'border-red-500/40' : ''
                      }`}
                    />
                  </div>

                  <Button
                    onClick={handleVerify}
                    disabled={isVerifying || !verifyMnemonic.trim() || !verifyAddress.trim() || (verifyAddressValidation !== null && !verifyAddressValidation.valid)}
                    className="w-full h-12 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-semibold text-sm shadow-lg shadow-emerald-500/20 disabled:opacity-50 rounded-xl"
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

                  {/* Derive Preview Address */}
                  <div className="border-t border-zinc-800/50 pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin className="h-4 w-4 text-cyan-400" />
                      <span className="text-xs font-medium text-zinc-400">Address Preview</span>
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-zinc-600" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Enter a complete seed phrase and select a blockchain to see what address it derives — no known address required. Useful if you have a seed phrase but don&apos;t know which address it corresponds to.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Button
                      onClick={handleDerivePreview}
                      disabled={isDeriving || !verifyMnemonic.trim()}
                      variant="outline"
                      className="w-full h-10 border-cyan-500/30 bg-cyan-500/5 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300 font-semibold text-sm rounded-xl disabled:opacity-50"
                    >
                      {isDeriving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Deriving...
                        </>
                      ) : (
                        <>
                          <EyeIcon className="h-4 w-4" />
                          Preview Address
                        </>
                      )}
                    </Button>
                    <AnimatePresence>
                      {deriveResult && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="mt-3 bg-cyan-950/15 border border-cyan-500/20 rounded-xl p-3"
                        >
                          <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1 font-semibold">
                            Derived Address ({BLOCKCHAIN_CONFIG[verifyBlockchain as Blockchain]?.symbol} · {deriveResult.derivationPath === 'default' ? 'Standard' : deriveResult.derivationPath})
                          </p>
                          <p className="text-xs font-mono text-cyan-300 break-all bg-zinc-900/60 rounded-lg p-2 select-all">
                            {deriveResult.address}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Batch Derive All Paths */}
                  {BLOCKCHAIN_CONFIG[verifyBlockchain as Blockchain]?.paths.length > 1 && (
                    <div className="border-t border-zinc-800/50 pt-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Route className="h-4 w-4 text-teal-400" />
                        <span className="text-xs font-medium text-zinc-400">Derive All Paths</span>
                        <Badge variant="outline" className="text-[8px] border-teal-500/30 text-teal-400 h-4 px-1.5">
                          {BLOCKCHAIN_CONFIG[verifyBlockchain as Blockchain]?.paths.length} paths
                        </Badge>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger>
                              <Info className="h-3 w-3 text-zinc-600" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              Derive addresses for ALL derivation paths of the selected blockchain at once. Helps you find which path your wallet uses.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Button
                        onClick={handleBatchDerive}
                        disabled={isBatchDeriving || !verifyMnemonic.trim()}
                        variant="outline"
                        className="w-full h-10 border-teal-500/30 bg-teal-500/5 text-teal-400 hover:bg-teal-500/10 hover:text-teal-300 font-semibold text-sm rounded-xl disabled:opacity-50"
                      >
                        {isBatchDeriving ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Deriving all paths...
                          </>
                        ) : (
                          <>
                            <Route className="h-4 w-4" />
                            Derive All Paths
                          </>
                        )}
                      </Button>
                      {batchDeriveResults.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {batchDeriveResults.map((r, i) => (
                            <div key={i} className="bg-teal-950/15 border border-teal-500/20 rounded-lg p-2.5">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-[8px] border-teal-500/30 text-teal-400 h-4 px-1.5">{r.label}</Badge>
                                <span className="text-[9px] font-mono text-zinc-500">{r.path}</span>
                              </div>
                              <p className="text-[11px] font-mono text-teal-300 break-all bg-zinc-900/60 rounded p-1.5 select-all">{r.address}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Verify Result */}
                  <AnimatePresence>
                    {verifyResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                      >
                        {verifyResult.match ? (
                          <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                              <span className="font-semibold text-emerald-300">Match Found!</span>
                            </div>
                            <p className="text-xs text-zinc-400">
                              This seed phrase derives the address:
                            </p>
                            <p className="text-xs font-mono text-emerald-300 mt-1 break-all bg-zinc-900/60 rounded-lg p-2">
                              {verifyResult.address}
                            </p>
                            <p className="text-xs text-emerald-400/60 mt-1.5">
                              This matches your provided wallet address.
                            </p>
                          </div>
                        ) : verifyResult.valid ? (
                          <div className="bg-amber-950/15 border border-amber-500/30 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <XCircle className="h-5 w-5 text-amber-400" />
                              <span className="font-semibold text-amber-300">No Match</span>
                            </div>
                            <p className="text-xs text-zinc-400">
                              The seed phrase is valid but derives a different address:
                            </p>
                            <p className="text-xs font-mono text-amber-300 mt-1 break-all bg-zinc-900/60 rounded-lg p-2">
                              {verifyResult.address}
                            </p>
                            <p className="text-xs text-zinc-500 mt-1.5">
                              This does not match your provided wallet address. Check the blockchain or derivation path.
                            </p>
                          </div>
                        ) : (
                          <div className="bg-red-950/10 border border-red-500/30 rounded-xl p-4">
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
              {/* ── Recovery Analytics Dashboard ── */}
              {(() => {
                const allEntries = [
                  ...persistedHistory.map(e => ({ found: e.found, blockchain: e.blockchain, timestamp: e.timestamp })),
                  ...jobHistory
                    .filter(j => j.status === 'completed' || j.status === 'stopped')
                    .map(j => ({
                      found: !!(j.result && j.result.length > 0),
                      blockchain: j.blockchain,
                      timestamp: j.startedAt || Date.now(),
                    })),
                ]
                if (allEntries.length === 0) return null
                const successful = allEntries.filter(e => e.found).length
                const failed = allEntries.filter(e => !e.found).length
                // Pie chart data
                const pieData = [
                  { name: 'Found', value: successful, color: '#10b981' },
                  { name: 'No Match', value: failed, color: '#f59e0b' },
                ].filter(d => d.value > 0)
                // Bar chart data - blockchain distribution
                const chainCounts: Record<string, number> = {}
                allEntries.forEach(e => {
                  const name = BLOCKCHAIN_CONFIG[e.blockchain as Blockchain]?.symbol || e.blockchain
                  chainCounts[name] = (chainCounts[name] || 0) + 1
                })
                const barData = Object.entries(chainCounts).map(([name, count]) => ({
                  name,
                  count,
                  fill: name === 'BTC' ? '#f97316' : name === 'ETH' ? '#10b981' : name === 'SOL' ? '#06b6d4' : '#14b8a6',
                }))

                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Card className="bg-zinc-900/40 border-zinc-800/50">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-cyan-400" />
                          <CardTitle className="text-base font-semibold">Recovery Analytics</CardTitle>
                          <Badge variant="outline" className="text-[8px] border-zinc-700 text-zinc-500 h-4 px-1.5 ml-auto">
                            {allEntries.length} entries
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Success Rate Donut Chart */}
                          <div className="bg-zinc-800/20 rounded-xl p-3 border border-zinc-800/30">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2 text-center">Success Rate</p>
                            <div className="h-[160px] flex items-center justify-center">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={40}
                                    outerRadius={60}
                                    paddingAngle={4}
                                    dataKey="value"
                                    stroke="none"
                                  >
                                    {pieData.map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                  </Pie>
                                  <RechartsTooltip
                                    contentStyle={{ background: 'rgba(24,24,27,0.95)', border: '1px solid rgba(39,39,42,0.5)', borderRadius: 8, fontSize: 12 }}
                                    itemStyle={{ color: '#d4d4d8' }}
                                  />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="flex items-center justify-center gap-4 mt-1">
                              {pieData.map((d) => (
                                <div key={d.name} className="flex items-center gap-1.5">
                                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                                  <span className="text-[10px] text-zinc-400">{d.name} ({d.value})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Blockchain Distribution Bar Chart */}
                          <div className="bg-zinc-800/20 rounded-xl p-3 border border-zinc-800/30">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2 text-center">Blockchain Distribution</p>
                            <div className="h-[160px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={barData} barSize={32}>
                                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                  <RechartsTooltip
                                    contentStyle={{ background: 'rgba(24,24,27,0.95)', border: '1px solid rgba(39,39,42,0.5)', borderRadius: 8, fontSize: 12 }}
                                    itemStyle={{ color: '#d4d4d8' }}
                                  />
                                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                    {barData.map((entry, index) => (
                                      <Cell key={`bar-cell-${index}`} fill={entry.fill} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })()}

              {/* ── Recovery Stats Summary ── */}
              {(() => {
                // Combine persisted history and session jobs for stats
                const allEntries = [
                  ...persistedHistory.map(e => ({ found: e.found, timestamp: e.timestamp, source: 'persisted' as const })),
                  ...jobHistory
                    .filter(j => j.status === 'completed' || j.status === 'stopped')
                    .map(j => ({
                      found: !!(j.result && j.result.length > 0),
                      timestamp: j.startedAt || Date.now(),
                      source: 'session' as const,
                    })),
                ]
                const totalRecoveries = allEntries.length
                const successful = allEntries.filter(e => e.found).length
                const failed = allEntries.filter(e => !e.found).length
                // Calculate a rough total time (sum of time spans - we only have timestamps, so this is approximate)
                const totalTimeMs = allEntries.length > 0
                  ? allEntries.reduce((acc, e) => acc + (e.timestamp ? 1 : 0), 0) * 0 // We can't accurately calculate total time from just timestamps
                  : 0
                // Use a more meaningful metric: count of jobs
                const successRate = totalRecoveries > 0 ? Math.round((successful / totalRecoveries) * 100) : 0

                if (totalRecoveries === 0) return null

                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Card className="bg-zinc-900/40 border-zinc-800/50">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-cyan-400" />
                          <CardTitle className="text-base font-semibold">Recovery Stats</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="flex items-center gap-2.5 bg-zinc-800/30 border border-zinc-800/40 rounded-lg px-3 py-2.5">
                            <div className="text-cyan-400"><Activity className="h-3.5 w-3.5" /></div>
                            <div>
                              <p className="text-sm font-semibold text-zinc-200">{totalRecoveries}</p>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-wider">Total</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 bg-zinc-800/30 border border-zinc-800/40 rounded-lg px-3 py-2.5">
                            <div className="text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /></div>
                            <div>
                              <p className="text-sm font-semibold text-emerald-300">{successful}</p>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-wider">Found</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 bg-zinc-800/30 border border-zinc-800/40 rounded-lg px-3 py-2.5">
                            <div className="text-amber-400"><XCircle className="h-3.5 w-3.5" /></div>
                            <div>
                              <p className="text-sm font-semibold text-amber-300">{failed}</p>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-wider">No Match</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 bg-zinc-800/30 border border-zinc-800/40 rounded-lg px-3 py-2.5">
                            <div className="text-teal-400"><TrendingUp className="h-3.5 w-3.5" /></div>
                            <div>
                              <p className="text-sm font-semibold text-teal-300">{successRate}%</p>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-wider">Success Rate</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })()}

              <Card className="bg-zinc-900/40 border-zinc-800/50">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-emerald-400" />
                    <CardTitle className="text-base">Recovery History</CardTitle>
                    {(persistedHistory.length > 0 || jobHistory.length > 0) && (
                      <div className="ml-auto flex items-center gap-1.5">
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-[9px] text-cyan-400/80 hover:text-cyan-300 h-6 px-2 gap-1"
                                onClick={() => handleExportHistory('json')}
                              >
                                <FileDown className="h-3 w-3" />
                                Export JSON
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              Export history as JSON file
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-[9px] text-cyan-400/80 hover:text-cyan-300 h-6 px-2 gap-1"
                                onClick={() => handleExportHistory('csv')}
                              >
                                <FileDown className="h-3 w-3" />
                                CSV
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              Export history as CSV file
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {persistedHistory.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[9px] text-zinc-500 hover:text-red-400 h-6 px-2"
                            onClick={handleClearPersistedHistory}
                          >
                            Clear All
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <CardDescription className="text-xs text-zinc-500">
                    Recovery results are persisted in your browser. Server-side jobs from this session are also shown.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {jobHistory.length === 0 && persistedHistory.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <div className="relative inline-flex items-center justify-center w-16 h-16 mb-4">
                        <div className="absolute inset-0 rounded-full bg-zinc-800/50" />
                        <History className="h-8 w-8 text-zinc-600 relative z-10" />
                        <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                          <Search className="h-2 w-2 text-emerald-400" />
                        </div>
                      </div>
                      <p className="text-sm font-medium text-zinc-400">No recovery history yet</p>
                      <p className="text-xs text-zinc-600 mt-1 max-w-xs mx-auto">
                        Start your first recovery to see results here. Your recovery history is persisted across sessions.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                      {/* Persisted history entries */}
                      {persistedHistory.map((entry) => (
                        <div
                          key={`persisted-${entry.id}`}
                          className="bg-zinc-800/30 rounded-xl p-3 border border-zinc-800/40 space-y-2 hover:border-zinc-700/60 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{BLOCKCHAIN_CONFIG[entry.blockchain]?.icon}</span>
                              <div>
                                <p className="text-xs font-medium text-zinc-300">
                                  {BLOCKCHAIN_CONFIG[entry.blockchain]?.name} Recovery
                                </p>
                                <p className="text-[9px] text-zinc-600 font-mono">
                                  {entry.derivationPath}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[8px] h-5 ${
                                entry.found
                                  ? 'border-emerald-500/30 text-emerald-400'
                                  : 'border-amber-500/30 text-amber-400'
                              }`}
                            >
                              {entry.found ? 'Found' : 'No Match'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                            <span className="flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />
                              {new Date(entry.timestamp).toLocaleString()}
                            </span>
                            <span className="text-zinc-600">persisted</span>
                          </div>
                          <p className="text-[9px] text-zinc-600 font-mono truncate">
                            {entry.knownAddress}
                          </p>
                        </div>
                      ))}
                      {/* Server-side job history */}
                      {jobHistory
                        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
                        .map((job) => (
                          <div
                            key={job.id}
                            className="bg-zinc-800/30 rounded-xl p-3 border border-zinc-800/40 space-y-2 hover:border-zinc-700/60 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{BLOCKCHAIN_CONFIG[job.blockchain].icon}</span>
                                <div>
                                  <p className="text-xs font-medium text-zinc-300">
                                    {BLOCKCHAIN_CONFIG[job.blockchain].name} Recovery
                                  </p>
                                  <p className="text-[9px] text-zinc-600 font-mono">
                                    {job.derivationPath}
                                  </p>
                                </div>
                              </div>
                              <Badge
                                variant="outline"
                                className={`text-[8px] h-5 ${
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
                                <Search className="h-2.5 w-2.5" />
                                {formatNumber(job.progress)}/{formatNumber(job.total)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Zap className="h-2.5 w-2.5" />
                                {formatNumber(job.speed)}/s
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '—'}
                              </span>
                              <span className="text-zinc-600">session</span>
                            </div>
                            <p className="text-[9px] text-zinc-600 font-mono truncate">
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

          {/* ── Word List Tab ── */}
          {activeTab === 'wordlist' && (
            <motion.div
              key="wordlist"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <Card className="bg-zinc-900/40 border-zinc-800/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-emerald-400" />
                    <CardTitle className="text-base font-semibold">BIP39 Word Dictionary</CardTitle>
                    <Badge variant="outline" className="text-[9px] border-cyan-500/30 text-cyan-400 bg-cyan-500/10 h-5">
                      {wordlist.length} words
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-zinc-500">
                    Search and browse the complete BIP39 wordlist. Click any word to copy it. Useful for finding the correct spelling of seed phrase words.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <Input
                      value={wordlistSearch}
                      onChange={(e) => setWordlistSearch(e.target.value)}
                      placeholder="Search BIP39 words..."
                      className="h-10 pl-10 bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 font-mono text-sm focus:border-emerald-500/50 focus:ring-emerald-500/20"
                    />
                    {wordlistSearch && (
                      <button
                        onClick={() => setWordlistSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {wordlistSearch && (
                    <p className="text-[10px] text-zinc-500 mb-2">
                      {wordlist.filter(w => w.startsWith(wordlistSearch.toLowerCase())).length} words match &quot;{wordlistSearch.toLowerCase()}&quot;
                    </p>
                  )}
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 max-h-80 overflow-y-auto rounded-lg bg-zinc-950/50 border border-zinc-800/40 p-2">
                    {wordlist
                      .filter(w => !wordlistSearch || w.startsWith(wordlistSearch.toLowerCase()))
                      .map((word, i) => (
                        <button
                          key={word}
                          onClick={() => {
                            navigator.clipboard.writeText(word)
                            setWordlistCopiedIdx(i)
                            setTimeout(() => setWordlistCopiedIdx(null), 1500)
                          }}
                          className={`px-2 py-1 text-[11px] font-mono rounded-md transition-all duration-150 text-left truncate ${
                            wordlistCopiedIdx === i
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
                          }`}
                        >
                          {wordlistCopiedIdx === i ? <Check className="h-3 w-3 inline mr-1" /> : null}
                          {word}
                        </button>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── Wallet Generator Tab ── */}
          {activeTab === 'wallet' && (
            <motion.div
              key="wallet"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Generator Controls */}
              <Card className="bg-zinc-900/40 border-zinc-800/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-emerald-400" />
                    <CardTitle className="text-base font-semibold">Wallet Generator</CardTitle>
                    <Badge variant="outline" className="ml-auto text-[9px] gap-1 h-5 border-amber-500/30 text-amber-400 bg-amber-500/10">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      For Recovery Only
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-zinc-500">
                    {walletMode === 'generate'
                      ? 'Generate a random BIP39 seed phrase and derive wallet addresses across multiple blockchains.'
                      : 'Import an existing seed phrase to derive addresses and check balances across all chains.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Mode toggle */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <Label className="text-xs text-zinc-400">Mode</Label>
                    <div className="flex items-center gap-1 bg-zinc-800/60 rounded-lg p-1">
                      <button
                        onClick={() => setWalletMode('generate')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                          walletMode === 'generate'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <Sparkles className="h-3 w-3" />
                        Generate
                      </button>
                      <button
                        onClick={() => setWalletMode('import')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                          walletMode === 'import'
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <ClipboardPaste className="h-3 w-3" />
                        Import
                      </button>
                    </div>
                  </div>

                  {walletMode === 'generate' ? (
                    <>
                      {/* Word count selector + strength indicator */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <Label className="text-xs text-zinc-400">Word Count</Label>
                        <div className="flex items-center gap-2 bg-zinc-800/60 rounded-lg p-1">
                          <button
                            onClick={() => setWalletWordCount(12)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                              walletWordCount === 12
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            12 Words
                          </button>
                          <button
                            onClick={() => setWalletWordCount(24)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                              walletWordCount === 24
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            24 Words
                          </button>
                        </div>
                        {/* Strength indicator */}
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/50">
                            <Hash className="h-3 w-3 text-zinc-500" />
                            <span className="text-[10px] text-zinc-400 font-mono">{walletWordCount === 12 ? '128' : '256'}-bit</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: walletWordCount === 12 ? '60%' : '100%' }}
                                transition={{ duration: 0.5, ease: 'easeOut' }}
                                className={`h-full rounded-full ${walletWordCount === 12 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              />
                            </div>
                            <Badge variant="outline" className={`text-[9px] h-5 ${
                              walletWordCount === 12
                                ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                                : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                            }`}>
                              {walletWordCount === 12 ? 'Strong' : 'Very Strong'}
                            </Badge>
                          </div>
                        </div>
                        {/* Wallet presets */}
                        <div className="w-full">
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { name: 'MetaMask', icon: '🦊', words: 12 },
                              { name: 'Phantom', icon: '👻', words: 12 },
                              { name: 'Ledger', icon: '🔐', words: 24 },
                              { name: 'Trezor', icon: '🛡', words: 12 },
                              { name: 'Trust Wallet', icon: '💎', words: 12 },
                            ].map(preset => (
                              <button
                                key={preset.name}
                                onClick={() => setWalletWordCount(preset.words as 12 | 24)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-all ${
                                  walletWordCount === preset.words
                                    ? 'bg-zinc-800/60 text-zinc-300 border border-zinc-700/60 hover:border-emerald-500/30'
                                    : 'bg-zinc-900/40 text-zinc-600 border border-zinc-800/40 hover:text-zinc-400'
                                }`}
                              >
                                <span className="text-xs">{preset.icon}</span>
                                {preset.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          <Button
                            onClick={handleGenerateWallet}
                            disabled={isGenerating || autoScanActive}
                            className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs h-9 gap-1.5"
                          >
                            {isGenerating ? (
                              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...</>
                            ) : (
                              <><Sparkles className="h-3.5 w-3.5" /> Generate Wallet</>
                            )}
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Import mode */}
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label className="text-xs text-zinc-400">Enter Your Seed Phrase</Label>
                          <Textarea
                            value={importMnemonic}
                            onChange={(e) => { setImportMnemonic(e.target.value); setImportError('') }}
                            placeholder="Enter your 12 or 24-word seed phrase separated by spaces..."
                            className="bg-zinc-900/80 border-zinc-700/60 text-sm font-mono text-zinc-200 placeholder:text-zinc-600 min-h-[80px] resize-none focus:border-cyan-500/50 focus:ring-cyan-500/20"
                          />
                          {importError && (
                            <p className="text-[10px] text-red-400 flex items-center gap-1">
                              <XCircle className="h-3 w-3" />
                              {importError}
                            </p>
                          )}
                          <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                            <span>{importMnemonic.trim().split(/\s+/).filter(w => w).length} words entered</span>
                            {importMnemonic.trim() && (
                              <Badge variant="outline" className={`text-[9px] h-4 ${
                                [12, 24].includes(importMnemonic.trim().split(/\s+/).filter(w => w).length)
                                  ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                                  : 'border-zinc-700 text-zinc-500'
                              }`}>
                                {[12, 24].includes(importMnemonic.trim().split(/\s+/).filter(w => w).length) ? 'Valid length' : 'Need 12 or 24'}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          onClick={handleImportWallet}
                          disabled={isGenerating || !importMnemonic.trim()}
                          className="bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white text-xs h-9 gap-1.5"
                        >
                          {isGenerating ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deriving & Checking...</>
                          ) : (
                            <><Search className="h-3.5 w-3.5" /> Derive & Check Balances</>
                          )}
                        </Button>
                      </div>
                    </>
                  )}

                  {/* ── High-Speed Turbo Scan ── */}
                  <div className="border border-amber-500/20 rounded-xl p-4 space-y-4 bg-gradient-to-b from-zinc-900/40 to-zinc-900/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <Gauge className="h-4 w-4 text-amber-400" />
                        </div>
                        <div>
                          <span className="text-sm font-semibold text-zinc-200">Turbo Scan</span>
                          <p className="text-[9px] text-zinc-500">Sync derivation engine &middot; 5k+ wallets/min</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isScanRunning && scanSpeed > 0 && (
                          <Badge variant="outline" className="text-[9px] h-6 border-cyan-500/30 text-cyan-400 bg-cyan-500/10 animate-pulse">
                            <Activity className="h-2.5 w-2.5 mr-1" />
                            {formatNumber(scanSpeed * 60)}/min
                          </Badge>
                        )}
                        <Button
                          onClick={isScanRunning ? handleStopScan : handleStartScan}
                          variant={isScanRunning ? 'destructive' : 'default'}
                          size="sm"
                          className={`text-xs h-8 gap-1.5 ${
                            !isScanRunning ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white border-0' : ''
                          }`}
                        >
                          {isScanRunning ? (
                            <><StopCircle className="h-3.5 w-3.5" /> Stop</>
                          ) : (
                            <><Zap className="h-3.5 w-3.5" /> Start Turbo Scan</>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Scan configuration */}
                    {!isScanRunning && !scanStatus && (
                      <div className="space-y-3">
                        {/* Mode selector */}
                        <div className="space-y-2">
                          <Label className="text-xs text-zinc-400">Scan Mode</Label>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { mode: 'fast' as const, label: '⚡ Fast', desc: 'Gen+derive only, ~5k/min', est: '~5k/min', color: 'emerald' },
                              { mode: 'balanced' as const, label: '⚖️ Balanced', desc: `Check ${scanBalancePercent}% balances`, est: '~500/min', color: 'cyan' },
                              { mode: 'full' as const, label: '🔍 Full', desc: 'Check all balances', est: '~50/min', color: 'amber' },
                            ].map(opt => (
                              <button
                                key={opt.mode}
                                onClick={() => setScanMode(opt.mode)}
                                className={`px-3 py-2.5 rounded-lg text-left transition-all border ${
                                  scanMode === opt.mode
                                    ? opt.color === 'emerald' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                    : opt.color === 'cyan' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                    : 'bg-zinc-900/40 border-zinc-800/40 text-zinc-500 hover:border-zinc-700'
                                }`}
                              >
                                <p className="text-xs font-medium">{opt.label}</p>
                                <p className="text-[9px] text-zinc-600 mt-0.5">{opt.desc}</p>
                                <p className="text-[8px] text-zinc-700 mt-0.5 font-mono">{opt.est}</p>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Chain selector */}
                        <div className="space-y-2">
                          <Label className="text-xs text-zinc-400">Chains to Scan</Label>
                          <div className="flex flex-wrap gap-2">
                            {(['eth', 'btc', 'sol', 'xrp'] as Blockchain[]).map(chain => {
                              const cfg = BLOCKCHAIN_CONFIG[chain]
                              const isSelected = scanChains.includes(chain)
                              return (
                                <button
                                  key={chain}
                                  onClick={() => {
                                    setScanChains(prev =>
                                      isSelected
                                        ? prev.filter(c => c !== chain)
                                        : [...prev, chain]
                                    )
                                  }}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                                    isSelected
                                      ? `${cfg.accentBg} ${cfg.accent} border-current/30`
                                      : 'bg-zinc-900/40 border-zinc-800/40 text-zinc-600 hover:text-zinc-400'
                                  }`}
                                >
                                  <span className="text-sm">{cfg.icon}</span>
                                  {cfg.name}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Balance check percentage (balanced mode) */}
                        {scanMode === 'balanced' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-zinc-400">Balance Check Rate</Label>
                              <span className="text-xs font-mono text-cyan-400">{scanBalancePercent}%</span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max="100"
                              value={scanBalancePercent}
                              onChange={(e) => setScanBalancePercent(Number(e.target.value))}
                              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                            />
                            <div className="flex justify-between text-[9px] text-zinc-600">
                              <span>Faster (1%)</span>
                              <span>Thorough (100%)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Live scan stats */}
                    {(isScanRunning || (scanStatus && scanStatus.status !== 'running')) && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-2.5 text-center">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Scanned</p>
                            <p className="text-lg font-bold font-mono text-zinc-100">{formatNumber(scanScanned)}</p>
                          </div>
                          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-2.5 text-center">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Speed</p>
                            <p className="text-lg font-bold font-mono text-cyan-400">{formatNumber(scanSpeed)}</p>
                            <p className="text-[8px] text-zinc-600">wallets/s</p>
                          </div>
                          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-2.5 text-center">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Per Min</p>
                            <p className="text-lg font-bold font-mono text-amber-400">{scanSpeed > 0 ? formatNumber(scanSpeed * 60) : '—'}</p>
                            <p className="text-[8px] text-zinc-600">wallets/min</p>
                          </div>
                          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-2.5 text-center">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Elapsed</p>
                            <p className="text-lg font-bold font-mono text-zinc-300">{formatTime(scanElapsed)}</p>
                          </div>
                          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-2.5 text-center col-span-2 sm:col-span-1">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Found</p>
                            <p className={`text-lg font-bold font-mono ${scanFound.length > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>{scanFound.length}</p>
                            {scanFound.length > 0 && <p className="text-[8px] text-emerald-500">funded!</p>}
                          </div>
                        </div>

                        {/* Speed sparkline chart */}
                        {isScanRunning && scanStatus?.speedHistory && scanStatus.speedHistory.length > 2 && (
                          <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Speed History</span>
                              <span className="text-[9px] font-mono text-cyan-400">
                                {formatNumber(scanSpeed * 60)} wallets/min
                              </span>
                            </div>
                            <div className="h-16 flex items-end gap-px">
                              {(() => {
                                const history = scanStatus.speedHistory || []
                                if (history.length < 2) return null
                                // Calculate speed between each data point
                                const speeds: number[] = []
                                for (let i = 1; i < history.length; i++) {
                                  const dt = (history[i].time - history[i-1].time) / 1000
                                  const ds = history[i].scanned - history[i-1].scanned
                                  if (dt > 0) speeds.push(ds / dt)
                                }
                                if (speeds.length === 0) return null
                                const maxSpeed = Math.max(...speeds, 1)
                                return speeds.slice(-40).map((s, i) => (
                                  <div
                                    key={i}
                                    className="flex-1 rounded-t-sm transition-all duration-300"
                                    style={{
                                      height: `${Math.max(4, (s / maxSpeed) * 100)}%`,
                                      background: s >= maxSpeed * 0.8
                                        ? 'linear-gradient(to top, rgb(6 182 212), rgb(16 185 129))'
                                        : s >= maxSpeed * 0.5
                                          ? 'linear-gradient(to top, rgb(6 182 212 / 0.6), rgb(6 182 212))'
                                          : 'rgb(6 182 212 / 0.3)',
                                      minHeight: '3px',
                                    }}
                                  />
                                ))
                              })()}
                            </div>
                          </div>
                        )}

                        {/* Speed projection bar */}
                        {isScanRunning && scanSpeed > 0 && (
                          <div className="flex items-center gap-2 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2">
                            <Activity className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
                            <span className="text-[10px] text-cyan-300">
                              <span className="font-mono font-bold text-cyan-200">{formatNumber(scanSpeed * 60)}</span> wallets/min
                            </span>
                            {scanSpeed * 60 >= 5000 && (
                              <Badge variant="outline" className="text-[8px] h-4 border-emerald-500/30 text-emerald-400 bg-emerald-500/10 ml-auto">
                                🚀 High speed!
                              </Badge>
                            )}
                            {scanSpeed * 60 < 5000 && scanSpeed * 60 >= 500 && (
                              <Badge variant="outline" className="text-[8px] h-4 border-amber-500/30 text-amber-400 bg-amber-500/10 ml-auto">
                                {scanMode === 'fast' ? '⚡ Gen only' : `${scanStatus?.balanceCheckPercent ?? scanBalancePercent}% balance check`}
                              </Badge>
                            )}
                            {scanSpeed * 60 < 500 && (
                              <Badge variant="outline" className="text-[8px] h-4 border-zinc-600 text-zinc-400 ml-auto">
                                API-limited
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Progress bar (indeterminate) */}
                        {isScanRunning && (
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-amber-500 via-cyan-500 to-emerald-500 rounded-full animate-scan-progress" />
                          </div>
                        )}

                        {/* Stopped status */}
                        {scanStatus && scanStatus.status === 'stopped' && (
                          <div className="flex items-center gap-3 bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2.5">
                            <StopCircle className="h-4 w-4 text-zinc-400" />
                            <div className="text-[10px] text-zinc-400">
                              <p>Scan stopped. Checked <span className="font-mono text-zinc-300">{formatNumber(scanScanned)}</span> wallets
                              {scanSpeed > 0 && <> at avg <span className="font-mono text-cyan-400">{formatNumber(scanSpeed)}</span>/s</>}.
                              </p>
                              {scanSpeed > 0 && (
                                <p className="text-zinc-500 mt-0.5">Average throughput: <span className="font-mono text-amber-400">{formatNumber(scanSpeed * 60)}</span> wallets/min</p>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* Found wallets */}
                    {scanFound.length > 0 && (
                      <div className="space-y-2 rounded-lg p-3 shadow-[0_0_20px_rgba(16,185,129,0.2)] border border-emerald-500/30 bg-emerald-500/5">
                        <h4 className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Funded Wallets Found! ({scanFound.length})
                        </h4>
                        <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                          {scanFound.map((found, i) => (
                            <div key={i} className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2.5 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                {found.addresses.map((addr, j) => (
                                  <Badge key={j} variant="outline" className="text-[9px] h-5 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                                    {addr.blockchain.toUpperCase()}: {addr.balance} {addr.symbol}
                                  </Badge>
                                ))}
                              </div>
                              <p className="text-[9px] font-mono text-emerald-300/70 break-all leading-relaxed">{found.mnemonic}</p>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { navigator.clipboard.writeText(found.mnemonic); toast.success('Mnemonic copied') }}
                                  className="h-5 text-[9px] text-emerald-400 hover:text-emerald-300 px-2"
                                >
                                  <Copy className="h-2.5 w-2.5 mr-1" /> Copy Mnemonic
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Legacy auto-scan (kept for reference) */}
                    <details className="group">
                      <summary className="text-[10px] text-zinc-600 cursor-pointer hover:text-zinc-400 transition-colors flex items-center gap-1">
                        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                        Legacy Auto-Scan (slow, client-side)
                      </summary>
                      <div className="mt-3 space-y-3 pt-3 border-t border-zinc-800/40">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">Client-side scan</span>
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Info className="h-3 w-3 text-zinc-600" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs max-w-xs">
                                  Old method: generates wallets one-by-one with per-wallet HTTP requests. Very slow (~1 wallet/min). Use Turbo Scan above instead.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <Button
                            onClick={handleAutoScan}
                            variant={autoScanActive ? 'destructive' : 'outline'}
                            size="sm"
                            className={`text-xs h-7 gap-1.5 ${
                              !autoScanActive ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-800' : ''
                            }`}
                          >
                            {autoScanActive ? (
                              <><StopCircle className="h-3 w-3" /> Stop</>
                            ) : (
                              <><Zap className="h-3 w-3" /> Start</>
                            )}
                          </Button>
                        </div>
                        {autoScanActive && (
                          <div className="flex items-center gap-3 text-[10px] text-zinc-500 flex-wrap">
                            <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 bg-cyan-500/10 text-[8px] animate-pulse">
                              <Activity className="h-2 w-2 mr-1" />
                              Scanning
                            </Badge>
                            <span>Checked: <span className="text-zinc-300 font-mono">{autoScanCount}</span></span>
                            <span>Found: <span className="text-emerald-400 font-mono">{autoScanFound.length}</span></span>
                            {autoScanElapsed > 0 && <span>{formatTime(autoScanElapsed)}</span>}
                          </div>
                        )}
                        {autoScanFound.length > 0 && (
                          <div className="space-y-1.5 max-h-32 overflow-y-auto">
                            {autoScanFound.map((found, i) => (
                              <div key={i} className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/20 rounded-md px-2 py-1.5 text-[10px]">
                                <Badge variant="outline" className="text-[8px] h-4 border-emerald-500/30 text-emerald-400">
                                  {found.blockchain.toUpperCase()}
                                </Badge>
                                <span className="text-emerald-300 font-mono truncate flex-1">{found.address}</span>
                                <span className="text-emerald-400 font-mono">{found.balance}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </details>
                  </div>

                  {/* Generated Seed Phrase */}
                  {generatedMnemonic && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                      <div className="border border-emerald-500/20 rounded-xl p-4 bg-emerald-500/5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Key className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="text-xs font-medium text-emerald-400">Generated Seed Phrase</span>
                            <Badge variant="outline" className="text-[9px] h-4 border-zinc-700 text-zinc-500">
                              {walletWordCount} words
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCopyMnemonic}
                            className="h-6 text-[10px] text-zinc-400 hover:text-emerald-400 gap-1"
                          >
                            <Copy className="h-3 w-3" />
                            Copy
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                          {generatedMnemonic.split(' ').map((word, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: i * 0.03, duration: 0.2 }}
                              className="flex items-center gap-1 bg-zinc-800/80 border border-zinc-700/60 rounded-md px-2 py-1.5 group hover:border-emerald-500/40 transition-colors"
                            >
                              <span className="text-[9px] font-bold text-zinc-600 w-4 shrink-0">{i + 1}</span>
                              <span className="text-xs font-mono text-emerald-300 truncate">{word}</span>
                            </motion.div>
                          ))}
                        </div>
                        <p className="text-[10px] text-amber-500/80 mt-2 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Store this seed phrase securely. Never share it with anyone.
                        </p>
                      </div>

                      {/* Recover this wallet button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRecoverWallet(derivedAddresses.length > 0 ? derivedAddresses[0].blockchain : 'eth')}
                        className="w-full h-9 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 gap-1.5"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Recover this wallet
                      </Button>

                      {/* Derived Addresses */}
                      {derivedAddresses.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                              <Fingerprint className="h-3.5 w-3.5 text-cyan-400" />
                              Derived Addresses
                            </h4>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyAllAddresses}
                                disabled={derivedAddresses.length === 0}
                                className="h-7 text-[10px] border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 gap-1"
                              >
                                <Copy className="h-3 w-3" />
                                Copy All
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCheckBalances}
                                disabled={isCheckingBalances}
                                className="h-7 text-[10px] border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 gap-1"
                              >
                                {isCheckingBalances ? (
                                  <><Loader2 className="h-3 w-3 animate-spin" /> Checking...</>
                                ) : (
                                  <><Search className="h-3 w-3" /> Check Balances</>
                                )}
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {derivedAddresses.map((addr, idx) => {
                              const balanceInfo = walletBalances[addr.address]
                              const chainConfig = BLOCKCHAIN_CONFIG[addr.blockchain]
                              const borderColor = addr.blockchain === 'btc' ? 'border-l-orange-500' : addr.blockchain === 'eth' ? 'border-l-emerald-500' : addr.blockchain === 'sol' ? 'border-l-cyan-500' : 'border-l-teal-500'
                              const hoverBorderColor = addr.blockchain === 'btc' ? 'hover:border-orange-500/40' : addr.blockchain === 'eth' ? 'hover:border-emerald-500/40' : addr.blockchain === 'sol' ? 'hover:border-cyan-500/40' : 'hover:border-teal-500/40'
                              const hasBalance = balanceInfo && parseFloat(balanceInfo.balance) > 0
                              return (
                                <Card key={idx} className={`bg-zinc-900/40 border-zinc-800/50 border-l-2 ${borderColor} ${hoverBorderColor} hover:scale-[1.01] transition-all duration-200 overflow-hidden relative`}>
                                  <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${
                                    addr.blockchain === 'btc' ? 'from-orange-500 to-orange-400' :
                                    addr.blockchain === 'eth' ? 'from-emerald-500 to-emerald-400' :
                                    addr.blockchain === 'sol' ? 'from-cyan-500 to-cyan-400' :
                                    'from-teal-500 to-teal-400'
                                  }`} />
                                  <CardContent className="p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-lg">{chainConfig?.icon}</span>
                                        <div>
                                          <p className="text-xs font-medium text-zinc-300">{chainConfig?.name}</p>
                                          <p className="text-[9px] text-zinc-600">{addr.label}</p>
                                        </div>
                                      </div>
                                      {balanceInfo && (
                                        <Badge
                                          variant="outline"
                                          className={`text-[9px] h-5 ${
                                            hasBalance
                                              ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                                              : 'border-zinc-700 text-zinc-500'
                                          }`}
                                        >
                                          {hasBalance ? (
                                            <><Zap className="h-2.5 w-2.5 mr-0.5" />{balanceInfo.balance} {balanceInfo.symbol}</>
                                          ) : (
                                            '0 ' + balanceInfo.symbol
                                          )}
                                        </Badge>
                                      )}
                                    </div>
                                    {/* Address */}
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-medium">Address</span>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleCopyAddress(addr.address)}
                                          className="h-4 text-[9px] text-zinc-600 hover:text-emerald-400 px-1"
                                        >
                                          <Copy className="h-2.5 w-2.5" />
                                        </Button>
                                      </div>
                                      <p className={`text-[10px] font-mono break-all leading-tight ${hasBalance ? 'text-emerald-400' : 'text-zinc-400'}`}>{addr.address}</p>
                                    </div>
                                    {/* Private Key */}
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-medium">Private Key</span>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleTogglePrivateKey(idx)}
                                            className="h-4 text-[9px] text-zinc-600 hover:text-amber-400 px-1"
                                          >
                                            {visiblePrivateKeys.has(idx) ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                                          </Button>
                                          {visiblePrivateKeys.has(idx) && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleCopyPrivateKey(addr.privateKey)}
                                              className="h-4 text-[9px] text-zinc-600 hover:text-emerald-400 px-1"
                                            >
                                              <Copy className="h-2.5 w-2.5" />
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                      {visiblePrivateKeys.has(idx) ? (
                                        <p className="text-[10px] font-mono text-amber-400/80 break-all leading-tight select-all">{addr.privateKey}</p>
                                      ) : (
                                        <p className="text-[10px] font-mono text-zinc-600">••••••••••••••••••••••••</p>
                                      )}
                                    </div>
                                    {/* Derivation path */}
                                    <div className="flex items-center gap-1.5">
                                      <Route className="h-2.5 w-2.5 text-zinc-600" />
                                      <span className="text-[9px] font-mono text-zinc-600">{addr.derivationPath}</span>
                                    </div>
                                  </CardContent>
                                </Card>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </CardContent>
              </Card>

              {/* Wallet Stats Bar */}
              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-zinc-900/30 border border-zinc-800/40">
                  <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <Wallet className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500">Wallets Generated</p>
                    <p className="text-sm font-semibold text-zinc-200 font-mono">{walletsGenerated}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-zinc-900/30 border border-zinc-800/40">
                  <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <Globe className="h-3.5 w-3.5 text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500">Active Chains</p>
                    <p className="text-sm font-semibold text-zinc-200">
                      {derivedAddresses.length > 0
                        ? [...new Set(derivedAddresses.map(a => a.blockchain))].map(b => BLOCKCHAIN_CONFIG[b as Blockchain]?.symbol).join(' / ')
                        : '—'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-zinc-900/30 border border-zinc-800/40">
                  <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500">Last Generated</p>
                    <p className="text-sm font-semibold text-zinc-200">
                      {lastGeneratedAt
                        ? new Date(lastGeneratedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Keyboard Shortcuts Dialog ── */}
        <Dialog open={showShortcutsDialog} onOpenChange={setShowShortcutsDialog}>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <Command className="h-4 w-4 text-cyan-400" />
                Keyboard Shortcuts
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-500">
                Use these shortcuts for faster navigation and actions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {[
                { keys: ['Ctrl', '1'], desc: 'Switch to Recovery tab' },
                { keys: ['Ctrl', '2'], desc: 'Switch to Quick Verify tab' },
                { keys: ['Ctrl', '3'], desc: 'Switch to History tab' },
                { keys: ['Ctrl', '4'], desc: 'Switch to Word List tab' },
                { keys: ['Ctrl', '5'], desc: 'Switch to Wallet tab' },
                { keys: ['Ctrl', 'Enter'], desc: 'Start recovery (Recovery tab)' },
                { keys: ['Ctrl', 'Shift', 'V'], desc: 'Open paste dialog (Recovery tab)' },
              ].map((shortcut) => (
                <div key={shortcut.keys.join('+')} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">{shortcut.desc}</span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, i) => (
                      <span key={i}>
                        <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                          {key}
                        </kbd>
                        {i < shortcut.keys.length - 1 && (
                          <span className="text-zinc-600 mx-0.5">+</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-400 hover:text-zinc-300"
                onClick={() => setShowShortcutsDialog(false)}
              >
                Got it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Paste Seed Phrase Dialog ── */}
        <Dialog open={showPasteDialog} onOpenChange={(open) => {
          setShowPasteDialog(open)
          if (!open) setPasteText('')
        }}>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
            >
              <DialogHeader>
                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                  <ClipboardPaste className="h-4 w-4 text-cyan-400" />
                  Paste Seed Phrase
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-500">
                  Paste a space-separated seed phrase (12 or 24 words). Words not in the BIP39 wordlist will be automatically marked as unknown.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="abandon ability able about above absent absorb abstract absurd abuse access accident..."
                  className="min-h-[100px] bg-zinc-800/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-sm font-mono focus-visible:border-cyan-500/50 focus-visible:ring-cyan-500/20 resize-none"
                />
                {pasteText.trim() && (
                  <div className="flex items-center gap-3 text-[10px]">
                    {(() => {
                      const words = pasteText.trim().split(/[\s\n]+/).filter(w => w.length > 0)
                      const recognized = words.filter(w => wordlist.includes(w.toLowerCase())).length
                      const unrecognized = words.length - recognized
                      return (
                        <>
                          <Badge
                            variant="outline"
                            className={`text-[9px] h-5 ${
                              words.length === 12 || words.length === 24
                                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                                : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                            }`}
                          >
                            {words.length} words
                          </Badge>
                          {recognized > 0 && (
                            <Badge variant="outline" className="text-[9px] h-5 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                              {recognized} recognized
                            </Badge>
                          )}
                          {unrecognized > 0 && (
                            <Badge variant="outline" className="text-[9px] h-5 border-amber-500/30 text-amber-400 bg-amber-500/10">
                              <EyeOff className="h-2.5 w-2.5 mr-0.5" />
                              {unrecognized} unknown
                            </Badge>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-zinc-400 hover:text-zinc-300"
                  onClick={() => {
                    setShowPasteDialog(false)
                    setPasteText('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white border-0"
                  onClick={handlePasteSeedPhrase}
                  disabled={!pasteText.trim()}
                >
                  <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
                  Fill Words
                </Button>
              </DialogFooter>
            </motion.div>
          </DialogContent>
        </Dialog>

        {/* ── FAQ Section ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold">Frequently Asked Questions</h2>
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
              question="Does this tool support 24-word seed phrases?"
              answer="Yes! You can toggle between 12-word and 24-word seed phrases using the switch above the word inputs. 24-word phrases provide stronger security (256-bit entropy vs 128-bit) but require at least 16 known words for practical recovery."
            />
            <FaqItem
              question="What is the export feature?"
              answer="After a successful recovery, you can export the result as a text file. The file includes the recovered seed phrase, blockchain, derivation path, and timestamp. We strongly recommend deleting this file after securely storing your seed phrase offline."
            />
          </div>
        </section>

        {/* ── Important Notice ── */}
        <section>
          <Card className="bg-amber-950/10 border-amber-500/15">
            <CardContent className="flex gap-3 px-4 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-400/80 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-amber-300/90">Important Notice</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  This tool is designed <strong className="text-amber-300/80">exclusively</strong> for
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
      <footer className="mt-auto border-t border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-4">
          {/* Top row: Logo, security badges, links */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center h-7 w-7 rounded-md bg-gradient-to-br from-emerald-500/15 to-cyan-500/15 border border-emerald-500/20">
                <Shield className="h-3.5 w-3.5 text-emerald-400/80" />
              </div>
              <div>
                <span className="text-[11px] font-semibold text-zinc-400">
                  Crypto<span className="text-emerald-400/70">Recover</span>
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="outline" className="text-[7px] h-3.5 px-1.5 border-emerald-500/20 text-emerald-500/60 bg-emerald-500/5">
                    v2.2
                  </Badge>
                  <span className="text-[8px] text-zinc-700">
                    &copy; {new Date().getFullYear()}
                  </span>
                </div>
              </div>
            </div>
            {/* Security badges */}
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              {[
                { icon: <Server className="h-2.5 w-2.5" />, label: 'No Server Storage', color: 'emerald' },
                { icon: <Lock className="h-2.5 w-2.5" />, label: 'Zero-Knowledge', color: 'cyan' },
                { icon: <BookOpen className="h-2.5 w-2.5" />, label: 'Powered by BIP39', color: 'teal' },
                { icon: <Shield className="h-2.5 w-2.5" />, label: 'Self-Recovery Only', color: 'amber' },
              ].map((badge) => (
                <span
                  key={badge.label}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-${badge.color}-500/5 border border-${badge.color}-500/15 text-[8px] text-${badge.color}-400/70 hover:bg-${badge.color}-500/10 transition-colors duration-200`}
                >
                  {badge.icon}
                  {badge.label}
                </span>
              ))}
            </div>
            {/* External links */}
            <div className="flex items-center gap-3">
              <span className="text-[9px] text-zinc-600 hover:text-zinc-400 cursor-default transition-colors flex items-center gap-1">
                <Github className="h-3 w-3" />
                Contribute
              </span>
              <span className="text-[9px] text-zinc-800">|</span>
              <span className="text-[9px] text-zinc-600 hover:text-zinc-400 cursor-default transition-colors flex items-center gap-1">
                <ExternalLink className="h-2.5 w-2.5" />
                BIP39 Spec
              </span>
            </div>
          </div>
          {/* Bottom row: Disclaimer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-zinc-800/20">
            <p className="text-[9px] text-amber-500/40 text-center sm:text-left flex items-center gap-1">
              <Shield className="h-2.5 w-2.5" />
              Built for legitimate self-recovery only. Requires proof of wallet ownership via known address.
            </p>
            <p className="text-[9px] text-zinc-800 text-center sm:text-right flex items-center gap-1">
              <span className="inline-block h-1 w-1 rounded-full bg-emerald-500/30" />
              All data purged after session ends
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
