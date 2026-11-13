import { Router, type Router as ExpressRouter } from 'express';
import { StatusCodes } from 'http-status-codes';
import { eq, sql, tenants, units, users, withTenant } from '@elora/db';
import { db } from './shared/database/db.js';
import { env } from './env.js';
import { tenantContextMiddleware } from './shared/middleware/tenantContext.js';
import { ensureAuthenticated } from './shared/middleware/ensureAuthenticated.js';
import { AppError } from './shared/errors/AppError.js';
import appointmentsRoutes from './modules/appointments/appointmentsRoutes.js';
import authRoutes from './modules/auth/authRoutes.js';
import availabilityRoutes from './modules/availability/availabilityRoutes.js';
import cashierRoutes from './modules/cashier/cashierRoutes.js';
import clientFormsRoutes from './modules/clientForms/clientFormsRoutes.js';
import clientsRoutes from './modules/clients/clientsRoutes.js';
import contractsRoutes from './modules/contracts/contractsRoutes.js';
import contractsWebhookRoutes from './modules/contracts/contractsWebhookRoutes.js';
import conversationTagsRoutes from './modules/conversationTags/conversationTagsRoutes.js';
import dashboardRoutes from './modules/dashboard/dashboardRoutes.js';
import equipmentsRoutes from './modules/equipments/equipmentsRoutes.js';
import evaluationsRoutes from './modules/evaluations/evaluationsRoutes.js';
import formTemplatesRoutes from './modules/formTemplates/formTemplatesRoutes.js';
import groupsRoutes from './modules/groups/groupsRoutes.js';
import journeysRoutes from './modules/journeys/journeysRoutes.js';
import leadsRoutes from './modules/leads/leadsRoutes.js';
import meRoutes from './modules/me/meRoutes.js';
import menusRoutes from './modules/menus/menusRoutes.js';
import attendanceRoutes from './modules/procedureSessionAttendances/attendanceRoutes.js';
import publicAttendanceRoutes from './modules/procedureSessionAttendances/publicAttendanceRoutes.js';
import procedureSessionsRoutes from './modules/procedureSessions/procedureSessionsRoutes.js';
import proceduresRoutes from './modules/procedures/proceduresRoutes.js';
import quotesRoutes from './modules/quotes/quotesRoutes.js';
import reportsRoutes from './modules/reports/reportsRoutes.js';
import salesRoutes from './modules/sales/salesRoutes.js';
import tenantsRoutes from './modules/tenants/tenantsRoutes.js';
import treatmentsRoutes from './modules/treatments/treatmentsRoutes.js';
import unitsRoutes from './modules/units/unitsRoutes.js';
import usersRoutes from './modules/users/usersRoutes.js';
import pushSubscriptionsRoutes from './modules/pushSubscriptions/pushSubscriptionsRoutes.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  buildOpenApiDocument,
  openApiRegistry,
} from './shared/openapi/index.js';
import { z } from './shared/openapi/registry.js';

export const publicRoutes: ExpressRouter = Router();

publicRoutes.get('/health', async (_req, res, next) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.status(StatusCodes.OK).json({
      status: 'ok',
      app: 'core',
      version: env.appVersion,
      env: env.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// Spec OpenAPI 3.1 montada dinamicamente a partir do registry (que cada
// *Routes.ts popula). Postman importa daqui via "Link" e marca auto-update.
publicRoutes.get('/openapi.json', (_req, res) => {
  res.status(StatusCodes.OK).json(buildOpenApiDocument());
});

// Webhooks de providers externos — públicos por construção (provider não
// conhece subdomínio nem JWT). Cada webhook resolve tenant internamente:
// ZapSign via `resolve_contract_tenant`, WhatsApp via `resolve_channel_tenant`.
publicRoutes.use(contractsWebhookRoutes);

// Rotas públicas de presença assinada — cliente abre via signUrl no browser,
// sem login. Tenant é resolvido internamente pelo token (single-use, TTL 48h,
// 3 tentativas de verify antes de invalidar).
publicRoutes.use(publicAttendanceRoutes);

export const tenantRoutes: ExpressRouter = Router();
tenantRoutes.use(tenantContextMiddleware);
tenantRoutes.use(authRoutes);
tenantRoutes.use(meRoutes);
tenantRoutes.use(usersRoutes);
tenantRoutes.use(groupsRoutes);
tenantRoutes.use(menusRoutes);
tenantRoutes.use(tenantsRoutes);
tenantRoutes.use(clientsRoutes);
tenantRoutes.use(proceduresRoutes);
tenantRoutes.use(journeysRoutes);
tenantRoutes.use(leadsRoutes);
tenantRoutes.use(formTemplatesRoutes);
tenantRoutes.use(clientFormsRoutes);
tenantRoutes.use(evaluationsRoutes);
tenantRoutes.use(quotesRoutes);
tenantRoutes.use(salesRoutes);
tenantRoutes.use(cashierRoutes);
tenantRoutes.use(appointmentsRoutes);
tenantRoutes.use(attendanceRoutes);
tenantRoutes.use(procedureSessionsRoutes);
tenantRoutes.use(treatmentsRoutes);
tenantRoutes.use(availabilityRoutes);
tenantRoutes.use(unitsRoutes);
tenantRoutes.use(equipmentsRoutes);
tenantRoutes.use(contractsRoutes);
tenantRoutes.use(conversationTagsRoutes);
tenantRoutes.use(dashboardRoutes);
tenantRoutes.use(reportsRoutes);
tenantRoutes.use(pushSubscriptionsRoutes);

// Rota de teste pra validar isolamento de tenant.
// Lista as units visíveis ao tenant atual (RLS filtra automaticamente).
const tenantInfoResponseSchema = z
  .object({
    tenant: z
      .object({
        id: z.string().uuid(),
        slug: z.string(),
        name: z.string(),
      })
      .nullable(),
    units: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
      })
    ),
    usersCount: z.number().int().nonnegative(),
  })
  .openapi('TenantInfo');

openApiRegistry.registerPath({
  method: 'get',
  path: '/tenant/info',
  tags: ['Tenant'],
  summary: 'Resumo do tenant atual + units + count de usuários',
  description:
    'Endpoint de validação de isolamento — RLS garante que só vê dados do tenant ' +
    'resolvido pelo subdomínio + JWT.',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Resumo do tenant',
      content: { 'application/json': { schema: tenantInfoResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    500: ERROR_RESPONSES[500],
  },
});

tenantRoutes.get('/tenant/info', ensureAuthenticated, async (req, res, next) => {
  try {
    if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);

    const result = await withTenant(db, req.tenantId, async (tx) => {
      const [tenant] = await tx
        .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, req.tenantId!))
        .limit(1);

      const allUnits = await tx
        .select({ id: units.id, name: units.name })
        .from(units);

      const [usersCountRow] = await tx
        .select({ count: sql<number>`count(*)::int`.as('count') })
        .from(users);

      return {
        tenant: tenant ?? null,
        units: allUnits,
        usersCount: usersCountRow?.count ?? 0,
      };
    });

    res.status(StatusCodes.OK).json(result);
  } catch (err) {
    next(err);
  }
});
