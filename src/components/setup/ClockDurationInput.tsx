'use client';

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function ClockDurationInput({
  value,
  onChange,
  label = 'Pick clock',
  disabled = false,
  minimumSeconds = 10,
}: {
  value: number;
  onChange: (seconds: number) => void;
  label?: string;
  disabled?: boolean;
  minimumSeconds?: number;
}) {
  const normalized = Math.max(minimumSeconds, Math.floor(Number(value) || minimumSeconds));
  const minutes = Math.floor(normalized / 60);
  const seconds = normalized % 60;

  function update(nextMinutes: number, nextSeconds: number) {
    const total = clampInteger(nextMinutes, 0, 999) * 60 + clampInteger(nextSeconds, 0, 59);
    onChange(Math.max(minimumSeconds, total));
  }

  return (
    <fieldset className="clock-duration-field" disabled={disabled}>
      <legend>{label}</legend>
      <div className="clock-duration-inputs">
        <label>
          <span>Minutes</span>
          <input
            type="number"
            min="0"
            max="999"
            inputMode="numeric"
            value={minutes}
            onChange={(event) => update(Number(event.target.value), seconds)}
          />
        </label>
        <span className="clock-duration-separator">:</span>
        <label>
          <span>Seconds</span>
          <input
            type="number"
            min="0"
            max="59"
            inputMode="numeric"
            value={seconds}
            onChange={(event) => update(minutes, Number(event.target.value))}
          />
        </label>
      </div>
      <small>{minutes}:{String(seconds).padStart(2, '0')} per pick</small>
    </fieldset>
  );
}
