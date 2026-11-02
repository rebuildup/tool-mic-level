/**
 * Mapping from a `getUserMedia` rejection to a short, user-facing reason.
 *
 * The microphone request can fail for reasons the page cannot fix:
 *
 *   - the user denied the permission (`NotAllowedError`),
 *   - the frame runs in a sandbox / cross-origin iframe whose Permissions
 *     Policy forbids the `microphone` feature (`NotAllowedError` /
 *     `SecurityError`),
 *   - the page is not a secure context (`SecurityError`),
 *   - no input device exists or the requested device is gone
 *     (`NotFoundError` / `OverconstrainedError`),
 *   - anything else the browser reports.
 *
 * The Tool never fakes a permission and never works around a denial; it
 * reports the reason and keeps the rest of the surface usable.
 */

export type MicrophoneFailureReason =
	| "not-allowed"
	| "device-not-found"
	| "unknown";

const NOT_ALLOWED_MESSAGE =
	"マイクを使用できません。権限が拒否されたか、埋め込み iframe の Permissions Policy でマイクが許可されていません。";

const DEVICE_NOT_FOUND_MESSAGE =
	"マイクを使用できません。入力デバイスが見つかりません。";

const UNKNOWN_MESSAGE =
	"マイクを使用できません。ブラウザがマイク入力を取得できませんでした。ページを再読み込みしてもう一度お試しください。";

/**
 * Classify a `getUserMedia` rejection by its `DOMException` name.
 *
 * An unknown or missing name is treated as `unknown` and never as a
 * permission grant.
 */
export function classifyMicrophoneFailure(
	name: string | undefined,
): MicrophoneFailureReason {
	if (name === "NotAllowedError" || name === "SecurityError") {
		return "not-allowed";
	}
	if (name === "NotFoundError" || name === "OverconstrainedError") {
		return "device-not-found";
	}
	return "unknown";
}

/**
 * Short, non-technical reason shown in the error surface.
 */
export function microphoneErrorMessage(name: string | undefined): string {
	switch (classifyMicrophoneFailure(name)) {
		case "not-allowed":
			return NOT_ALLOWED_MESSAGE;
		case "device-not-found":
			return DEVICE_NOT_FOUND_MESSAGE;
		case "unknown":
			return UNKNOWN_MESSAGE;
	}
}
