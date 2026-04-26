import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();

    // Multi-tenant middleware: automatically filter by tenantId
    this.$use(async (params, next) => {
      // Skip for models that don't have tenantId
      const modelsWithTenant = [
        'User', 'Property', 'CleaningEvent', 'ManagerTag',
        'Notification', 'CleaningEventTag',
      ];

      if (modelsWithTenant.includes(params.model || '')) {
        // For read operations, inject tenantId filter if present in context
        if (params.args?.where?.tenantId === undefined && params.args?._tenantId) {
          const tenantId = params.args._tenantId;
          delete params.args._tenantId;

          if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate'].includes(params.action)) {
            params.args.where = { ...params.args.where, tenantId };
          }
          if (['create', 'createMany'].includes(params.action)) {
            if (params.args.data) {
              if (Array.isArray(params.args.data)) {
                params.args.data = params.args.data.map((d: any) => ({ ...d, tenantId }));
              } else {
                params.args.data.tenantId = tenantId;
              }
            }
          }
          if (['update', 'updateMany', 'delete', 'deleteMany'].includes(params.action)) {
            params.args.where = { ...params.args.where, tenantId };
          }
        }
      }

      return next(params);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
