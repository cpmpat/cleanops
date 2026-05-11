import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { Storage, Bucket } from '@google-cloud/storage';
import { randomBytes } from 'crypto';

/**
 * Allowed event types in the filename. Each photo is tagged with one of these
 * so a manager browsing the bucket can identify the photo's origin at a glance.
 */
export type MediaEventType =
  | 'cleaning'
  | 'incident'
  | 'manual'
  | 'repair'
  | 'inspection';

const ALLOWED_EVENT_TYPES: MediaEventType[] = [
  'cleaning',
  'incident',
  'manual',
  'repair',
  'inspection',
];

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB

const SIGNED_URL_TTL_MINUTES = 15;

@Injectable()
export class GcsService implements OnModuleInit {
  private readonly logger = new Logger(GcsService.name);
  private storage: Storage | null = null;
  private bucket: Bucket | null = null;
  private bucketName = '';

  onModuleInit() {
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
    this.bucketName = process.env.GCP_MEDIA_BUCKET || '';

    if (!raw || !this.bucketName) {
      this.logger.warn(
        'GCP_SERVICE_ACCOUNT_JSON or GCP_MEDIA_BUCKET not set \u2014 GCS uploads disabled. ' +
          'Signed URL endpoints will throw at request time.',
      );
      return;
    }

    let credentials: any;
    try {
      credentials = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      this.logger.error('GCP_SERVICE_ACCOUNT_JSON is not valid JSON; GCS disabled.');
      return;
    }

    this.storage = new Storage({
      projectId: credentials.project_id,
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    });
    this.bucket = this.storage.bucket(this.bucketName);
    this.logger.log(
      `GCS initialized: bucket=${this.bucketName} project=${credentials.project_id}`,
    );
  }

  // ─── PUBLIC API ─────────────────────────────────────────────

  /**
   * Generate a signed URL the client can PUT a file to directly.
   * The returned `key` is the GCS object path; the client must also
   * call back to the backend (e.g. cleaning-events.markDone or
   * incidents.addAttachment) with that key to persist the reference.
   */
  async signUploadUrl(params: {
    pmsPropertyId: string;
    eventType: MediaEventType;
    contentType: string;
    sizeBytes?: number;
  }): Promise<{
    key: string;
    uploadUrl: string;
    publicUrl: string;
    expiresAt: string;
  }> {
    this.assertReady();

    if (!ALLOWED_EVENT_TYPES.includes(params.eventType)) {
      throw new BadRequestException(
        `Invalid eventType. Allowed: ${ALLOWED_EVENT_TYPES.join(', ')}`,
      );
    }
    if (!ALLOWED_MIME_TYPES.includes(params.contentType)) {
      throw new BadRequestException(
        `Invalid contentType. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
    if (params.sizeBytes != null && params.sizeBytes > MAX_PHOTO_BYTES) {
      throw new BadRequestException(
        `File too large. Max ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`,
      );
    }
    if (!params.pmsPropertyId) {
      throw new BadRequestException('pmsPropertyId is required');
    }

    const key = this.makeKey(params.pmsPropertyId, params.eventType, params.contentType);
    const file = this.bucket!.file(key);
    const expiresMs = Date.now() + SIGNED_URL_TTL_MINUTES * 60 * 1000;

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresMs,
      contentType: params.contentType,
    });

    // GCS bucket is private; serve photos through a separate signed-read URL
    // when needed. publicUrl here is the canonical object URL (not directly accessible).
    const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${encodeURI(key)}`;

    return {
      key,
      uploadUrl,
      publicUrl,
      expiresAt: new Date(expiresMs).toISOString(),
    };
  }

  /**
   * Generate a short-lived signed READ URL so the frontend can render a
   * private bucket object (e.g. show photo in incident detail). Default 1 hour TTL.
   */
  async signReadUrl(key: string, ttlMinutes = 60): Promise<string> {
    this.assertReady();
    if (!key) throw new BadRequestException('key is required');

    const [url] = await this.bucket!.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlMinutes * 60 * 1000,
    });
    return url;
  }

  /**
   * On property sync: create a zero-byte placeholder at
   *   {pmsPropertyId}/.keep
   * so the folder shows up in the GCP console even before any real photo
   * is uploaded. Idempotent (silently no-ops if it already exists).
   */
  async createPropertyFolderPlaceholder(pmsPropertyId: string): Promise<void> {
    if (!this.bucket) return; // GCS not configured \u2014 skip
    if (!pmsPropertyId) return;

    const key = `${pmsPropertyId}/.keep`;
    try {
      const file = this.bucket.file(key);
      const [exists] = await file.exists();
      if (exists) return;

      await file.save('', {
        contentType: 'application/octet-stream',
        metadata: {
          metadata: {
            purpose: 'folder-placeholder',
            createdBy: 'cleanops-property-sync',
            createdAt: new Date().toISOString(),
          },
        },
      });
      this.logger.log(`Created folder placeholder: ${key}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to create folder placeholder for ${pmsPropertyId}: ${err.message}`,
      );
    }
  }

  // ─── INTERNAL ───────────────────────────────────────────────

  private assertReady() {
    if (!this.bucket) {
      throw new BadRequestException(
        'Photo storage is not configured on the server (GCP env vars missing).',
      );
    }
  }

  /**
   * Build the GCS object key:
   *   {pmsPropertyId}/{ISO_timestamp}_{eventType}_{shortRandom}.{ext}
   *
   * Example:
   *   accommodation-562885/2026-05-11T18-32-00Z_cleaning_a3f9.jpg
   *
   * The ISO timestamp uses safe characters (colons replaced with dashes).
   * The shortRandom (4 hex chars) prevents collisions when two uploads
   * happen in the same second.
   */
  private makeKey(
    pmsPropertyId: string,
    eventType: MediaEventType,
    contentType: string,
  ): string {
    const ext = this.mimeToExt(contentType);
    // 2026-05-11T18:32:00.000Z  ->  2026-05-11T18-32-00Z
    const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+/, '');
    const rand = randomBytes(2).toString('hex'); // 4 hex chars
    return `${pmsPropertyId}/${ts}_${eventType}_${rand}.${ext}`;
  }

  private mimeToExt(mime: string): string {
    switch (mime) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      case 'image/heic':
        return 'heic';
      default:
        return 'bin';
    }
  }
}
