-- AlterTable
ALTER TABLE "agent_tokens" ADD COLUMN     "previousToken" TEXT,
ADD COLUMN     "previousTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_previousToken_key" ON "agent_tokens"("previousToken");
