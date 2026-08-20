-- Conversations: the open, two-way channel attached to a turnover.
--
-- Notes (announcements) stay as they are — closed, top-down, acknowledged.
-- This is the other half: a thread that belongs to a piece of work, so the
-- history of a flat is answerable later instead of living in someone's phone.

CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "MessageKind"        AS ENUM ('TEXT', 'SYSTEM');
CREATE TYPE "AttachmentKind"     AS ENUM ('IMAGE', 'VIDEO');

-- ─── conversations ───────────────────────────────────────────────────────────
CREATE TABLE "conversations" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "turnoverId"    TEXT NOT NULL,
    "createdById"   TEXT NOT NULL,
    "status"        "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversations_tenantId_lastMessageAt_idx" ON "conversations"("tenantId", "lastMessageAt");
CREATE INDEX "conversations_turnoverId_idx" ON "conversations"("turnoverId");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_turnoverId_fkey"
  FOREIGN KEY ("turnoverId") REFERENCES "turnovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── conversation_members ────────────────────────────────────────────────────
CREATE TABLE "conversation_members" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "addedById"      TEXT,
    "addedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt"         TIMESTAMP(3),
    "lastReadAt"     TIMESTAMP(3),

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_members_conversationId_userId_key"
  ON "conversation_members"("conversationId", "userId");
CREATE INDEX "conversation_members_userId_idx" ON "conversation_members"("userId");

ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── conversation_messages ───────────────────────────────────────────────────
CREATE TABLE "conversation_messages" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId"       TEXT,
    "kind"           "MessageKind" NOT NULL DEFAULT 'TEXT',
    "body"           TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt"       TIMESTAMP(3),

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_messages_conversationId_createdAt_idx"
  ON "conversation_messages"("conversationId", "createdAt");

ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── message_attachments ─────────────────────────────────────────────────────
CREATE TABLE "message_attachments" (
    "id"        TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind"      "AttachmentKind" NOT NULL DEFAULT 'IMAGE',
    "url"       TEXT NOT NULL,
    "mimeType"  TEXT,
    "bytes"     INTEGER,
    "width"     INTEGER,
    "height"    INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_attachments_messageId_idx" ON "message_attachments"("messageId");

ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "conversation_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
