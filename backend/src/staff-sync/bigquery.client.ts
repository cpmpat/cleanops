import { Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { SYNCED_POSITIONS } from './position-mapping';

export interface CdmUserRow {
  userId: string;       // stable join key from cdm_user
  firstName: string;
  lastName: string;
  email: string;        // normalized (lowercase, trimmed)
  position: string;
  validity: string;
}

@Injectable()
export class BigQueryClient {
  private readonly logger = new Logger(BigQueryClient.name);
  private readonly bq: BigQuery;
  private readonly projectId = 'avantio-intergation';
  private readonly dataset = 'airstay_data';
  private readonly table = 'cdm_user';

  constructor() {
    // Auth uses Application Default Credentials:
    //   dev:  `gcloud auth application-default login`
    //   prod: GOOGLE_APPLICATION_CREDENTIALS env var → service account JSON
    this.bq = new BigQuery({ projectId: this.projectId });
  }

  async fetchValidStaff(): Promise<CdmUserRow[]> {
    const query = `
      SELECT
        userId,
        firstName,
        lastName,
        LOWER(TRIM(email1)) AS email,
        position,
        validity
      FROM \`${this.projectId}.${this.dataset}.${this.table}\`
      WHERE validity = 'Valid'
        AND position IN UNNEST(@positions)
        AND email1 IS NOT NULL
        AND TRIM(email1) != ''
    `;

    const [rows] = await this.bq.query({
      query,
      params: { positions: SYNCED_POSITIONS },
    });

    this.logger.log(`Fetched ${rows.length} valid staff rows from cdm_user`);
    return rows as CdmUserRow[];
  }
}
