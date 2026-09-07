import { Mic, RefreshCw } from "lucide-react";

export interface DeviceOption {
	deviceId: string;
	label: string;
}

export interface DevicePickerProps {
	devices: DeviceOption[];
	selectedDeviceId: string | null;
	disabled: boolean;
	busy: boolean;
	onChange: (deviceId: string) => void;
	onRefresh: () => void;
}

export default function DevicePicker({
	devices,
	selectedDeviceId,
	disabled,
	busy,
	onChange,
	onRefresh,
}: DevicePickerProps) {
	return (
		<div className="space-y-1.5">
			<label
				htmlFor="mic-device"
				className="text-sm font-medium flex items-center gap-1.5"
			>
				<Mic className="w-4 h-4" aria-hidden="true" />
				入力デバイス
			</label>
			<div className="flex gap-2">
				<select
					id="mic-device"
					className="flex-1 min-w-0 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
					value={selectedDeviceId ?? ""}
					onChange={(e) => onChange(e.target.value)}
					disabled={disabled || devices.length === 0}
				>
					{devices.length === 0 && (
						<option value="">マイクを許可すると一覧が表示されます</option>
					)}
					{devices.map((d) => (
						<option key={d.deviceId} value={d.deviceId}>
							{d.label}
						</option>
					))}
				</select>
				<button
					type="button"
					className="rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50 disabled:opacity-50 inline-flex items-center gap-1"
					onClick={onRefresh}
					disabled={busy}
					aria-label="デバイス一覧を再取得"
				>
					<RefreshCw className="w-4 h-4" aria-hidden="true" />
					<span className="hidden sm:inline">再取得</span>
				</button>
			</div>
		</div>
	);
}
