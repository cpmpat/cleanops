-- Google Sheets id backing the read-only Datasets module.
-- The sheet must be shared with the GCP_SERVICE_ACCOUNT_JSON service account
-- as Viewer; nothing in the app ever writes back to it.
ALTER TABLE "tenants" ADD COLUMN "datasetsSheetId" TEXT;
