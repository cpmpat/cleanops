import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { BookingStatus, Prisma } from '@prisma/client';
import { CleanOpsGateway } from '../websocket/websocket.module';

interface ListBookingsDto {
  arrivalFrom?: string;
  arrivalTo?: string;
  status?: BookingStatus;
  propertyId?: string;
  limit?: string | number;
  offset?: string | number;
}

interface UpdateBookingDto {
  checkInTime?: string;
  checkOutTime?: string;
  accommodationName?: string;
  numAdults?: number;
  numChildren?: number;
}

const DETAIL_INCLUDE = {
  property: { select: { id: true, name: true, address: true } },
  cleaning: {
    select: {
      id: true,
      status: true,
      timeSlot: true,
      maxCleaners: true,
      assignments: {
        where: { status: { not: 'REASSIGNED' as const } },
        select: {
          id: true,
          status: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
  ) {}

  async list(tenantId: string, q: ListBookingsDto) {
    const where: Prisma.BookingWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.propertyId) where.propertyId = q.propertyId;
    if (q.arrivalFrom || q.arrivalTo) {
      where.checkInTime = {
        ...(q.arrivalFrom ? { gte: new Date(q.arrivalFrom) } : {}),
        ...(q.arrivalTo ? { lte: new Date(q.arrivalTo) } : {}),
      };
    }

    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: [{ checkInTime: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { rows, total, limit, offset };
  }

  async getById(tenantId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, tenantId },
      include: {
        ...DETAIL_INCLUDE,
        cleaning: {
          include: {
            assignments: { include: { user: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /**
   * Manager edits booking-level fields. Booking changes that touch dates also
   * propagate to the linked Cleaning's denormalized fields.
   */
  async update(tenantId: string, id: string, dto: UpdateBookingDto) {
    const existing = await this.prisma.booking.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Booking not found');

    const data: Prisma.BookingUpdateInput = {};
    if (dto.checkInTime !== undefined) data.checkInTime = new Date(dto.checkInTime);
    if (dto.checkOutTime !== undefined) data.checkOutTime = new Date(dto.checkOutTime);
    if (dto.accommodationName !== undefined) data.accommodationName = dto.accommodationName;
    if (dto.numAdults !== undefined) data.numAdults = dto.numAdults;
    if (dto.numChildren !== undefined) data.numChildren = dto.numChildren;

    const updated = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id },
        data,
        include: DETAIL_INCLUDE,
      });

      // Propagate denormalized fields to the linked Cleaning
      await tx.cleaning.updateMany({
        where: { bookingId: id },
        data: {
          ...(dto.checkInTime !== undefined && { checkInTime: new Date(dto.checkInTime) }),
          ...(dto.checkOutTime !== undefined && { checkOutTime: new Date(dto.checkOutTime) }),
          ...(dto.accommodationName !== undefined && { accommodationName: dto.accommodationName }),
          ...(dto.numAdults !== undefined && { numAdults: dto.numAdults }),
          ...(dto.numChildren !== undefined && { numChildren: dto.numChildren }),
        },
      });

      return booking;
    });

    this.gateway.emitToTenant(tenantId, 'booking:updated', updated);

    // Also fire the cleaning event if linked, so cleaner pages refetch
    if (updated.cleaning?.id) {
      const cln = await this.prisma.cleaning.findUnique({
        where: { id: updated.cleaning.id },
        include: {
          property: { select: { id: true, name: true, address: true } },
          assignments: { include: { user: { select: { id: true, name: true } } } },
        },
      });
      if (cln) this.gateway.notifyEventUpdated(tenantId, cln);
    }

    return updated;
  }

  /**
   * Mark a booking as cancelled (from PMS sync or manager action).
   * The linked Cleaning is NOT auto-cancelled — it just gets a bookingCancelledAt
   * flag, since the cleaning may still need to happen.
   */
  async cancel(tenantId: string, id: string) {
    const existing = await this.prisma.booking.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Booking not found');

    if (existing.status === BookingStatus.CANCELLED) {
      return existing; // idempotent
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: { status: BookingStatus.CANCELLED, cancelledAt: now },
        include: DETAIL_INCLUDE,
      });

      await tx.cleaning.updateMany({
        where: { bookingId: id, bookingCancelledAt: null },
        data: { bookingCancelledAt: now },
      });

      return b;
    });

    this.gateway.emitToTenant(tenantId, 'booking:cancelled', updated);
    return updated;
  }
}
