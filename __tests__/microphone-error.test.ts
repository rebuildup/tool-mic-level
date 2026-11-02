import { describe, expect, test } from "bun:test";
import {
	classifyMicrophoneFailure,
	microphoneErrorMessage,
} from "../src/lib/microphone-error";

describe("classifyMicrophoneFailure", () => {
	test("maps a denied permission to not-allowed", () => {
		expect(classifyMicrophoneFailure("NotAllowedError")).toBe("not-allowed");
	});

	test("maps a security error (sandbox / insecure context) to not-allowed", () => {
		expect(classifyMicrophoneFailure("SecurityError")).toBe("not-allowed");
	});

	test("maps a missing device to device-not-found", () => {
		expect(classifyMicrophoneFailure("NotFoundError")).toBe("device-not-found");
		expect(classifyMicrophoneFailure("OverconstrainedError")).toBe(
			"device-not-found",
		);
	});

	test("treats an unknown or missing name as unknown", () => {
		expect(classifyMicrophoneFailure("AbortError")).toBe("unknown");
		expect(classifyMicrophoneFailure(undefined)).toBe("unknown");
	});
});

describe("microphoneErrorMessage", () => {
	test("every reason states that the microphone cannot be used", () => {
		for (const name of [
			"NotAllowedError",
			"SecurityError",
			"NotFoundError",
			"OverconstrainedError",
			"AbortError",
			undefined,
		]) {
			expect(microphoneErrorMessage(name)).toContain("マイクを使用できません");
		}
	});

	test("the not-allowed reason mentions the permission / Permissions Policy", () => {
		const message = microphoneErrorMessage("NotAllowedError");
		expect(message).toContain("Permissions Policy");
	});

	test("the not-allowed reason never claims the microphone is available", () => {
		const message = microphoneErrorMessage("NotAllowedError");
		expect(message).not.toContain("許可されました");
	});
});
