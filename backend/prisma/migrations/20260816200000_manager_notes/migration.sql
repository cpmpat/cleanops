-- Manager messages ("Zpráva od manažera") + WhatsApp contact number.
--
-- Three tables:
--   notes         the message itself, Czech body mandatory, EN/RU/UA optional
--   note_targets  either named users OR properties — never both (CHECK below)
--   note_acks     one row per (message, person, version) confirmation
--
-- users.mobileNumber is the source for the wa.me deep link on the message.
-- It is deliberately on the AUTHOR: whoever published the message is the one
-- the cleaner can reach.

-- ─── users.mobileNumber ──────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN "mobileNumber" TEXT;

-- ─── enum ────────────────────────────────────────────────────────────────────
CREATE TYPE "NoteTargetType" AS ENUM ('STAFF', 'PROPERTY');

-- ─── notes ───────────────────────────────────────────────────────────────────
CREATE TABLE "notes" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "authorId"   TEXT NOT NULL,
    "targetType" "NoteTargetType" NOT NULL,
    "title"      TEXT NOT NULL,
    "bodyCs"     TEXT NOT NULL,
    "bodyEn"     TEXT,
    "bodyRu"     TEXT,
    "bodyUk"     TEXT,
    "validFrom"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "version"    INTEGER NOT NULL DEFAULT 1,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notes_tenantId_isArchived_validUntil_idx"
  ON "notes"("tenantId", "isArchived", "validUntil");

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── note_targets ────────────────────────────────────────────────────────────
CREATE TABLE "note_targets" (
    "id"         TEXT NOT NULL,
    "noteId"     TEXT NOT NULL,
    "userId"     TEXT,
    "propertyId" TEXT,

    CONSTRAINT "note_targets_pkey" PRIMARY KEY ("id")
);

-- Exactly one of userId / propertyId. The UI has a segmented control for this,
-- but the rule lives here so no API path can create a mixed-target message.
ALTER TABLE "note_targets"
  ADD CONSTRAINT "note_targets_exactly_one_target"
  CHECK (("userId" IS NOT NULL AND "propertyId" IS NULL)
      OR ("userId" IS NULL AND "propertyId" IS NOT NULL));

CREATE UNIQUE INDEX "note_targets_noteId_userId_key"     ON "note_targets"("noteId", "userId");
CREATE UNIQUE INDEX "note_targets_noteId_propertyId_key" ON "note_targets"("noteId", "propertyId");
CREATE INDEX "note_targets_userId_idx"     ON "note_targets"("userId");
CREATE INDEX "note_targets_propertyId_idx" ON "note_targets"("propertyId");

ALTER TABLE "note_targets"
  ADD CONSTRAINT "note_targets_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "notes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_targets"
  ADD CONSTRAINT "note_targets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_targets"
  ADD CONSTRAINT "note_targets_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── note_acks ───────────────────────────────────────────────────────────────
CREATE TABLE "note_acks" (
    "id"          TEXT NOT NULL,
    "noteId"      TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "version"     INTEGER NOT NULL,
    "localeShown" TEXT,
    "ackedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_acks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "note_acks_noteId_userId_version_key"
  ON "note_acks"("noteId", "userId", "version");
CREATE INDEX "note_acks_userId_idx" ON "note_acks"("userId");

ALTER TABLE "note_acks"
  ADD CONSTRAINT "note_acks_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "notes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_acks"
  ADD CONSTRAINT "note_acks_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
