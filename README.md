# rebuildup/tool-mic-level

Standalone Mic Level Checker tool. Browser-only microphone level meter
that mirrors the OBS Audio Mixer zone layout (-50 / -20 / -9 / -0.5
dBFS) and runs a 5-second speech check to recommend a +/- dB gain delta
toward -14 dBFS.

Privacy-first: audio never leaves the browser. No recording, no upload,
no fetch / XHR / sendBeacon for audio data. All analysis happens in the
page via the Web Audio API and `getUserMedia`.

## Embed (my-web-2025)

```tsx
// src/app/tools/mic-level/page.tsx
"use client";
import dynamic from "next/dynamic";
const App = dynamic(() => import("../../../../external/mic-level/src"), { ssr: false });
export default function MicLevelPage() { return <App />; }
```

## Local dev

```
bun install
bun run dev
```

## Tests

```
bun run test
```
