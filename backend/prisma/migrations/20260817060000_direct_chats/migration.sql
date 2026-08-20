-- Two kinds of chat.
--
-- A turnover chat belongs to a cleaning and is opened by whoever is doing it.
-- A direct chat belongs to people, is opened only by the office, and therefore
-- has no turnover to hang off — hence the nullable column and the subject line.

CREATE TYPE "ChatKind" AS ENUM ('TURNOVER', 'DIRECT');

ALTER TABLE "turnover_chats" ADD COLUMN "kind" "ChatKind" NOT NULL DEFAULT 'TURNOVER';
ALTER TABLE "turnover_chats" ADD COLUMN "title" TEXT;
ALTER TABLE "turnover_chats" ALTER COLUMN "turnoverId" DROP NOT NULL;

CREATE INDEX "turnover_chats_tenantId_kind_idx" ON "turnover_chats"("tenantId", "kind");
