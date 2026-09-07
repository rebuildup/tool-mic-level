/**
 * Pure audio math helpers for the Mic Level Checker.
 *
 * All functions in this file are deterministic, side-effect free, and
 * independent of any browser API. They are unit tested in
 * `__tests__/audio-math.test.ts` so the meter / 5s check logic stays
 * independent from React state.
 *
 * The numeric ranges follow the OBS Audio Mixer conventions:
 *   -60 dBFS = effectively silent floor
 *     0 dBFS = digital full-scale (clipping)
 *   OBS zones (https://obsproject.com/kb/audio-mixer-technical-details):
 *     < -50         dark green
 *     -50 .. -20    green
 *     -20 .. -9     yellow  (target zone for normal speech)
 *      -9 .. -0.5   red
 *      > -0.5       clipping
 */

export const MIN_DBFS = -60;
export const MAX_DBFS = 0;
export const TARGET_DBFS = -14; // centre of yellow zone

export const OBS_ZONES = {
	DARK_GREEN: { min: -Infinity, max: -50, label: "dark green", tone: "ok" },
	GREEN: { min: -50, max: -20, label: "green", tone: "ok" },
	YELLOW: { min: -20, max: -9, label: "yellow", tone: "target" },
	RED: { min: -9, max: -0.5, label: "red", tone: "warn" },
	CLIP: { min: -0.5, max: Infinity, label: "clipping", tone: "danger" },
} as const;

export type ZoneTone = (typeof OBS_ZONES)[keyof typeof OBS_ZONES]["tone"];

export type ZoneId = keyof typeof OBS_ZONES;

export type MicStatus =
	| "too_quiet"
	| "ok"
	| "too_loud"
	| "clipping"
	| "no_speech";

export interface ZoneClassification {
	zone: ZoneId;
	label: string;
	tone: ZoneTone;
}

export interface CheckSummary {
	p95PeakDbfs: number;
	maxPeakDbfs: number;
	avgRmsDbfs: number;
	speechFrameCount: number;
	totalFrameCount: number;
	status: MicStatus;
	recommendedGainDb: number;
	clipDetected: boolean;
}

/**
 * Convert a linear sample in [0, 1] to dBFS, returning -Infinity when
 * the value is zero so callers can render an explicit "silent" label
 * instead of `NaN` / `-Infinity`.
 */
export function linearToDbfs(linear: number): number {
	if (!Number.isFinite(linear) || linear <= 0) return Number.NEGATIVE_INFINITY;
	const dbfs = 20 * Math.log10(linear);
	return dbfs;
}

/**
 * Peak amplitude over a PCM Float32 frame buffer (absolute max).
 * Returns 0 for an empty buffer.
 */
export function peakPcm(samples: Float32Array): number {
	let peak = 0;
	for (let i = 0; i < samples.length; i++) {
		const v = samples[i];
		const abs = v < 0 ? -v : v;
		if (abs > peak) peak = abs;
	}
	return peak;
}

/**
 * Root-mean-square amplitude over a PCM Float32 frame buffer.
 * Returns 0 for an empty buffer.
 */
export function rmsPcm(samples: Float32Array): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < samples.length; i++) {
		const v = samples[i];
		sum += v * v;
	}
	return Math.sqrt(sum / samples.length);
}

/**
 * Compute peak + RMS dBFS in a single pass over the PCM frame.
 */
export function measureFrame(samples: Float32Array): {
	peakDbfs: number;
	rmsDbfs: number;
} {
	const peak = peakPcm(samples);
	const rms = rmsPcm(samples);
	return {
		peakDbfs: clampDbfs(linearToDbfs(peak)),
		rmsDbfs: clampDbfs(linearToDbfs(rms)),
	};
}

/**
 * Clamp very small values to the silent floor so the UI shows a stable
 * "-60 dBFS" baseline instead of -Infinity.
 */
export function clampDbfs(dbfs: number, floor = MIN_DBFS): number {
	if (!Number.isFinite(dbfs)) return floor;
	if (dbfs < floor) return floor;
	if (dbfs > MAX_DBFS) return MAX_DBFS;
	return dbfs;
}

/**
 * Classify a dBFS reading into one of the OBS zones.
 *
 * The OBS spec assigns inclusive boundaries to the more intense zone,
 * so boundary values (-9, -20, -50, -0.5) map upward:
 *   -0.4  -> CLIP   (-0.5 is the red upper bound)
 *   -0.5  -> RED
 *    -3   -> RED
 *    -9   -> RED    (boundary moves into red)
 *   -9.001-> YELLOW
 *   -19.999-> YELLOW
 *   -20  -> YELLOW  (boundary moves into yellow)
 *   -49  -> GREEN
 *   -50  -> GREEN   (boundary moves into green)
 *   -60  -> DARK_GREEN
 */
export function classifyZone(dbfs: number): ZoneClassification {
	if (!Number.isFinite(dbfs)) {
		return {
			zone: "DARK_GREEN",
			label: OBS_ZONES.DARK_GREEN.label,
			tone: OBS_ZONES.DARK_GREEN.tone,
		};
	}
	if (dbfs > -0.5) {
		return {
			zone: "CLIP",
			label: OBS_ZONES.CLIP.label,
			tone: OBS_ZONES.CLIP.tone,
		};
	}
	if (dbfs >= -9) {
		return {
			zone: "RED",
			label: OBS_ZONES.RED.label,
			tone: OBS_ZONES.RED.tone,
		};
	}
	if (dbfs >= -20) {
		return {
			zone: "YELLOW",
			label: OBS_ZONES.YELLOW.label,
			tone: OBS_ZONES.YELLOW.tone,
		};
	}
	if (dbfs >= -50) {
		return {
			zone: "GREEN",
			label: OBS_ZONES.GREEN.label,
			tone: OBS_ZONES.GREEN.tone,
		};
	}
	return {
		zone: "DARK_GREEN",
		label: OBS_ZONES.DARK_GREEN.label,
		tone: OBS_ZONES.DARK_GREEN.tone,
	};
}

/**
 * Decide a high-level status from a representative speech dBFS value.
 * `clipDetected` (any frame at or above -0.5) takes precedence and yields
 * "clipping". `p95PeakDbfs` is `Number.NEGATIVE_INFINITY` when no speech
 * frames were captured, which maps to "no_speech".
 */
export function classifyStatus(
	p95PeakDbfs: number,
	clipDetected: boolean,
): MicStatus {
	if (clipDetected) return "clipping";
	if (!Number.isFinite(p95PeakDbfs)) return "no_speech";
	if (p95PeakDbfs < -20) return "too_quiet";
	if (p95PeakDbfs > -9) return "too_loud";
	return "ok";
}

/**
 * Map a status to a Japanese user-facing label.
 */
export function statusLabel(status: MicStatus): string {
	switch (status) {
		case "clipping":
			return "クリッピングしています";
		case "too_loud":
			return "大きすぎます";
		case "ok":
			return "適正です";
		case "too_quiet":
			return "小さすぎます";
		case "no_speech":
			return "発話が検出できませんでした";
	}
}

/**
 * Map a status to a single next-action hint shown after the 5s check.
 */
export function statusAction(status: MicStatus): string {
	switch (status) {
		case "clipping":
			return "ゲインをすぐに下げるか、マイクから離れてください";
		case "too_loud":
			return "OS / インターフェース / OBS のゲインを少し下げましょう";
		case "ok":
			return "そのまま配信・通話・録音に使えます";
		case "too_quiet":
			return "ゲインを上げるか、マイクに近づいて話してください";
		case "no_speech":
			return "もう一度、5秒間ほど普通に話してから再チェックしてください";
	}
}

/**
 * Recommend a gain delta that would move the measured p95 peak toward
 * TARGET_DBFS (-14 dBFS). Positive -> raise gain, negative -> lower gain.
 *
 * The result is rounded to the nearest whole decibel for a stable UI hint.
 */
export function recommendedGainDb(p95PeakDbfs: number): number {
	if (!Number.isFinite(p95PeakDbfs)) return 0;
	return Math.round(TARGET_DBFS - p95PeakDbfs);
}

/**
 * Friendly phrasing of the recommended gain delta.
 * Returns null when the measured value is within ±2 dB of the target.
 */
export function recommendedGainText(p95PeakDbfs: number): string | null {
	const gain = recommendedGainDb(p95PeakDbfs);
	if (Math.abs(gain) <= 2) return null;
	if (gain > 0) return `約 +${gain} dB 上げる`;
	return `約 ${gain} dB 下げる`;
}

/**
 * 95th-percentile over an array of numeric samples.
 * Uses nearest-rank; falls back to the last value when the array is empty.
 */
export function p95(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return Number.NEGATIVE_INFINITY;
	const rank = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(0.95 * sorted.length) - 1),
	);
	return sorted[rank];
}

/**
 * Aggregate a stream of per-frame dBFS samples into the CheckSummary
 * displayed after a 5s recording window.
 *
 *   peakFrames / rmsFrames: per-frame dBFS readings from the analyser
 *   speechFloorDbfs: frames quieter than this are treated as silence and
 *                     excluded from the p95 + average-RMS calculations.
 */
export function summarizeCheck(
	peakFrames: number[],
	rmsFrames: number[],
	speechFloorDbfs = MIN_DBFS,
): CheckSummary {
	const totalFrameCount = peakFrames.length;
	let speechRmsSum = 0;
	let speechFrameCount = 0;
	let maxPeakDbfs = Number.NEGATIVE_INFINITY;
	let clipDetected = false;
	const speechPeaks: number[] = [];

	for (let i = 0; i < totalFrameCount; i++) {
		const peak = peakFrames[i];
		const rms = rmsFrames[i];
		if (peak > maxPeakDbfs) maxPeakDbfs = peak;
		if (peak >= -0.5) clipDetected = true;
		if (peak > speechFloorDbfs) {
			speechPeaks.push(peak);
			speechRmsSum += rms;
			speechFrameCount++;
		}
	}

	const p95PeakDbfs = p95(speechPeaks);
	const avgRmsDbfs =
		speechFrameCount === 0
			? Number.NEGATIVE_INFINITY
			: speechRmsSum / speechFrameCount;

	const status = classifyStatus(p95PeakDbfs, clipDetected);
	const recommended = recommendedGainDb(p95PeakDbfs);

	return {
		p95PeakDbfs,
		maxPeakDbfs,
		avgRmsDbfs,
		speechFrameCount,
		totalFrameCount,
		status,
		recommendedGainDb: recommended,
		clipDetected,
	};
}

/**
 * Format a dBFS value for display. Values at or below the silent floor
 * render as a `≤ -60` label so the user understands the floor.
 */
export function formatDbfs(dbfs: number): string {
	if (!Number.isFinite(dbfs)) return `≤ ${MIN_DBFS} dBFS`;
	if (dbfs <= MIN_DBFS) return `≤ ${MIN_DBFS} dBFS`;
	if (dbfs >= MAX_DBFS) return `${MAX_DBFS} dBFS`;
	const sign = dbfs > 0 ? "+" : "";
	return `${sign}${dbfs.toFixed(1)} dBFS`;
}

/**
 * Map a dBFS reading to a 0..1 bar fill ratio for the meter.
 * Values below MIN_DBFS clamp to 0; values above MAX_DBFS clamp to 1.
 */
export function dbfsToBar(dbfs: number): number {
	if (!Number.isFinite(dbfs)) return 0;
	const range = MAX_DBFS - MIN_DBFS;
	const ratio = (clampDbfs(dbfs) - MIN_DBFS) / range;
	return Math.max(0, Math.min(1, ratio));
}

/**
 * Determine whether the browser is reporting track settings that conflict
 * with the requested clean-input constraints. Returns the list of settings
 * the browser/driver left enabled.
 */
export function detectForcedSettings(
	settings: MediaTrackSettings | undefined,
): Array<"echoCancellation" | "noiseSuppression" | "autoGainControl"> {
	if (!settings) return [];
	const forced: Array<
		"echoCancellation" | "noiseSuppression" | "autoGainControl"
	> = [];
	if (settings.echoCancellation === true) forced.push("echoCancellation");
	if (settings.noiseSuppression === true) forced.push("noiseSuppression");
	if (settings.autoGainControl === true) forced.push("autoGainControl");
	return forced;
}
