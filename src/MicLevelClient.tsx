"use client";

import { AlertTriangle, Mic, Square, TimerReset } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CheckResult from "./components/CheckResult";
import DevicePicker, { type DeviceOption } from "./components/DevicePicker";
import Meter from "./components/Meter";
import PrivacyNotice from "./components/PrivacyNotice";
import {
	type CheckSummary,
	classifyZone,
	detectForcedSettings,
	formatDbfs,
	measureFrame,
	summarizeCheck,
} from "./lib/audio-math";

const CHECK_DURATION_MS = 5000;
const PEAK_HOLD_MS = 1500;
const REDUCED_MOTION_HOLD_MS = 8000;
// Throttle React re-renders for the slow-moving text labels while the
// high-frequency meter fill is mutated directly on the DOM.
const LABEL_THROTTLE_MS = 100;

type PermissionState =
	| "idle"
	| "requesting"
	| "granted"
	| "denied"
	| "unsupported";

interface ForcedSettingNotice {
	settings: Array<"echoCancellation" | "noiseSuppression" | "autoGainControl">;
}

export default function MicLevelClient() {
	const [permission, setPermission] = useState<PermissionState>("idle");
	const [devices, setDevices] = useState<DeviceOption[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
	const [forcedSettings, setForcedSettings] = useState<ForcedSettingNotice>({
		settings: [],
	});
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isCheckRunning, setIsCheckRunning] = useState(false);
	const [checkProgress, setCheckProgress] = useState(0);
	const [summary, setSummary] = useState<CheckSummary | null>(null);
	const [active, setActive] = useState(false);
	// React state for slow-moving labels. Updated at most every
	// LABEL_THROTTLE_MS while the analyser is running so that the rest of
	// the tree doesn't re-render at frame rate.
	const [displayPeakDbfs, setDisplayPeakDbfs] = useState<number>(
		Number.NEGATIVE_INFINITY,
	);
	const [displayRmsDbfs, setDisplayRmsDbfs] = useState<number>(
		Number.NEGATIVE_INFINITY,
	);
	const [displayPeakHoldDbfs, setDisplayPeakHoldDbfs] = useState<number>(
		Number.NEGATIVE_INFINITY,
	);
	const [displayZoneLabel, setDisplayZoneLabel] =
		useState<string>("dark green");

	const streamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
	const rafRef = useRef<number | null>(null);
	const lastLabelUpdateRef = useRef<number>(0);
	const peakHoldTimerRef = useRef<number | null>(null);
	const reducedMotionRef = useRef(false);
	const peakHoldDurationRef = useRef(PEAK_HOLD_MS);
	const checkStartRef = useRef<number | null>(null);
	const peakFramesRef = useRef<number[]>([]);
	const rmsFramesRef = useRef<number[]>([]);
	const deviceChangeAbortRef = useRef<AbortController | null>(null);

	const supportsMedia = useMemo(() => {
		if (typeof navigator === "undefined") return false;
		return Boolean(
			navigator.mediaDevices &&
				typeof navigator.mediaDevices.getUserMedia === "function",
		);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
		reducedMotionRef.current = mql.matches;
		peakHoldDurationRef.current = mql.matches
			? REDUCED_MOTION_HOLD_MS
			: PEAK_HOLD_MS;
		const handler = (e: MediaQueryListEvent) => {
			reducedMotionRef.current = e.matches;
			peakHoldDurationRef.current = e.matches
				? REDUCED_MOTION_HOLD_MS
				: PEAK_HOLD_MS;
		};
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	const cleanup = useCallback(() => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (peakHoldTimerRef.current !== null) {
			window.clearTimeout(peakHoldTimerRef.current);
			peakHoldTimerRef.current = null;
		}
		if (deviceChangeAbortRef.current) {
			deviceChangeAbortRef.current.abort();
			deviceChangeAbortRef.current = null;
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		if (audioContextRef.current && audioContextRef.current.state !== "closed") {
			void audioContextRef.current.close();
			audioContextRef.current = null;
		}
		analyserRef.current = null;
		bufferRef.current = null;
		setActive(false);
		setIsCheckRunning(false);
		setCheckProgress(0);
		setDisplayPeakDbfs(Number.NEGATIVE_INFINITY);
		setDisplayRmsDbfs(Number.NEGATIVE_INFINITY);
		setDisplayPeakHoldDbfs(Number.NEGATIVE_INFINITY);
		setDisplayZoneLabel("dark green");
	}, []);

	useEffect(() => cleanup, [cleanup]);

	useEffect(() => {
		return () => {
			cleanup();
		};
	}, [cleanup]);

	const enumerateInputDevices = useCallback(async () => {
		if (!navigator.mediaDevices?.enumerateDevices) return;
		try {
			const list = await navigator.mediaDevices.enumerateDevices();
			const inputs = list
				.filter((d) => d.kind === "audioinput")
				.map((d, idx) => ({
					deviceId: d.deviceId,
					label: d.label || `マイク ${idx + 1}`,
				}));
			setDevices(inputs);
			setSelectedDeviceId((current) => {
				if (current && inputs.some((d) => d.deviceId === current))
					return current;
				return inputs[0]?.deviceId ?? null;
			});
		} catch (e) {
			console.warn("[mic-level] enumerateDevices failed", e);
		}
	}, []);

	const startStream = useCallback(
		async (deviceId: string | null) => {
			if (!supportsMedia) {
				setPermission("unsupported");
				setErrorMessage("このブラウザはマイク入力を取得できません。");
				return;
			}
			// tear down any previous stream
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) track.stop();
				streamRef.current = null;
			}
			if (
				audioContextRef.current &&
				audioContextRef.current.state !== "closed"
			) {
				await audioContextRef.current.close();
				audioContextRef.current = null;
			}
			setErrorMessage(null);
			setPermission("requesting");
			try {
				const constraints: MediaStreamConstraints = {
					audio: {
						echoCancellation: false,
						noiseSuppression: false,
						autoGainControl: false,
						...(deviceId ? { deviceId: { exact: deviceId } } : {}),
					},
					video: false,
				};
				const stream = await navigator.mediaDevices.getUserMedia(constraints);
				streamRef.current = stream;
				const track = stream.getAudioTracks()[0];
				const forced = detectForcedSettings(track?.getSettings());
				setForcedSettings({ settings: forced });

				const AudioContextCtor: typeof AudioContext =
					window.AudioContext ||
					(window as unknown as { webkitAudioContext?: typeof AudioContext })
						.webkitAudioContext!;
				if (!AudioContextCtor) {
					setPermission("unsupported");
					setErrorMessage("Web Audio API が利用できません。");
					for (const t of stream.getTracks()) t.stop();
					streamRef.current = null;
					return;
				}
				const ctx = new AudioContextCtor();
				audioContextRef.current = ctx;
				const source = ctx.createMediaStreamSource(stream);
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 2048;
				analyser.smoothingTimeConstant = 0;
				source.connect(analyser);
				analyserRef.current = analyser;
				bufferRef.current = new Float32Array(
					new ArrayBuffer(analyser.fftSize * 4),
				);

				setPermission("granted");
				setActive(true);

				// After permission is granted, labels become available.
				await enumerateInputDevices();

				const loop = () => {
					const a = analyserRef.current;
					const buf = bufferRef.current;
					if (!a || !buf) return;
					a.getFloatTimeDomainData(buf);
					const { peakDbfs, rmsDbfs } = measureFrame(buf);

					const now = performance.now();
					if (now - lastLabelUpdateRef.current >= LABEL_THROTTLE_MS) {
						lastLabelUpdateRef.current = now;
						setDisplayPeakDbfs(peakDbfs);
						setDisplayRmsDbfs(rmsDbfs);
						setDisplayZoneLabel(classifyZone(peakDbfs).label);
					}

					// peak hold: capture immediately, schedule a clear
					setDisplayPeakHoldDbfs(peakDbfs);
					if (peakHoldTimerRef.current !== null) {
						window.clearTimeout(peakHoldTimerRef.current);
					}
					peakHoldTimerRef.current = window.setTimeout(() => {
						setDisplayPeakHoldDbfs(Number.NEGATIVE_INFINITY);
						peakHoldTimerRef.current = null;
					}, peakHoldDurationRef.current);

					if (isCheckRunningRef.current && checkStartRef.current !== null) {
						peakFramesRef.current.push(peakDbfs);
						rmsFramesRef.current.push(rmsDbfs);
						const elapsed = now - checkStartRef.current;
						const pct = Math.min(1, elapsed / CHECK_DURATION_MS);
						setCheckProgress(pct);
						if (elapsed >= CHECK_DURATION_MS) {
							finalizeCheck();
						}
					}

					rafRef.current = requestAnimationFrame(loop);
				};
				rafRef.current = requestAnimationFrame(loop);

				// devicechange listener (AbortController-scoped for cleanup)
				const abort = new AbortController();
				deviceChangeAbortRef.current = abort;
				const handler = () => {
					void enumerateInputDevices();
				};
				if (navigator.mediaDevices?.addEventListener) {
					navigator.mediaDevices.addEventListener("devicechange", handler, {
						signal: abort.signal,
					});
				}
			} catch (err) {
				console.error("[mic-level] getUserMedia failed", err);
				const name = (err as { name?: string })?.name;
				if (name === "NotAllowedError" || name === "SecurityError") {
					setPermission("denied");
					setErrorMessage(
						"マイクの使用が許可されていません。ブラウザの設定を確認してください。",
					);
				} else if (
					name === "NotFoundError" ||
					name === "OverconstrainedError"
				) {
					setPermission("denied");
					setErrorMessage(
						"マイクが見つかりません。入力デバイスを確認してください。",
					);
				} else {
					setPermission("denied");
					setErrorMessage(
						"マイクを取得できませんでした。ページを再読み込みしてもう一度お試しください。",
					);
				}
				setActive(false);
			}
		},
		[supportsMedia, enumerateInputDevices],
	);

	// Mirror isCheckRunning into a ref so the RAF loop can read it
	// without re-subscribing.
	const isCheckRunningRef = useRef(false);
	useEffect(() => {
		isCheckRunningRef.current = isCheckRunning;
	}, [isCheckRunning]);

	const finalizeCheck = useCallback(() => {
		const peaks = peakFramesRef.current;
		const rmss = rmsFramesRef.current;
		const result = summarizeCheck(peaks, rmss);
		setSummary(result);
		setIsCheckRunning(false);
		setCheckProgress(0);
		peakFramesRef.current = [];
		rmsFramesRef.current = [];
		checkStartRef.current = null;
	}, []);

	const handleStartCheck = useCallback(() => {
		if (!active) return;
		setSummary(null);
		peakFramesRef.current = [];
		rmsFramesRef.current = [];
		checkStartRef.current = performance.now();
		setIsCheckRunning(true);
		setCheckProgress(0);
	}, [active]);

	const handleStopCheck = useCallback(() => {
		if (peakFramesRef.current.length > 0) {
			finalizeCheck();
		} else {
			setIsCheckRunning(false);
			setCheckProgress(0);
			checkStartRef.current = null;
		}
	}, [finalizeCheck]);

	const handleDeviceChange = useCallback(
		(deviceId: string) => {
			setSelectedDeviceId(deviceId);
			if (permission === "granted" && deviceId) {
				void startStream(deviceId);
			}
		},
		[permission, startStream],
	);

	const handleRequestPermission = useCallback(() => {
		void startStream(selectedDeviceId);
	}, [selectedDeviceId, startStream]);

	const handleStop = useCallback(() => {
		cleanup();
		setPermission("idle");
		setSummary(null);
	}, [cleanup]);

	return (
		<div className="min-h-dvh w-full bg-white text-black px-4 sm:px-6 lg:px-12 py-8 pb-[env(safe-area-inset-bottom)]">
			<div className="max-w-3xl mx-auto pb-16 space-y-6">
				<nav className="text-sm text-neutral-600">
					<Link href="/" className="text-blue-600 hover:underline">
						Home
					</Link>
					<span className="mx-2">/</span>
					<Link href="/tools" className="text-blue-600 hover:underline">
						Tools
					</Link>
					<span className="mx-2">/</span>
					<span className="text-black">Mic Level Checker</span>
				</nav>

				<header className="space-y-1">
					<h1 className="text-2xl font-normal border-b border-neutral-300 pb-2.5">
						Mic Level Checker
					</h1>
					<p className="text-sm text-neutral-600">
						ブラウザだけで OBS 相当の dBFS
						メーターを表示し、5秒間の発話からゲインの上げ下げを判定します.
					</p>
				</header>

				<PrivacyNotice />

				{!supportsMedia && (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-800"
					>
						<AlertTriangle
							className="w-5 h-5 mt-0.5 shrink-0"
							aria-hidden="true"
						/>
						<p>
							このブラウザはマイク入力に対応していないため、利用できません。
						</p>
					</div>
				)}

				{permission !== "granted" && supportsMedia && (
					<button
						type="button"
						className="inline-flex items-center gap-2 rounded-md bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
						onClick={handleRequestPermission}
						disabled={permission === "requesting"}
					>
						<Mic className="w-4 h-4" aria-hidden="true" />
						{permission === "requesting"
							? "許可を待っています…"
							: "マイクを使用する"}
					</button>
				)}

				{permission === "granted" && (
					<div className="space-y-4">
						<DevicePicker
							devices={devices}
							selectedDeviceId={selectedDeviceId}
							disabled={isCheckRunning}
							busy={false}
							onChange={handleDeviceChange}
							onRefresh={() => void enumerateInputDevices()}
						/>

						{forcedSettings.settings.length > 0 && (
							<div
								role="status"
								className="flex items-start gap-2 rounded-md border border-yellow-500 bg-yellow-50 p-3 text-xs text-yellow-900"
							>
								<AlertTriangle
									className="w-4 h-4 mt-0.5 shrink-0"
									aria-hidden="true"
								/>
								<p>
									ブラウザ / OS
									が次の処理を強制しているため、無効化できませんでした:{" "}
									<code className="font-mono">
										{forcedSettings.settings.join(", ")}
									</code>
									。測定値は数 dB 程度ずれる可能性があります。
								</p>
							</div>
						)}

						<Meter
							peakDbfs={displayPeakDbfs}
							rmsDbfs={displayRmsDbfs}
							peakHoldDbfs={displayPeakHoldDbfs}
						/>

						<div
							className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm flex flex-wrap items-center gap-3"
							aria-live="polite"
						>
							<span className="font-medium">現在のゾーン:</span>
							<span className="font-mono">{displayZoneLabel}</span>
							<span className="ml-auto text-neutral-600 text-xs">
								Peak {formatDbfs(displayPeakDbfs)} / RMS{" "}
								{formatDbfs(displayRmsDbfs)}
							</span>
						</div>

						<div className="flex flex-wrap gap-2">
							{!isCheckRunning && (
								<button
									type="button"
									className="inline-flex items-center gap-2 rounded-md bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-700"
									onClick={handleStartCheck}
								>
									<TimerReset className="w-4 h-4" aria-hidden="true" />
									5秒チェック開始
								</button>
							)}
							{isCheckRunning && (
								<>
									<button
										type="button"
										className="inline-flex items-center gap-2 rounded-md border border-neutral-400 bg-white px-4 py-2 text-sm hover:bg-neutral-50"
										onClick={handleStopCheck}
									>
										<Square className="w-4 h-4" aria-hidden="true" />
										判定
									</button>
									<div
										className="flex-1 min-w-[160px] self-center"
										role="progressbar"
										aria-valuemin={0}
										aria-valuemax={100}
										aria-valuenow={Math.round(checkProgress * 100)}
									>
										<div className="h-2 w-full rounded-full bg-neutral-200 overflow-hidden">
											<div
												className="h-full bg-neutral-900 transition-[width] duration-75"
												style={{ width: `${Math.round(checkProgress * 100)}%` }}
											/>
										</div>
										<div className="mt-1 text-xs text-neutral-600 text-center">
											残り {Math.max(0, Math.ceil((1 - checkProgress) * 5))} 秒
										</div>
									</div>
								</>
							)}
							<button
								type="button"
								className="inline-flex items-center gap-2 rounded-md border border-neutral-400 bg-white px-4 py-2 text-sm hover:bg-neutral-50 ml-auto"
								onClick={handleStop}
							>
								<Square className="w-4 h-4" aria-hidden="true" />
								停止
							</button>
						</div>

						{summary && <CheckResult summary={summary} />}
					</div>
				)}

				{errorMessage && (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-800"
					>
						<AlertTriangle
							className="w-5 h-5 mt-0.5 shrink-0"
							aria-hidden="true"
						/>
						<p>{errorMessage}</p>
					</div>
				)}

				<footer className="text-xs text-neutral-500 leading-relaxed pt-4 border-t border-neutral-200">
					<p>
						OBS のメーターを pixel-perfect に再現するものではなく、OBS
						のdBFSゾーンを基準にしたゲイン調整支援ツールです. OS / driver /
						browser の AGC・noise suppression・sample format の影響で数 dB
						程度の差が出ることがあります.
					</p>
					<p className="mt-1">
						参考:{" "}
						<a
							className="text-blue-600 hover:underline"
							href="https://obsproject.com/kb/audio-mixer-technical-details"
							rel="noopener noreferrer"
							target="_blank"
						>
							OBS Audio Mixer Technical Details
						</a>
					</p>
				</footer>
			</div>
		</div>
	);
}
