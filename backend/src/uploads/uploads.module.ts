import { Module } from '@nestjs/common';
import {
  Controller, Post, Body, Param, UseGuards, Req,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { GcsService, MediaEventType } from '../storage/gcs.service';
import { randomUUID } from 'crypto';

// ─── DTO ────────────────────────────────────────────────────

interface SignUploadDto {
  propertyId?: string;        // CleanOps internal Property.id
  pmsPropertyId?: string;     // OR raw Avantio id
  eventType: MediaEventType;  // cleaning | incident | manual | repair | inspection
  contentType: string;        // image/jpeg, image/png, ...
  sizeBytes?: number;
}

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private prisma: PrismaService,
    private gcs: GcsService,
  ) {}

  /**
   * Resolve a property to its pmsPropertyId (the bucket folder name).
   * Accepts either internal id or PMS id; verifies tenant ownership.
   */
  async resolvePropertyFolder(
    tenantId: string,
    propertyId?: string,
    pmsPropertyId?: string,
  ): Promise<string> {
    if (pmsPropertyId) {
      const p = await this.prisma.property.findFirst({
        where: { tenantId, pmsPropertyId },
        select: { pmsPropertyId: true },
      });
      if (!p?.pmsPropertyId) throw new NotFoundException('Property not found');
      return p.pmsPropertyId;
    }
    if (propertyId) {
      const p = await this.prisma.property.findFirst({
        where: { tenantId, id: propertyId },
        select: { pmsPropertyId: true },
      });
      if (!p?.pmsPropertyId) {
        throw new NotFoundException(
          'Property not found or missing pmsPropertyId',
        );
      }
      return p.pmsPropertyId;
    }
    throw new NotFoundException('propertyId or pmsPropertyId is required');
  }

  /**
   * Legacy local-disk fallback. Kept so any old callers don't break, but the
   * preferred path is signed-URL → direct-to-GCS.
   */
  async legacyUploadPhoto(
    cleaningEventId: string,
    assignmentId: string | null,
    file: Express.Multer.File,
  ) {
    const url = `/uploads/${randomUUID()}-${file.originalname}`;
    return this.prisma.cleaningPhoto.create({
      data: {
        cleaningEventId,
        cleaningAssignmentId: assignmentId,
        url,
      },
    });
  }
}

// ─── Controller ─────────────────────────────────────────────

@ApiTags('Uploads')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(
    private service: UploadsService,
    private gcs: GcsService,
  ) {}

  /**
   * Preferred upload flow:
   *   1. Frontend calls POST /uploads/signed-url with eventType + content-type.
   *   2. Backend returns { uploadUrl, publicUrl, key, expiresAt }.
   *   3. Frontend PUTs the file directly to uploadUrl (no proxy through backend).
   *   4. Frontend then calls e.g. /cleaning-events/:id/done with photoUrls=[publicUrl]
   *      or /incidents/:id/attachments to persist the reference.
   */
  @Post('signed-url')
  @ApiOperation({ summary: 'Get a signed URL to PUT a photo directly to GCS' })
  async signedUrl(@Req() req: TenantRequest, @Body() dto: SignUploadDto) {
    const folder = await this.service.resolvePropertyFolder(
      req.tenantId!,
      dto.propertyId,
      dto.pmsPropertyId,
    );
    return this.gcs.signUploadUrl({
      pmsPropertyId: folder,
      eventType: dto.eventType,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
    });
  }

  /**
   * Get a short-lived signed READ URL for displaying a private GCS object.
   * The frontend calls this when it needs to render a photo whose `key` is
   * stored in the DB (e.g. incident attachments).
   */
  @Post('read-url')
  @ApiOperation({ summary: 'Get a signed READ URL for a private bucket object' })
  async readUrl(@Body() dto: { key: string; ttlMinutes?: number }) {
    const url = await this.gcs.signReadUrl(dto.key, dto.ttlMinutes);
    return { url };
  }

  /**
   * Legacy endpoint \u2014 kept for backward compatibility only. New uploads
   * should use POST /uploads/signed-url instead.
   */
  @Post('event/:eventId/photo')
  @UseInterceptors(FileInterceptor('file'))
  legacyUploadPhoto(
    @Param('eventId') eventId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    return this.service.legacyUploadPhoto(
      eventId,
      req.body?.assignmentId || null,
      file,
    );
  }
}

// ─── Module ─────────────────────────────────────────────────

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
