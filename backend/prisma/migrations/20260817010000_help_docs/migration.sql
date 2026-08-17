-- In-app manual, one row per language.
--
-- Content in the database, not in the repo: the manual gets corrected far more
-- often than the app gets released, and a correction that needs a deploy is a
-- correction that does not happen.

CREATE TABLE "help_docs" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "locale"        TEXT NOT NULL,
    "title"         TEXT,
    "html"          TEXT NOT NULL,
    "version"       INTEGER NOT NULL DEFAULT 1,
    "publishedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_docs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "help_docs_tenantId_locale_key" ON "help_docs"("tenantId", "locale");
CREATE INDEX "help_docs_tenantId_idx" ON "help_docs"("tenantId");

ALTER TABLE "help_docs"
  ADD CONSTRAINT "help_docs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "help_docs"
  ADD CONSTRAINT "help_docs_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
