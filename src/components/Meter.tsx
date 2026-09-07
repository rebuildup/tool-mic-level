"use client";

import { useEffect, useMemo, useRef } from "react";
import { classifyZone, dbfsToBar, MAX_DBFS, MIN_DBFS } from "../lib/audio-math";

/**
 * OBS-style horizontal level meter. The fill ratio + the "Peak Hold"
 * marker are mutated directly on the DOM via refs, so the React tree
 * does not re-render at frame rate.
 *
 * The numeric labels (Peak / RMS / Peak Hold) and zone label update on
 * a throttled cadence through React state (see `MicLevelClient`).
 */
export interface MeterProps {
	peakDbfs: number;
	rmsDbfs: number;
	peakHoldDbfs: number;
}

const ZONE_BOUNDARIES: Array<{ dbfs: number; label: string }> = [
	{ dbfs: 0, label: "0" },
	{ dbfs: -9, label: "-9" },
	{ dbfs: -20, label: "-20" },
	{ dbfs: -30, label: "-30" },
	{ dbfs: -40, label: "-40" },
	{ dbfs: -50, label: "-50" },
	{ dbfs: -60, label: "-60" },
];

function zoneFillClass(zone: ReturnType<typeof classifyZone>["zone"]): string {
	switch (zone) {
		case "CLIP":
			return "bg-red-700";
		case "RED":
			return "bg-red-500";
		case "YELLOW":
			return "bg-yellow-400";
		case "GREEN":
			return "bg-green-500";
		case "DARK_GREEN":
		default:
			return "bg-green-700";
	}
}

export default function Meter({ peakDbfs, rmsDbfs, peakHoldDbfs }: MeterProps) {
	const fillRef = useRef<HTMLDivElement>(null);
	const holdRef = useRef<HTMLDivElement>(null);
	const zone = useMemo(() => classifyZone(peakDbfs), [peakDbfs]);
	const fillRatio = useMemo(() => dbfsToBar(peakDbfs), [peakDbfs]);
	const holdRatio = useMemo(() => dbfsToBar(peakHoldDbfs), [peakHoldDbfs]);
	const reducedMotion = useRef(false);

	useEffect(() => {
		if (typeof window === "undefined") return;
		reducedMotion.current = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
	}, []);

	useEffect(() => {
		const fill = fillRef.current;
		const hold = holdRef.current;
		if (!fill || !hold) return;
		const fillPct = `${(fillRatio * 100).toFixed(2)}%`;
		fill.style.transform = `scaleX(${fillRatio})`;
		fill.style.width = "100%";
		// also set width on a child for accessibility (transform-only hides
		// the element from screen-reader width calculations on some engines)
		fill.setAttribute("aria-valuenow", String(Math.round(fillRatio * 100)));
		hold.style.transform = `translateX(${(holdRatio * 100).toFixed(2)}%)`;
		void fillPct; // referenced for debugging
	}, [fillRatio, holdRatio]);

	return (
		<div className="space-y-2" aria-label="マイク入力レベルメーター">
			<div
				className="relative h-8 w-full rounded-md border border-neutral-400 bg-neutral-200 overflow-hidden"
				role="meter"
				aria-valuemin={MIN_DBFS}
				aria-valuemax={MAX_DBFS}
				aria-valuenow={Number.isFinite(peakDbfs) ? peakDbfs : MIN_DBFS}
				aria-label={`現在のピーク ${peakDbfs.toFixed(1)} dBFS`}
			>
				{/* zone background bands for the OBS style */}
				<div className="absolute inset-0 flex" aria-hidden="true">
					<div
						className="h-full bg-green-700/60"
						style={{
							width: `${((MAX_DBFS - MIN_DBFS - (MAX_DBFS - -50)) / (MAX_DBFS - MIN_DBFS)) * 100}%`,
						}}
					/>
					<div
						className="h-full bg-green-500/60"
						style={{ width: `${((-50 - -20) / (MAX_DBFS - MIN_DBFS)) * 100}%` }}
					/>
					<div
						className="h-full bg-yellow-400/60"
						style={{ width: `${((-20 - -9) / (MAX_DBFS - MIN_DBFS)) * 100}%` }}
					/>
					<div
						className="h-full bg-red-500/60"
						style={{ width: `${((-9 - -0.5) / (MAX_DBFS - MIN_DBFS)) * 100}%` }}
					/>
					<div
						className="h-full bg-red-700/60"
						style={{
							width: `${((-0.5 - MIN_DBFS) / (MAX_DBFS - MIN_DBFS)) * 100}%`,
						}}
					/>
				</div>

				{/* active fill - mutated directly via ref */}
				<div
					ref={fillRef}
					className={`absolute inset-y-0 left-0 origin-left ${zoneFillClass(zone.zone)} ${
						reducedMotion.current ? "" : "transition-transform duration-75"
					}`}
					style={{ transform: "scaleX(0)" }}
					aria-hidden="true"
				/>

				{/* peak hold marker */}
				<div
					ref={holdRef}
					className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_2px_rgba(0,0,0,0.6)]"
					style={{ left: 0 }}
					aria-hidden="true"
				/>
			</div>

			{/* numeric labels + tick marks */}
			<div className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
				<div className="rounded-md border border-neutral-300 bg-white px-2 py-1">
					<div className="text-[10px] uppercase tracking-wide text-neutral-500">
						Peak
					</div>
					<div className="font-mono tabular-nums">
						{Number.isFinite(peakDbfs) ? `${peakDbfs.toFixed(1)}` : "−∞"}
						<span className="ml-1 text-neutral-500">dBFS</span>
					</div>
				</div>
				<div className="rounded-md border border-neutral-300 bg-white px-2 py-1">
					<div className="text-[10px] uppercase tracking-wide text-neutral-500">
						RMS
					</div>
					<div className="font-mono tabular-nums">
						{Number.isFinite(rmsDbfs) ? `${rmsDbfs.toFixed(1)}` : "−∞"}
						<span className="ml-1 text-neutral-500">dBFS</span>
					</div>
				</div>
				<div className="rounded-md border border-neutral-300 bg-white px-2 py-1">
					<div className="text-[10px] uppercase tracking-wide text-neutral-500">
						Hold
					</div>
					<div className="font-mono tabular-nums">
						{Number.isFinite(peakHoldDbfs)
							? `${peakHoldDbfs.toFixed(1)}`
							: "−∞"}
						<span className="ml-1 text-neutral-500">dBFS</span>
					</div>
				</div>
			</div>

			{/* dBFS tick scale */}
			<div
				className="relative h-4 text-[10px] text-neutral-600"
				aria-hidden="true"
			>
				{ZONE_BOUNDARIES.map((tick) => {
					const left = dbfsToBar(tick.dbfs) * 100;
					return (
						<div
							key={tick.dbfs}
							className="absolute -translate-x-1/2 flex flex-col items-center"
							style={{ left: `${left}%` }}
						>
							<div className="h-1.5 w-px bg-neutral-500" />
							<div className="leading-none">{tick.label}</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
