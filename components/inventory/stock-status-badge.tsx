import { CircleCheck, CircleDashed, CircleX, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { StockStatus } from "@/lib/inventory/rules";

const styles = {
  in_stock: { tone: "success", icon: CircleCheck },
  low_stock: { tone: "warning", icon: TriangleAlert },
  out_of_stock: { tone: "error", icon: CircleX },
  unconfigured: { tone: "neutral", icon: CircleDashed },
} as const;

/** Stock status as icon + text (never color alone). */
export function StockStatusBadge({ status, label }: { status: StockStatus; label: string }) {
  const { tone, icon: Icon } = styles[status];
  return (
    <Badge tone={tone} className="whitespace-nowrap">
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
