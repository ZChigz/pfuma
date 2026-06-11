-- DropIndex
DROP INDEX "SubjectAssignment_teacherId_subjectId_term_key";

-- CreateIndex
CREATE UNIQUE INDEX "SubjectAssignment_subjectId_classId_term_key" ON "SubjectAssignment"("subjectId", "classId", "term");
