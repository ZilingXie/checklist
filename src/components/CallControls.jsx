const CallControls = ({
  onEndCall,
  isDownloadReady,
  onDownload,
  onToggleDeviceMenu,
  isDeviceMenuOpen,
  devices = [],
  selectedDeviceId,
  onSelectDevice,
  deviceStatusMessage,
  inputVolume = 0
}) => {
  const clampedVolume = Math.round(Math.min(1, Math.max(0, inputVolume)) * 100);

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-lg">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-base font-semibold text-white">Call Controls</h4>
          <p className="text-xs text-white/60">
            Wrap up anytime, export the reviewed checklist, or switch microphones mid-call.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
          <div className="flex flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onToggleDeviceMenu}
                className="rounded-full border border-white/20 px-5 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
              >
                Switch Device
              </button>
              <div className="flex items-center gap-2 text-white/60">
                <span className="text-[11px] font-semibold uppercase tracking-wide">Input Level</span>
                <div className="h-2 w-44 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-[width] duration-150 ease-out"
                    style={{ width: `${clampedVolume}%` }}
                  />
                </div>
              </div>
            </div>
            {deviceStatusMessage ? (
              <p className="text-[11px] text-amber-300">{deviceStatusMessage}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onDownload}
              disabled={!isDownloadReady}
              className="rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-white/80 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Download Reviewed Checklist
            </button>
            <button
              type="button"
              onClick={onEndCall}
              className="rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-rose-900/30 transition hover:bg-rose-600"
            >
              End Call
            </button>
          </div>
        </div>
      </div>
      {isDeviceMenuOpen ? (
        <div className="rounded-2xl border border-white/15 bg-slate-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
            Select Microphone
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {devices.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                No audio input devices detected.
              </p>
            ) : (
              devices.map((device) => (
                <button
                  key={device.deviceId}
                  type="button"
                  onClick={() => onSelectDevice(device.deviceId)}
                  className={`rounded-lg border px-4 py-2 text-left text-sm transition ${
                    selectedDeviceId === device.deviceId
                      ? 'border-brand-500 bg-brand-500/30 text-white'
                      : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
                  }`}
                >
                  {device.label}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CallControls;
