// Gathers the facts the Refund Eligibility rules in refunds.ts need, so the
// course page and the refund route judge a Purchase the same way.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
} from "~/db/schema";
import {
  checkRefundEligibility,
  getRefundableAmount,
  type RefundEligibility,
} from "~/lib/refunds";

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function hasRefundRequest(purchaseId: number): boolean {
  const row = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .get();
  return row !== undefined;
}

function isClaimedTeamSeat(purchaseId: number): boolean {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
  return row !== undefined;
}

function getSecondsWatched(userId: number, lessonIds: number[]): number {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]): number {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

/**
 * The learner's latest Purchase of a course, judged against Refund
 * Eligibility, or null if they never bought it.
 */
export function getRefundEligibility(
  userId: number,
  course: { id: number; price: number },
  now: Date = new Date()
): {
  purchaseId: number;
  refundableAmount: number;
  eligibility: RefundEligibility;
} | null {
  const purchase = getLatestPurchase(userId, course.id);
  if (!purchase) return null;

  const lessonIds = getLessonIdsForCourse(course.id);

  const eligibility = checkRefundEligibility(
    {
      purchasedAt: purchase.createdAt,
      hasRefundRequest: hasRefundRequest(purchase.id),
      isClaimedTeamSeat: isClaimedTeamSeat(purchase.id),
      secondsWatched: getSecondsWatched(userId, lessonIds),
      completedLessonCount: getCompletedLessonCount(userId, lessonIds),
      lessonCount: lessonIds.length,
    },
    now
  );

  return {
    purchaseId: purchase.id,
    refundableAmount: getRefundableAmount(purchase, course.price),
    eligibility,
  };
}
