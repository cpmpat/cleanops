-- Rename the conversation tables to the product's own word for them, and add
-- the two columns the 30-day sweep needs.
--
-- These are turnover chats: a thread is meaningless without the piece of work
-- it hangs off, so the table says so. Indexes and constraints are renamed with
-- the tables — Postgres would happily keep the old names, but then Prisma sees
-- drift on the next migrate and wants a corrective migration.

ALTER TABLE "conversations"          RENAME TO "turnover_chats";
ALTER TABLE "conversation_members"   RENAME TO "turnover_chat_members";
ALTER TABLE "conversation_messages"  RENAME TO "turnover_chat_messages";
ALTER TABLE "message_attachments"    RENAME TO "turnover_chat_attachments";

-- ─── constraint + index names ────────────────────────────────────────────────
ALTER INDEX "conversations_pkey"                          RENAME TO "turnover_chats_pkey";
ALTER INDEX "conversations_tenantId_lastMessageAt_idx"    RENAME TO "turnover_chats_tenantId_lastMessageAt_idx";
ALTER INDEX "conversations_turnoverId_idx"                RENAME TO "turnover_chats_turnoverId_idx";
ALTER TABLE "turnover_chats" RENAME CONSTRAINT "conversations_tenantId_fkey"    TO "turnover_chats_tenantId_fkey";
ALTER TABLE "turnover_chats" RENAME CONSTRAINT "conversations_turnoverId_fkey"  TO "turnover_chats_turnoverId_fkey";
ALTER TABLE "turnover_chats" RENAME CONSTRAINT "conversations_createdById_fkey" TO "turnover_chats_createdById_fkey";

ALTER INDEX "conversation_members_pkey"                        RENAME TO "turnover_chat_members_pkey";
ALTER INDEX "conversation_members_conversationId_userId_key"   RENAME TO "turnover_chat_members_conversationId_userId_key";
ALTER INDEX "conversation_members_userId_idx"                  RENAME TO "turnover_chat_members_userId_idx";
ALTER TABLE "turnover_chat_members" RENAME CONSTRAINT "conversation_members_conversationId_fkey" TO "turnover_chat_members_conversationId_fkey";
ALTER TABLE "turnover_chat_members" RENAME CONSTRAINT "conversation_members_userId_fkey"         TO "turnover_chat_members_userId_fkey";
ALTER TABLE "turnover_chat_members" RENAME CONSTRAINT "conversation_members_addedById_fkey"      TO "turnover_chat_members_addedById_fkey";

ALTER INDEX "conversation_messages_pkey"                             RENAME TO "turnover_chat_messages_pkey";
ALTER INDEX "conversation_messages_conversationId_createdAt_idx"     RENAME TO "turnover_chat_messages_conversationId_createdAt_idx";
ALTER TABLE "turnover_chat_messages" RENAME CONSTRAINT "conversation_messages_conversationId_fkey" TO "turnover_chat_messages_conversationId_fkey";
ALTER TABLE "turnover_chat_messages" RENAME CONSTRAINT "conversation_messages_authorId_fkey"       TO "turnover_chat_messages_authorId_fkey";

ALTER INDEX "message_attachments_pkey"           RENAME TO "turnover_chat_attachments_pkey";
ALTER INDEX "message_attachments_messageId_idx"  RENAME TO "turnover_chat_attachments_messageId_idx";
ALTER TABLE "turnover_chat_attachments" RENAME CONSTRAINT "message_attachments_messageId_fkey" TO "turnover_chat_attachments_messageId_fkey";

-- ─── star + archive ──────────────────────────────────────────────────────────
ALTER TABLE "turnover_chats"        ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "turnover_chat_members" ADD COLUMN "starred"    BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "turnover_chats_archivedAt_idx" ON "turnover_chats"("archivedAt");
