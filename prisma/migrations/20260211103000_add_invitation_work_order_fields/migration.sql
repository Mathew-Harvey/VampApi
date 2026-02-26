-- Alter invitations to track pending work-order assignment context
ALTER TABLE "invitations" ADD COLUMN "workOrderId" TEXT;
ALTER TABLE "invitations" ADD COLUMN "assignmentRole" TEXT;
