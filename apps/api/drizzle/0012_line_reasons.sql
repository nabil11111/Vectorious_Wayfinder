ALTER TABLE "issue_lines" ADD COLUMN "reason" text;--> statement-breakpoint
-- Q-40: a shop's report kept before its lines had reasons gives each short line the report's one reason.
UPDATE "issue_lines" SET "reason" = "issues"."reason" FROM "issues"
  WHERE "issues"."id" = "issue_lines"."issue_id" AND "issues"."kind" = 'receipt' AND "issues"."reason" IN ('missing', 'damaged') AND "issue_lines"."counted" > 0;
