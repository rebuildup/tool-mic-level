import {
	type CheckSummary,
	formatDbfs,
	recommendedGainText,
	statusAction,
	statusLabel,
} from "../lib/audio-math";

export interface CheckResultProps {
	summary: CheckSummary | null;
}

/**
 * Result panel rendered after a 5-second check completes. Shows the
 * high-level status (Japanese label), representative p95 peak, max peak,
 * average RMS, recommended gain delta, and a one-line next action.
 *
 * Pure presentation; the parent owns the CheckSummary state.
 */
export default function CheckResult({ summary }: CheckResultProps) {
	if (!summary) return null;
	const gainText = recommendedGainText(summary.p95PeakDbfs);
	const isOk = summary.status === "ok";
	const toneClasses = (() => {
		switch (summary.status) {
			case "clipping":
				return "border-red-700 bg-red-50 text-red-900";
			case "too_loud":
				return "border-red-400 bg-red-50 text-red-800";
			case "ok":
				return "border-green-500 bg-green-50 text-green-900";
			case "too_quiet":
				return "border-yellow-500 bg-yellow-50 text-yellow-900";
			default:
				return "border-neutral-300 bg-neutral-50 text-neutral-800";
		}
	})();

	return (
		<section
			aria-live="polite"
			className={`rounded-md border p-4 ${toneClasses}`}
		>
			<header className="flex items-baseline justify-between gap-2">
				<h2 className="text-lg font-semibold">判定</h2>
				<span className="text-xs text-neutral-600">
					発話フレーム {summary.speechFrameCount} / {summary.totalFrameCount}
				</span>
			</header>
			<p
				className="mt-1 text-base font-semibold"
				data-testid="mic-status-label"
			>
				{statusLabel(summary.status)}
			</p>
			<p className="mt-1 text-sm">{statusAction(summary.status)}</p>

			<dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
				<div className="rounded-md bg-white/70 px-2 py-1">
					<dt className="text-[10px] uppercase tracking-wide text-neutral-500">
						発話中 P95 Peak
					</dt>
					<dd className="font-mono tabular-nums">
						{formatDbfs(summary.p95PeakDbfs)}
					</dd>
				</div>
				<div className="rounded-md bg-white/70 px-2 py-1">
					<dt className="text-[10px] uppercase tracking-wide text-neutral-500">
						最大 Peak
					</dt>
					<dd className="font-mono tabular-nums">
						{formatDbfs(summary.maxPeakDbfs)}
					</dd>
				</div>
				<div className="rounded-md bg-white/70 px-2 py-1">
					<dt className="text-[10px] uppercase tracking-wide text-neutral-500">
						平均 RMS
					</dt>
					<dd className="font-mono tabular-nums">
						{formatDbfs(summary.avgRmsDbfs)}
					</dd>
				</div>
				<div className="rounded-md bg-white/70 px-2 py-1">
					<dt className="text-[10px] uppercase tracking-wide text-neutral-500">
						推奨ゲイン変更
					</dt>
					<dd className="font-mono tabular-nums">
						{gainText ?? `${isOk ? "適正" : "—"} (-14 dBFS を目標)`}
					</dd>
				</div>
			</dl>
		</section>
	);
}
