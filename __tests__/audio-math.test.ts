import { describe, expect, test } from "bun:test";
import {
	clampDbfs,
	classifyStatus,
	classifyZone,
	dbfsToBar,
	detectForcedSettings,
	formatDbfs,
	linearToDbfs,
	MAX_DBFS,
	MIN_DBFS,
	measureFrame,
	p95,
	peakPcm,
	recommendedGainDb,
	recommendedGainText,
	rmsPcm,
	statusAction,
	statusLabel,
	summarizeCheck,
	TARGET_DBFS,
} from "../lib/audio-math";

describe("linearToDbfs", () => {
	test("returns -Infinity for zero and negative values", () => {
		expect(linearToDbfs(0)).toBe(Number.NEGATIVE_INFINITY);
		expect(linearToDbfs(-1)).toBe(Number.NEGATIVE_INFINITY);
	});

	test("returns -Infinity for NaN / Infinity", () => {
		expect(linearToDbfs(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
		expect(linearToDbfs(Number.POSITIVE_INFINITY)).toBe(
			Number.NEGATIVE_INFINITY,
		);
	});

	test("computes 20 * log10(linear)", () => {
		expect(linearToDbfs(1)).toBeCloseTo(0, 6);
		expect(linearToDbfs(0.5)).toBeCloseTo(-6.0206, 3);
		expect(linearToDbfs(0.1)).toBeCloseTo(-20, 6);
	});
});

describe("peakPcm / rmsPcm / measureFrame", () => {
	test("empty buffer -> peak 0, rms 0", () => {
		const buf = new Float32Array(0);
		expect(peakPcm(buf)).toBe(0);
		expect(rmsPcm(buf)).toBe(0);
		expect(measureFrame(buf)).toEqual({
			peakDbfs: MIN_DBFS,
			rmsDbfs: MIN_DBFS,
		});
	});

	test("uses absolute value for peak", () => {
		const buf = new Float32Array([0.1, -0.5, 0.25]);
		expect(peakPcm(buf)).toBeCloseTo(0.5, 6);
	});

	test("rms over a known sine-like buffer", () => {
		// DC + a single high sample: rms = sqrt((0.5^2 + 1^2)/2)
		const buf = new Float32Array([0.5, 1]);
		expect(rmsPcm(buf)).toBeCloseTo(Math.sqrt(1.25 / 2), 6);
	});

	test("measureFrame returns dBFS for both peak and rms", () => {
		const buf = new Float32Array([0.1, -0.2, 0.05]);
		const { peakDbfs, rmsDbfs } = measureFrame(buf);
		expect(peakDbfs).toBeCloseTo(-13.9794, 3);
		expect(rmsDbfs).toBeLessThan(peakDbfs);
	});
});

describe("clampDbfs", () => {
	test("clamps below the floor", () => {
		expect(clampDbfs(-100)).toBe(MIN_DBFS);
		expect(clampDbfs(-60.0001)).toBe(MIN_DBFS);
	});

	test("clamps above 0 dBFS", () => {
		expect(clampDbfs(2)).toBe(MAX_DBFS);
	});

	test("returns floor for non-finite input", () => {
		expect(clampDbfs(Number.NEGATIVE_INFINITY)).toBe(MIN_DBFS);
		expect(clampDbfs(Number.NaN)).toBe(MIN_DBFS);
	});

	test("passes through values inside the range", () => {
		expect(clampDbfs(-30)).toBe(-30);
	});
});

describe("classifyZone", () => {
	test.each([
		[-60, "DARK_GREEN"],
		[-49, "GREEN"],
		[-30, "GREEN"],
		[-19.999, "YELLOW"],
		[-15, "YELLOW"],
		[-9.001, "YELLOW"],
		[-9, "RED"],
		[-3, "RED"],
		[-0.5, "RED"],
		[-0.4, "CLIP"],
		[0, "CLIP"],
	])("dbfs=%s -> %s", (dbfs, zone) => {
		expect(classifyZone(dbfs).zone).toBe(zone);
	});

	test("non-finite values land in dark green", () => {
		expect(classifyZone(Number.NEGATIVE_INFINITY).zone).toBe("DARK_GREEN");
		expect(classifyZone(Number.NaN).zone).toBe("DARK_GREEN");
	});

	test("clipping has tone=danger", () => {
		expect(classifyZone(-0.1).tone).toBe("danger");
	});

	test("yellow zone has tone=target", () => {
		expect(classifyZone(-14).tone).toBe("target");
	});
});

describe("classifyStatus", () => {
	test("clipping wins regardless of p95", () => {
		expect(classifyStatus(-15, true)).toBe("clipping");
	});

	test("no_speech when p95 is -Infinity", () => {
		expect(classifyStatus(Number.NEGATIVE_INFINITY, false)).toBe("no_speech");
	});

	test.each([
		[-25, false, "too_quiet"],
		[-20.0001, false, "too_quiet"],
		[-20, false, "ok"],
		[-15, false, "ok"],
		[-9, false, "ok"],
		[-8.999, false, "too_loud"],
		[-3, false, "too_loud"],
	])("p95=%s -> %s", (p95PeakDbfs, clip, status) => {
		expect(classifyStatus(p95PeakDbfs, clip)).toBe(status);
	});
});

describe("recommendedGainDb / recommendedGainText", () => {
	test("returns positive gain when below target", () => {
		expect(recommendedGainDb(-24)).toBe(TARGET_DBFS - -24);
	});

	test("returns negative gain when above target", () => {
		expect(recommendedGainDb(-6)).toBe(TARGET_DBFS - -6);
	});

	test("rounds to whole decibels", () => {
		// TARGET_DBFS (-14) - (-13.4) = -0.6 -> rounds to -1
		expect(recommendedGainDb(-13.4)).toBe(-1);
		// TARGET_DBFS (-14) - (-14.6) = 0.6 -> rounds to 1
		expect(recommendedGainDb(-14.6)).toBe(1);
	});

	test("returns 0 for non-finite input", () => {
		expect(recommendedGainDb(Number.NEGATIVE_INFINITY)).toBe(0);
		expect(recommendedGainDb(Number.NaN)).toBe(0);
	});

	test("text within ±2 dB of target returns null", () => {
		expect(recommendedGainText(-14)).toBeNull();
		expect(recommendedGainText(-15.5)).toBeNull();
		expect(recommendedGainText(-12.5)).toBeNull();
	});

	test("text outside ±2 dB is phrased in Japanese", () => {
		expect(recommendedGainText(-24)).toBe("約 +10 dB 上げる");
		expect(recommendedGainText(-6)).toBe("約 -8 dB 下げる");
	});
});

describe("p95", () => {
	test("returns -Infinity for empty array", () => {
		expect(p95([])).toBe(Number.NEGATIVE_INFINITY);
	});

	test("computes the 95th percentile (nearest-rank)", () => {
		const values = Array.from({ length: 20 }, (_, i) => i - 30);
		// sorted ascending; rank = ceil(0.95 * 20) - 1 = 18 -> values[18] = -12
		expect(p95(values)).toBe(-12);
	});

	test("handles a single value", () => {
		expect(p95([-10])).toBe(-10);
	});

	test("does not mutate input", () => {
		const values = [-10, -20, -5];
		const snapshot = [...values];
		p95(values);
		expect(values).toEqual(snapshot);
	});
});

describe("summarizeCheck", () => {
	test("treats silence as no_speech", () => {
		const peaks = [-60, -60, -60];
		const rmss = [-60, -60, -60];
		const summary = summarizeCheck(peaks, rmss);
		expect(summary.status).toBe("no_speech");
		expect(summary.speechFrameCount).toBe(0);
		expect(summary.totalFrameCount).toBe(3);
		expect(summary.p95PeakDbfs).toBe(Number.NEGATIVE_INFINITY);
		expect(summary.maxPeakDbfs).toBe(-60);
	});

	test("computes p95 over speech frames only", () => {
		// silence frames excluded by default floor (-60)
		const peaks = [-60, -22, -20, -18, -14, -12, -60];
		const rmss = [-60, -30, -28, -26, -22, -20, -60];
		const summary = summarizeCheck(peaks, rmss, MIN_DBFS);
		expect(summary.speechFrameCount).toBe(5);
		expect(summary.totalFrameCount).toBe(7);
		expect(summary.maxPeakDbfs).toBe(-12);
		expect(summary.p95PeakDbfs).toBe(-12);
		expect(summary.avgRmsDbfs).toBeCloseTo(-25.2, 1);
		expect(summary.status).toBe("ok");
		expect(summary.recommendedGainDb).toBe(TARGET_DBFS - -12);
	});

	test("marks clipping when any frame >= -0.5 dBFS", () => {
		const peaks = [-15, -10, -0.2];
		const rmss = [-20, -18, -10];
		const summary = summarizeCheck(peaks, rmss);
		expect(summary.status).toBe("clipping");
		expect(summary.clipDetected).toBe(true);
	});

	test("classifies quiet speech as too_quiet", () => {
		const peaks = [-30, -28, -25];
		const rmss = [-40, -38, -35];
		const summary = summarizeCheck(peaks, rmss);
		expect(summary.status).toBe("too_quiet");
	});

	test("classifies loud but not clipping speech as too_loud", () => {
		const peaks = [-5, -4, -3];
		const rmss = [-15, -14, -12];
		const summary = summarizeCheck(peaks, rmss);
		expect(summary.status).toBe("too_loud");
	});
});

describe("formatDbfs", () => {
	test("formats within range with one decimal", () => {
		expect(formatDbfs(-12.34)).toBe("-12.3 dBFS");
	});

	test("formats non-finite as silent floor", () => {
		expect(formatDbfs(Number.NEGATIVE_INFINITY)).toBe("≤ -60 dBFS");
		expect(formatDbfs(Number.NaN)).toBe("≤ -60 dBFS");
	});

	test("clamps to silent floor for very quiet values", () => {
		expect(formatDbfs(-100)).toBe("≤ -60 dBFS");
	});

	test("clamps to 0 for hot values", () => {
		expect(formatDbfs(3)).toBe("0 dBFS");
	});
});

describe("dbfsToBar", () => {
	test("maps floor to 0 and ceiling to 1", () => {
		expect(dbfsToBar(MIN_DBFS)).toBe(0);
		expect(dbfsToBar(MAX_DBFS)).toBe(1);
	});

	test("clamps out-of-range inputs", () => {
		expect(dbfsToBar(-200)).toBe(0);
		expect(dbfsToBar(5)).toBe(1);
	});

	test("returns 0 for non-finite input", () => {
		expect(dbfsToBar(Number.NaN)).toBe(0);
		expect(dbfsToBar(Number.NEGATIVE_INFINITY)).toBe(0);
	});
});

describe("detectForcedSettings", () => {
	test("returns empty array when settings missing", () => {
		expect(detectForcedSettings(undefined)).toEqual([]);
	});

	test("returns empty array when all disabled", () => {
		expect(
			detectForcedSettings({
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			}),
		).toEqual([]);
	});

	test("lists settings left enabled by the browser", () => {
		expect(
			detectForcedSettings({
				echoCancellation: true,
				noiseSuppression: false,
				autoGainControl: true,
			}),
		).toEqual(["echoCancellation", "autoGainControl"]);
	});
});

describe("statusLabel / statusAction", () => {
	test("statusLabel covers all branches", () => {
		expect(statusLabel("ok")).toBe("適正です");
		expect(statusLabel("too_quiet")).toBe("小さすぎます");
		expect(statusLabel("too_loud")).toBe("大きすぎます");
		expect(statusLabel("clipping")).toBe("クリッピングしています");
		expect(statusLabel("no_speech")).toBe("発話が検出できませんでした");
	});

	test("statusAction returns a hint for each status", () => {
		for (const status of [
			"ok",
			"too_quiet",
			"too_loud",
			"clipping",
			"no_speech",
		] as const) {
			expect(statusAction(status).length).toBeGreaterThan(0);
		}
	});
});
