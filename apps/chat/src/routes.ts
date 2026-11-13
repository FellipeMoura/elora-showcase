import { Router, type Router as ExpressRouter } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sql } from '@elora/db';
import { db } from './shared/database/db.js';
import { redis } from './shared/redis/redis.js';
import { env } from './env.js';
import { tenantContextMiddleware } from './shared/middleware/tenantContext.js';
import { ensureAuthenticated } from './shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from './shared/middleware/loadUserRoles.js';
import { requirePermission } from './shared/middleware/requirePermission.js';
import { buildOpenApiDocument } from './shared/openapi/index.js';
import conversationsRoutes from './modules/conversations/conversationsRoutes.js';
import messagesRoutes from './modules/messages/messagesRoutes.js';
import messageTemplatesRoutes from './modules/messageTemplates/messageTemplatesRoutes.js';
import webhooksRoutes from './modules/webhooks/webhooksRoutes.js';
import whatsappChannelsRoutes from './modules/whatsappChannels/whatsappChannelsRoutes.js';
import whatsappContactsRoutes from './modules/whatsappContacts/whatsappContactsRoutes.js';
import whatsappMessagesRoutes from './modules/whatsappMessages/whatsappMessagesRoutes.js';

export const publicRoutes: ExpressRouter = Router();

publicRoutes.get('/health', async (_req, res, next) => {
  try {
    await db.execute(sql`SELECT 1`);
    const redisPing = await redis.ping();
    res.status(StatusCodes.OK).json({
      status: 'ok',
      app: 'chat',
      version: env.appVersion,
      env: env.nodeEnv,
      redis: redisPing === 'PONG' ? 'ok' : 'degraded',
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

// Webhooks WhatsApp: público, sem tenantContext (provider não conhece
// subdomínio). Controller resolve tenant via SECURITY DEFINER function.
publicRoutes.use(webhooksRoutes);

export const tenantRoutes: ExpressRouter = Router();
tenantRoutes.use(tenantContextMiddleware);
// Todo o chat exige chat:use; rotas de gestão pedem chat:manage no router
// do módulo. Os routers ainda chamam ensureAuthenticated (idempotente).
tenantRoutes.use(ensureAuthenticated, loadUserRoles, requirePermission('chat:use'));
tenantRoutes.use(whatsappChannelsRoutes);
tenantRoutes.use(whatsappContactsRoutes);
tenantRoutes.use(whatsappMessagesRoutes);
tenantRoutes.use(messageTemplatesRoutes);
tenantRoutes.use(conversationsRoutes);
tenantRoutes.use(messagesRoutes);
