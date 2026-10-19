"use client";

import { MotionConfig, motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * A list whose items fade and rise in, slightly staggered, whenever it is
 * rendered with new content (switching list ↔ grid, filtering, paging).
 * Reduced motion: no movement.
 */
export function MotionList({
  as = "ul",
  className,
  children,
}: {
  as?: "ul" | "tbody";
  className?: string;
  children: ReactNode;
}) {
  const Component = as === "tbody" ? motion.tbody : motion.ul;
  return (
    <MotionConfig reducedMotion="user">
      <Component
        initial="hidden"
        animate="shown"
        variants={{ shown: { transition: { staggerChildren: 0.025 } } }}
        className={className}
      >
        {children}
      </Component>
    </MotionConfig>
  );
}

const item = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] as const } },
};

export function MotionItem({
  as = "li",
  className,
  children,
}: {
  as?: "li" | "tr";
  className?: string;
  children: ReactNode;
}) {
  const Component = as === "tr" ? motion.tr : motion.li;
  return (
    <Component variants={item} className={className}>
      {children}
    </Component>
  );
}
