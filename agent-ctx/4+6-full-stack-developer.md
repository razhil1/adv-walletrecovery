# Task 4+6: Frontend Enhancements - Auto-Retry, Real-Time Timer, Styling

## Work Log
- Updated RecoveryJob interface with 5 new optional fields: currentPathIndex, triedPaths, pathSwitchAt, autoRetry, validCombinationsEstimate
- Added autoRetry state (default true), liveElapsedSeconds state, searchingDots animation state, and prevPathIndexRef ref
- Added Auto-Retry Toggle in Configuration card with Switch, label, description, and info tooltip
- Updated handleStartRecovery to append ?autoRetry=true to POST URL when toggle is enabled
- Added real-time elapsed timer with useEffect/setInterval updating liveElapsedSeconds every second
- Added searching dots animation (".", "..", "...") cycling every 500ms in progress card title
- Added path switch toast notification detecting currentPathIndex changes
- Enhanced progress section with current path label, path progress indicators (dots), tried paths list, pulsing green dot
- Added valid combinations indicator (BIP39 filter ~6.25%) after estimated search time
- Added section number badges (①②③) on step cards and card headers
- Added gradient divider line between steps and content
- Improved Start Recovery button with glow animation (animate-pulse overlay when ready)
- Improved History tab empty state with illustration-like icon and descriptive text
- Enhanced footer with version badge, security links
- Added mobile responsiveness: text-center sm:text-left on labels, w-full on derivation path Select
- Lint: ✅ Clean

## Stage Summary
- All Task 1 (auto-retry toggle, path switch notification, real-time timer, valid combinations) and Task 2 (styling improvements) completed
- Page renders correctly, lint passes clean
