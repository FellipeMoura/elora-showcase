import type { Server as HttpServer } from 'node:http';
import { parse as parseCookies } from 'cookie';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { verifyToken, type TokenPayload } from '@elora/auth';
import { eq, groups, userGroups, withTenant } from '@elora/db';
import { SOCKET_ROOMS } from '@elora/events-contracts';
import { SESSION_COOKIE } from '../../modules/auth/AuthController.js';
import { env } from '../../env.js';
import { db } from '../database/db.js';
import { corsOptions } from '../http/cors.js';
import { logger } from '../observability/logger.js';
import { hasPermission, type RoleCode } from '../permissions/permissions.js';
import { markSocketActive, markSocketInactive } from './presence.js';

// =====================================================================
// Server Socket.IO embarcado no HTTP do core. Cliente conecta com cookie
// `elora_token` (autorizado pela mesma JWT do HTTP) — auth via middleware
// `io.use(...)`. Em sucesso, socket entra automaticamente em `tenant:${id}`
// (eventos de clínica: contratos, presença, evolução, leads).
//
// Chat: a sala `chat` vem da permission `chat:use`, carregada no
// handshake. O cliente não escolhe sala — não há `subscribe:conversation`
// (o frontend nunca usou), então conhecer o UUID de uma conversa não dá
// acesso aos eventos dela. Mudança de grupo vale na próxima conexão.
// =====================================================================

interface SocketData {
  userId: string;
  tenantId: string;
  roleCodes: RoleCode[];
}

// Presença pro push (shared/realtime/presence.ts): o front avisa quando o
// app está "na frente" (aba visível + foco + interação recente).
interface ClientToServerEvents {
  'presence:active': () => void;
  'presence:inactive': () => void;
}

// Payloads tipados em @elora/events-contracts; aqui só os nomes.
interface ServerToClientEvents {
  'wa.message.received': (payload: unknown) => void;
  'wa.message.sent': (payload: unknown) => void;
  'wa.message.status_changed': (payload: unknown) => void;
  'wa.message.revoked': (payload: unknown) => void;
  'wa.status.updated': (payload: unknown) => void;
  'wa.channel.connection_changed': (payload: unknown) => void;
  'lead.created': (payload: unknown) => void;
  'message.created': (payload: unknown) => void;
  'contract.status_changed': (payload: unknown) => void;
  'procedure_session_attendance.recorded': (payload: unknown) => void;
  'procedure_session.evolved': (payload: unknown) => void;
  'conversation.tags_updated': (payload: unknown) => void;
}

export type ElorIoServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

let ioInstance: ElorIoServer | null = null;

export function initSocketServer(httpServer: HttpServer): ElorIoServer {
  if (ioInstance) return ioInstance;

  const io: ElorIoServer = new SocketIOServer(httpServer, {
    // Mesma allowlist do HTTP (shared/http/cors.ts) — o handshake do socket
    // leva o cookie de sessão, então origem aberta aqui reabriria o buraco.
    cors: corsOptions,
  });

  // Auth middleware — roda em cada handshake (1 vez por conexão).
  io.use(async (socket, next) => {
    let payload: TokenPayload;
    try {
      const token = extractTokenFromHandshake(socket);
      if (!token) return next(new Error('Não autenticado'));
      payload = verifyToken(token, env.jwt.secret);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        '[socket] handshake auth falhou'
      );
      return next(new Error('Token inválido'));
    }

    try {
      socket.data.userId = payload.userId;
      socket.data.tenantId = payload.tenantId;
      socket.data.roleCodes = await loadRoleCodes(payload.tenantId, payload.userId);
      next();
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err, userId: payload.userId },
        '[socket] falha ao carregar roles no handshake'
      );
      next(new Error('Erro interno'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { userId, tenantId, roleCodes } = socket.data as SocketData;
    const rooms = [SOCKET_ROOMS.tenant(tenantId)];
    if (hasPermission(roleCodes, 'chat:use')) rooms.push(SOCKET_ROOMS.chat(tenantId));
    socket.join(rooms);

    logger.debug(
      { socketId: socket.id, userId, tenantId, rooms },
      '[socket] cliente conectado'
    );

    socket.on('presence:active', () => markSocketActive(tenantId, userId, socket.id));
    socket.on('presence:inactive', () => markSocketInactive(tenantId, userId, socket.id));

    socket.on('disconnect', (reason) => {
      markSocketInactive(tenantId, userId, socket.id);
      logger.debug(
        { socketId: socket.id, userId, tenantId, reason },
        '[socket] cliente desconectou'
      );
    });
  });

  ioInstance = io;
  logger.info('[socket] server inicializado');
  return io;
}

export function getIo(): ElorIoServer | null {
  return ioInstance;
}

export async function shutdownSocketServer(): Promise<void> {
  if (!ioInstance) return;
  await ioInstance.close();
  ioInstance = null;
}

// Mesma query do middleware loadUserRoles (user_groups tem RLS por tenant).
async function loadRoleCodes(tenantId: string, userId: string): Promise<RoleCode[]> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ roleCode: groups.roleCode })
      .from(userGroups)
      .innerJoin(groups, eq(userGroups.groupId, groups.id))
      .where(eq(userGroups.userId, userId))
  );
  return Array.from(new Set(rows.map((r) => r.roleCode))) as RoleCode[];
}

function extractTokenFromHandshake(socket: Socket): string | null {
  // 1. Cookie httpOnly — caminho padrão do browser.
  const cookieHeader = socket.handshake.headers.cookie;
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const token = cookies[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 0) return token;
  }

  // 2. handshake.auth.token — caminho pra clientes não-browser (mobile, CI).
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) return authToken;

  // 3. Authorization: Bearer — fallback genérico.
  const authHeader = socket.handshake.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}
