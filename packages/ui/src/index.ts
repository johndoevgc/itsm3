/**
 * @module ui
 * Shared UI components for VGC ITSM.
 * All components are WCAG 2.2 AA compliant.
 * All animations respect prefers-reduced-motion.
 */

export { Badge, type BadgeProps } from './components/Badge.js';
export { SeverityBadge } from './components/SeverityBadge.js';
export { P1Alert } from './components/P1Alert.js';
export { fadeInUp, staggerContainer, p1Pulse, type MotionVariant } from './motion/variants.js';
export type { TicketSeverity, TicketStatus } from './types.js';
