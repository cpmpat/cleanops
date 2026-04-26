import { Module } from '@nestjs/common';
import {
  Controller, Post, Param, UseGuards, Req, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { TenantRequest } from '../common/middleware/tenant.middleware';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { randomUUID } from 'crypto';

// ─── Service ───
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private prisma: PrismaService) {}

  async uploadPhoto(
    cleaningEventId: string,
    assignmentId: string | null,
    file: Express.Multer.File,
  ) {
    // In production: upload to S3
    // const s3Client = new S3Client({ region: process.env.S3_REGION });
    // const key = `photos/${randomUUID()}-${file.originalname}`;
    // await s3Client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: file.buffer }));
    // const url = `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`;

    // For dev: store as placeholder URL
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

// ─── Controller ───
@ApiTags('Uploads')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private service: UploadsService) {}

  @Post('event/:eventId/photo')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @Param('eventId') eventId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    return this.service.uploadPhoto(eventId, req.body?.assignmentId || null, file);
  }
}

// ─── Module ───
@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
