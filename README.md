# rebuildup/tool-mic-level

Standalone Mic Level Checker tool. Browser-only microphone level meter
that mirrors the OBS Audio Mixer zone layout (-50 / -20 / -9 / -0.5
dBFS) and runs a 5-second speech check to recommend a +/- dB gain delta
toward -14 dBFS.

Privacy-first: audio never leaves the browser. No recording, no upload,
no fetch / XHR / sendBeacon for audio data. All analysis happens in the
page via the Web Audio API and `getUserMedia`.

## Standalone build (embeddable static SPA)

The Tool builds a self-contained static bundle that a host can serve from
its own origin and frame in a sandboxed iframe:

```
bun install --frozen-lockfile
bun run build      # -> dist/ (index.html + assets/*)
bun run preview    # local preview of the built artefact
```

`vite.config.ts` uses `base: "./"`, so every asset reference in
`dist/index.html` is relative (`./assets/...`) and the bundle works under
any host path (e.g. `/tools/mic-level/app/`).

The standalone face is `index.html` + `src/main.tsx` + `vite.config.ts`.
The library face (`src/index.tsx`) is still exported for hosts that import
the source package directly.

## Microphone permission behaviour

`getUserMedia` needs a secure context and a Permissions Policy that
allows the `microphone` feature. When the request is refused (the user
denied it, or the frame is sandboxed / cross-origin without
`allow="microphone"`), the Tool:

- catches the rejection (no unhandled promise rejection),
- shows "マイクを使用できません" plus a short reason,
- keeps the rest of the surface usable and lets the user retry.

The Tool never fakes or auto-bypasses a permission decision.

## Embed (my-web-2025)

```tsx
// src/app/tools/mic-level/page.tsx
"use client";
import dynamic from "next/dynamic";
const App = dynamic(() => import("../../../../external/mic-level/src"), { ssr: false });
export default function MicLevelPage() { return <App />; }
```

The standalone build is the recommended embedding path for hosts that
frame the Tool as a `same_origin_static` artefact.

## Local dev

```
bun install
bun run dev
```

## Tests

```
bun run test
```
