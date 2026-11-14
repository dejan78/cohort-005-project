// ─── Refunds ───
// Refund Eligibility, the Refundable Amount and the Refund Request
// Confirmation email, defined once. The terms are in GLOSSARY.md.
//
// Imported by both the course page and the refund route, so nothing here may
// touch the database or the request — refunds.server.ts gathers the facts.

import { getDiscountForCountry } from "~/lib/ppp";
import { formatPrice } from "~/lib/utils";

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

/** What the rules need to know about one Purchase. */
export type RefundFacts = {
  purchasedAt: string;
  /** Any Refund Request at all — open, approved or declined. */
  hasRefundRequest: boolean;
  isClaimedTeamSeat: boolean;
  secondsWatched: number;
  completedLessonCount: number;
  lessonCount: number;
};

export type RefundIneligibleReason =
  | "already-requested"
  | "claimed-team-seat"
  | "outside-window"
  | "watched-too-much"
  | "completed-too-much";

export type RefundEligibility =
  | { eligible: true; lastDayInWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

// The Refund Window is counted in whole days, not hours — someone who buys at
// 23:00 still gets the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAt: string): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export function checkRefundEligibility(
  facts: RefundFacts,
  now: Date
): RefundEligibility {
  if (facts.hasRefundRequest) {
    return { eligible: false, reason: "already-requested" };
  }

  if (facts.isClaimedTeamSeat) {
    return { eligible: false, reason: "claimed-team-seat" };
  }

  const today = calendarDay(now);
  const lastDayInWindow = lastDayOfRefundWindow(facts.purchasedAt);
  const purchasedDay = calendarDay(new Date(facts.purchasedAt));

  if (today < purchasedDay || today > lastDayInWindow) {
    return { eligible: false, reason: "outside-window" };
  }

  if (facts.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "watched-too-much" };
  }

  if (
    facts.lessonCount > 0 &&
    facts.completedLessonCount / facts.lessonCount >= REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "completed-too-much" };
  }

  return { eligible: true, lastDayInWindow };
}

/** Why a Refund Request was refused, in words the learner can read. */
export const REFUND_INELIGIBLE_MESSAGES: Record<RefundIneligibleReason, string> =
  {
    "already-requested":
      "You have already raised a Refund Request on this purchase.",
    "claimed-team-seat": "A claimed team seat cannot be refunded.",
    "outside-window": `The ${REFUND_WINDOW_DAYS}-day Refund Window has closed.`,
    "watched-too-much":
      "You have watched too much of this course to request a refund.",
    "completed-too-much":
      "You have completed too much of this course to request a refund.",
  };

/**
 * A purchasing-power price is given back at the price that was paid, not at
 * the list price of the course.
 */
export function getRefundableAmount(
  purchase: { amountPaid: number; country: string | null },
  listPrice: number
): number {
  return getDiscountForCountry(purchase.country) > 0
    ? purchase.amountPaid
    : listPrice;
}

/**
 * Tells the learner their Refund Request was received. It does not mean the
 * request was approved.
 */
export function buildRefundRequestConfirmationEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  refundableAmount: number;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund requested — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have your Refund Request for "${input.courseTitle}".`,
      `If it is approved, you will get ${formatPrice(input.refundableAmount)} back.`,
      "",
      "Our team reviews every Refund Request by hand. You do not need to do anything else — we will email you again once it has been approved or declined.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
