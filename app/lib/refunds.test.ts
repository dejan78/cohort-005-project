import { describe, it, expect } from "vitest";
import {
  REFUND_WINDOW_DAYS,
  buildRefundRequestConfirmationEmail,
  checkRefundEligibility,
  getRefundableAmount,
  lastDayOfRefundWindow,
  type RefundFacts,
} from "./refunds";

// A Purchase that passes every rule. Each test breaks exactly one of them.
function eligibleFacts(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return {
    purchasedAt: new Date(2026, 10, 1, 12, 0).toISOString(),
    hasRefundRequest: false,
    isClaimedTeamSeat: false,
    secondsWatched: 0,
    completedLessonCount: 0,
    lessonCount: 10,
    ...overrides,
  };
}

const dayAfterPurchase = new Date(2026, 10, 2, 12, 0);

describe("checkRefundEligibility", () => {
  it("lets a fresh Purchase raise a Refund Request", () => {
    expect(checkRefundEligibility(eligibleFacts(), dayAfterPurchase)).toEqual({
      eligible: true,
      lastDayInWindow: "2026-11-15",
    });
  });

  it("refuses a Purchase that has ever had a Refund Request, even a declined one", () => {
    // One Refund Request per Purchase: a decline closes the matter.
    expect(
      checkRefundEligibility(
        eligibleFacts({ hasRefundRequest: true }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "already-requested" });
  });

  it("refuses a claimed team seat", () => {
    expect(
      checkRefundEligibility(
        eligibleFacts({ isClaimedTeamSeat: true }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "claimed-team-seat" });
  });

  describe("the Refund Window", () => {
    it("is open on the last whole day, even late in the evening", () => {
      // Bought 23:00 on 1 Nov — the fourteenth day after is 15 Nov, all of it.
      const facts = eligibleFacts({
        purchasedAt: new Date(2026, 10, 1, 23, 0).toISOString(),
      });
      const lateOnLastDay = new Date(2026, 10, 15, 23, 59);

      expect(checkRefundEligibility(facts, lateOnLastDay).eligible).toBe(true);
    });

    it("is closed the day after", () => {
      const dayAfterWindow = new Date(2026, 10, 16, 0, 1);

      expect(checkRefundEligibility(eligibleFacts(), dayAfterWindow)).toEqual({
        eligible: false,
        reason: "outside-window",
      });
    });

    it(`is ${REFUND_WINDOW_DAYS} days long`, () => {
      expect(REFUND_WINDOW_DAYS).toBe(14);
      expect(
        lastDayOfRefundWindow(new Date(2026, 10, 1, 9, 0).toISOString())
      ).toBe("2026-11-15");
    });
  });

  it("refuses a learner who has watched two hours or more", () => {
    expect(
      checkRefundEligibility(
        eligibleFacts({ secondsWatched: 2 * 60 * 60 }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "watched-too-much" });
  });

  it("allows a learner just under two hours", () => {
    expect(
      checkRefundEligibility(
        eligibleFacts({ secondsWatched: 2 * 60 * 60 - 1 }),
        dayAfterPurchase
      ).eligible
    ).toBe(true);
  });

  it("refuses a learner who has completed half the lessons or more", () => {
    // The server used to skip this rule while the page enforced it.
    expect(
      checkRefundEligibility(
        eligibleFacts({ completedLessonCount: 5, lessonCount: 10 }),
        dayAfterPurchase
      )
    ).toEqual({ eligible: false, reason: "completed-too-much" });
  });

  it("allows a learner just under half the lessons", () => {
    expect(
      checkRefundEligibility(
        eligibleFacts({ completedLessonCount: 4, lessonCount: 10 }),
        dayAfterPurchase
      ).eligible
    ).toBe(true);
  });

  it("does not divide by zero for a course with no lessons", () => {
    expect(
      checkRefundEligibility(
        eligibleFacts({ completedLessonCount: 0, lessonCount: 0 }),
        dayAfterPurchase
      ).eligible
    ).toBe(true);
  });
});

describe("getRefundableAmount", () => {
  it("is the list price for a full-price Purchase", () => {
    expect(
      getRefundableAmount({ amountPaid: 4000, country: "US" }, 5000)
    ).toBe(5000);
  });

  it("is the price actually paid for a purchasing-power Purchase", () => {
    expect(
      getRefundableAmount({ amountPaid: 2000, country: "IN" }, 5000)
    ).toBe(2000);
  });
});

describe("buildRefundRequestConfirmationEmail", () => {
  const email = buildRefundRequestConfirmationEmail({
    learnerName: "Ada",
    learnerEmail: "ada@example.com",
    courseTitle: "Intro to TypeScript",
    refundableAmount: 5000,
  });

  it("is addressed to the learner", () => {
    expect(email.to).toBe("ada@example.com");
  });

  it("names it a Refund Request in the subject", () => {
    expect(email.subject).toBe("Refund requested — Intro to TypeScript");
  });

  it("never uses the banned terms", () => {
    const text = `${email.subject}\n${email.body}`;
    expect(text).not.toMatch(/reversal|chargeback|cancel/i);
  });

  it("does not imply the Refund is approved", () => {
    expect(email.body).toMatch(/Refund Request/);
    expect(email.body).toMatch(/review/i);
  });
});
