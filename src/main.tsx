import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MicLevelApp from "./App";

/**
 * Standalone entry point.
 *
 * The Tool ships two faces on purpose:
 *
 *   - the library face (`src/index.tsx` → `<MicLevelApp />`), which the
 *     host may import as a source package;
 *   - the standalone face (this file + `index.html` + `vite.config.ts`),
 *     which builds a self-contained static bundle a host can serve from
 *     its own origin and frame in a sandboxed iframe.
 *
 * The host never imports this file: it consumes the built artefact.
 */
const container = document.getElementById("root");
if (!container) {
	throw new Error(
		"standalone build: #root container is missing from index.html",
	);
}

createRoot(container).render(
	<StrictMode>
		<MicLevelApp />
	</StrictMode>,
);
