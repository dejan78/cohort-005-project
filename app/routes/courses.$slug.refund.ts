import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, refunds, users, RefundStatus } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import {
  REFUND_INELIGIBLE_MESSAGES,
  buildRefundRequestConfirmationEmail,
} from "~/lib/refunds";
import { getRefundEligibility } from "~/lib/refunds.server";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

/** Raises a Refund Request. An Admin approves or declines it later. */
export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = db.select().from(courses).where(eq(courses.slug, slug)).get();

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const learner = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!learner) {
    throw data("User not found", { status: 404 });
  }

  const refund = getRefundEligibility(currentUserId, course);

  if (!refund) {
    throw data("You have not bought this course.", { status: 403 });
  }

  if (!refund.eligibility.eligible) {
    const { reason } = refund.eligibility;
    throw data(REFUND_INELIGIBLE_MESSAGES[reason], {
      status: reason === "already-requested" ? 409 : 403,
    });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  db.insert(refunds)
    .values({
      purchaseId: refund.purchaseId,
      status: RefundStatus.Requested,
      reason: parsed.data.reason,
    })
    .run();

  // There is no mail transport wired up yet, so the built message goes to the
  // server log.
  const email = buildRefundRequestConfirmationEmail({
    learnerName: learner.name,
    learnerEmail: learner.email,
    courseTitle: course.title,
    refundableAmount: refund.refundableAmount,
  });

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return redirect("/settings");
}
