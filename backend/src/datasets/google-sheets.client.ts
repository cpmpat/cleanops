import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';

/**
 * Minimal read-only Google Sheets v4 client.
 *
 * Authenticates with the same service account the rest of the Google
 * integrations use (`GCP_SERVICE_ACCOUNT_JSON`). The spreadsheet has to be
 * shared with that account's `client_email` — Reader is enough. Nothing here
 * ever writes: the scope requested is `spreadsheets.readonly`, so a bug cannot
 * modify the source even if it tries.
 *
 * `google-auth-library` is declared as a direct dependency on purpose. It
 * already sits in the tree under @google-cloud/*, and importing it through
 * that path is exactly the mistake that took production down with
 * "Cannot find module 'express'" — pnpm does not hoist transitive deps.
 */
@Injectable()
export class GoogleSheetsClient {
  private readonly logger = new Logger(GoogleSheetsClient.name);
  private auth: GoogleAuth | null = null;

  private getAuth(): GoogleAuth {
    if (this.auth) return this.auth;

    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      throw new ServiceUnavailableException(
        'GCP_SERVICE_ACCOUNT_JSON is not set — Datasets cannot read Google Sheets.',
      );
    }

    let credentials: { client_email: string; private_key: string };
    try {
      credentials = typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
    } catch {
      throw new ServiceUnavailableException(
        'GCP_SERVICE_ACCOUNT_JSON is not valid JSON — Datasets cannot read Google Sheets.',
      );
    }

    this.auth = new GoogleAuth({
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return this.auth;
  }

  /** The service account address a spreadsheet has to be shared with. */
  serviceAccountEmail(): string | null {
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
      return parsed.client_email ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Read one tab whole.
   *
   * Returns columns and rows as parallel arrays rather than objects, because
   * this spreadsheet genuinely repeats header names (`status` appears twice,
   * so do `bedroom` and `bathroom`). Keyed objects would silently drop one of
   * every duplicated pair.
   */
  async readTab(
    spreadsheetId: string,
    tab: string,
  ): Promise<{ columns: string[]; rows: string[][] }> {
    const client = await this.getAuth().getClient();
    const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
      `/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;

    let values: string[][];
    try {
      const res = await client.request<{ values?: string[][] }>({ url });
      values = res.data.values ?? [];
    } catch (err: any) {
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.error?.message ?? err?.message ?? 'unknown error';
      this.logger.error(`Sheets read failed for tab "${tab}": ${status} ${detail}`);

      if (status === 403 || status === 404) {
        throw new ServiceUnavailableException(
          `Cannot read the sheet. Share it with ${this.serviceAccountEmail() ?? 'the service account'} ` +
          `as Viewer, and check the tab "${tab}" exists.`,
        );
      }
      throw new ServiceUnavailableException(`Google Sheets error: ${detail}`);
    }

    if (values.length === 0) return { columns: [], rows: [] };

    const [header, ...body] = values;
    const columns = header.map((c, i) => (c?.trim() ? c.trim() : `column ${i + 1}`));

    // Sheets omits trailing empty cells, so rows arrive ragged. Pad them, or
    // the table renders with cells shifted under the wrong headers.
    const rows = body.map((row) => {
      const padded = columns.map((_, i) => row[i] ?? '');
      return padded;
    });

    return { columns, rows };
  }
}
