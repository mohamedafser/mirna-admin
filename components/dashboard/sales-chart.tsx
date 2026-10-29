import { cn } from "@/lib/utils/cn";

export interface SalesChartPoint {
  /** Store-local day, YYYY-MM-DD. */
  key: string;
  /** Short axis/tooltip label, e.g. "21 Oct". */
  label: string;
  value: number;
  valueLabel: string;
  ordersLabel: string;
}

/**
 * Daily revenue bars, rendered on the server (no client JS). Each column is
 * a full-height hover target with a tooltip; a visually hidden table carries
 * the same data for screen readers. One series, so no legend: the card title
 * names it.
 */
export function SalesChart({
  points,
  caption,
  labels,
}: {
  points: SalesChartPoint[];
  caption: string;
  labels: { day: string; revenue: string; orders: string };
}) {
  const max = Math.max(0, ...points.map((point) => point.value));
  const peak = points.reduce<SalesChartPoint | null>(
    (best, point) => (point.value > (best?.value ?? 0) ? point : best),
    null,
  );
  const axis = [points[0], points[Math.floor((points.length - 1) / 2)], points.at(-1)];

  return (
    <figure className="flex flex-1 flex-col">
      <div aria-hidden className="relative flex flex-1 flex-col">
        {/* Peak value marks the top of the scale; the baseline is zero. */}
        <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground tabular-nums">
          <span>{peak?.valueLabel}</span>
          <span className="h-px flex-1 border-t border-dashed" />
        </div>
        <div
          className={cn(
            "mt-1 flex min-h-40 flex-1 items-end border-b sm:min-h-48",
            points.length > 40 ? "gap-px" : "gap-0.5",
          )}
        >
          {points.map((point, index) => {
            const height = max > 0 ? (point.value / max) * 100 : 0;
            const edge =
              index < points.length / 4
                ? "start-0"
                : index > (points.length * 3) / 4
                  ? "end-0"
                  : "start-1/2 -translate-x-1/2 rtl:translate-x-1/2";
            return (
              <div key={point.key} className="group relative flex h-full flex-1 items-end">
                <div
                  className={cn(
                    "w-full rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-80",
                    point.value > 0 ? "min-h-0.5" : "h-0",
                  )}
                  style={{ height: `${height}%` }}
                />
                <div
                  className={cn(
                    "pointer-events-none absolute bottom-full z-10 mb-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100",
                    edge,
                  )}
                >
                  <span className="block text-muted-foreground">{point.label}</span>
                  <span className="block font-medium tabular-nums">{point.valueLabel}</span>
                  <span className="block text-muted-foreground">{point.ordersLabel}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[0.625rem] text-muted-foreground">
          {axis.map((point, index) => (
            <span key={`${point?.key}-${index}`}>{point?.label}</span>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.day}</th>
            <th scope="col">{labels.revenue}</th>
            <th scope="col">{labels.orders}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{point.valueLabel}</td>
              <td>{point.ordersLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
