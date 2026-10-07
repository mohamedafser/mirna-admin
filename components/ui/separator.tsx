import { cn } from "@/lib/utils/cn";

export function Separator({ className }: { className?: string }) {
  return <hr className={cn("my-1.5 border-t border-border", className)} />;
}
