import type { TrendPoint } from '../lib/api';

/** Quiet stacked bars: gray for passing, muted red for failing, pale for skipped. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.passed + p.failed + p.skipped), 1);
  const barWidth = 18;
  const gap = 8;
  const height = 120;
  const width = points.length * (barWidth + gap) - gap;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height + 22} role="img" aria-label="Pass/fail trend per run">
        {points.map((p, i) => {
          const total = p.passed + p.failed + p.skipped;
          const x = i * (barWidth + gap);
          const hPassed = (p.passed / max) * height;
          const hFailed = (p.failed / max) * height;
          const hSkipped = (p.skipped / max) * height;
          let y = height;
          const segments: { h: number; fill: string }[] = [
            { h: hPassed, fill: 'var(--color-ink-200)' },
            { h: hSkipped, fill: 'var(--color-ink-100)' },
            { h: hFailed, fill: '#d4778f' },
          ];
          return (
            <g key={p.runId}>
              <title>{`${p.commitSha.slice(0, 9)} — ${p.passed} passed, ${p.failed} failed, ${p.skipped} skipped (${total} total)`}</title>
              {segments.map((s, j) => {
                y -= s.h;
                return s.h > 0 ? (
                  <rect key={j} x={x} y={y} width={barWidth} height={s.h} rx={2} fill={s.fill} />
                ) : null;
              })}
              <text
                x={x + barWidth / 2}
                y={height + 14}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-ink-400)"
              >
                {new Date(p.startedAt).getDate()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
