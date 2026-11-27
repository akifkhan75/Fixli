-- CreateIndex
CREATE INDEX "Dispute_jobRequestId_status_idx" ON "Dispute"("jobRequestId", "status");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JobRequest_customerId_createdAt_idx" ON "JobRequest"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRequest_assignedWorkerId_status_idx" ON "JobRequest"("assignedWorkerId", "status");

-- CreateIndex
CREATE INDEX "Payment_status_markedAt_idx" ON "Payment"("status", "markedAt");

-- CreateIndex
CREATE INDEX "Worker_activationStatus_serviceLat_serviceLng_idx" ON "Worker"("activationStatus", "serviceLat", "serviceLng");

-- CreateIndex
CREATE INDEX "WorkerService_categoryId_idx" ON "WorkerService"("categoryId");

