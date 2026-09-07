import { Shield } from "lucide-react";

export interface PrivacyNoticeProps {
	compact?: boolean;
}

/**
 * Short privacy explanation shown before / alongside the microphone
 * permission prompt. Emphasises:
 *   - audio never leaves the browser
 *   - no recording / no upload
 *   - all analysis happens locally in the page
 */
export default function PrivacyNotice({ compact = false }: PrivacyNoticeProps) {
	return (
		<section
			aria-label="プライバシーに関する注記"
			className={`flex items-start gap-3 rounded-md border border-neutral-300 bg-neutral-50 p-3 text-neutral-800 ${
				compact ? "text-xs" : "text-sm"
			}`}
		>
			<Shield
				className={`shrink-0 ${compact ? "w-4 h-4 mt-0.5" : "w-5 h-5 mt-0.5"}`}
				aria-hidden="true"
			/>
			<div className="space-y-1 leading-relaxed">
				<p className="font-semibold">音声はこのブラウザ内だけで処理します</p>
				<ul className="list-disc pl-5 space-y-0.5">
					<li>録音・保存・アップロードは一切行いません</li>
					<li>サーバーへ送信されることはありません</li>
					<li>音量解析 (peak / RMS / dBFS) はブラウザ内のみ</li>
				</ul>
			</div>
		</section>
	);
}
