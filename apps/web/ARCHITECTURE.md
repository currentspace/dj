# Web app architecture

## Folder layout

```
src/
├── App.tsx               # Root component
├── main.tsx              # Entry point
├── components/
│   └── ui/               # Truly shared, presentation-only primitives.
│                         # No feature knowledge. Examples: ErrorBoundary,
│                         # LoadingSpinner, BuildInfo, UpdateBanner,
│                         # AutoFillToggle, PlaylistSkeleton, ErrorDisplay.
├── features/             # Feature modules. One folder per domain.
│   ├── auth/             # Spotify OAuth flow + UI
│   ├── debug/            # Debug panel
│   ├── dj/               # Always-on DJ session UI
│   ├── mix/              # Queue, suggestions, steer progress
│   └── playback/         # Device picker, playback controls
├── hooks/
│   ├── queries/          # React Query queries + mutations (server state)
│   └── *.ts              # Generic / cross-cutting hooks
├── lib/                  # API clients and pure utilities
├── stores/               # Zustand stores (client / UI state only)
├── styles/               # Global CSS
└── types/                # Cross-feature type aliases
```

## Conventions

**Features over file types.** New components belong in `features/<domain>/`. The
old atomic-design folders (`atoms/`, `molecules/`, `organisms/`, `templates/`,
`pages/`) have been removed; only `components/ui/` remains for primitives that
are genuinely shared across features.

**Stores vs queries.** Zustand holds client/UI state and SSE-driven realtime
state. Anything fetched via REST belongs in `hooks/queries/` (React Query).
Server-state mutations should not live in Zustand actions.

**No `useEffect`.** React 19.2 lets us derive state in the component body.
First-render-only patterns use `if (!ref.current) { ... }` with a documented
`/* eslint-disable react-hooks/refs */` comment naming the intent.

**Forms.** Prefer React 19's `<form action={fn}>` with `useActionState` over
controlled-input + `onSubmit` for new forms.

**CSS modules** live next to their component (e.g. `QueuePanel.tsx` +
`queue-panel.module.css`). Cross-feature shared CSS goes in `features/mix/mix-shared.module.css`
or similar — never in a top-level `templates/` folder.
