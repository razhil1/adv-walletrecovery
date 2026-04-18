export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header skeleton */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 animate-pulse" />
          <div>
            <div className="h-5 w-32 bg-muted rounded animate-pulse" />
            <div className="h-2.5 w-40 bg-muted/50 rounded mt-1 animate-pulse" />
          </div>
        </div>
      </header>

      {/* Main content skeleton */}
      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 w-full">
        {/* Hero skeleton */}
        <div className="text-center space-y-3 mb-6">
          <div className="h-5 w-48 bg-muted/50 rounded mx-auto animate-pulse" />
          <div className="h-8 w-80 bg-muted rounded mx-auto animate-pulse" />
          <div className="h-4 w-96 bg-muted/50 rounded mx-auto animate-pulse" />
        </div>

        {/* Step cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted/20 border border-border/30 rounded-xl animate-pulse" />
          ))}
        </div>

        {/* Stats skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-muted/20 border border-border/30 rounded-lg animate-pulse" />
          ))}
        </div>

        {/* Main card skeleton */}
        <div className="h-96 bg-muted/20 border border-border/30 rounded-xl animate-pulse" />

        {/* Config card skeleton */}
        <div className="h-64 bg-muted/20 border border-border/30 rounded-xl animate-pulse" />

        {/* Loading text */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground animate-pulse">
            Loading CryptoRecover...
          </p>
        </div>
      </main>
    </div>
  )
}
