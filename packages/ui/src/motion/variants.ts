/**
 * Framer Motion animation variants.
 * All animations respect prefers-reduced-motion via Framer Motion's useReducedMotion.
 */

export type MotionVariant = {
  hidden: Record<string, unknown>;
  visible: Record<string, unknown>;
};

export const fadeInUp: MotionVariant = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

export const staggerContainer: MotionVariant = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

/**
 * P1 pulse animation — red pulse for critical alerts.
 * CSS fallback in globals.css for environments without Framer Motion.
 */
export const p1Pulse = {
  animate: {
    opacity: [1, 0.5, 1],
    scale: [1, 1.02, 1],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};
