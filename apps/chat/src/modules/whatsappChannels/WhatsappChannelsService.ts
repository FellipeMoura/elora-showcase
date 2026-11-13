import { randomBytes } from 'node:crypto';
import { withTenant } from '@elora/db';
import { env } from '../../env.js';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/observability/logger.js';
import {
  type ConnectionStateResult,
  evolutionAdmin,
  type QrCodeResult,
} from '../../shared/providers/whatsapp/index.js';
import {
  type PaginatedResult,
  totalPagesOf,
} from '../../shared/types/pagination.js';
import { WhatsappChannelsQuery } from './WhatsappChannelsQuery.js';
import type {
  CreateChannelInput,
  FindChannelsQuery,
  PurgeChannelConversationsResult,
  UpdateChannelInput,
  WhatsappChannel,
} from './WhatsappChannelsTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const WhatsappChannelsService = {
  find: async (
    tenantId: string,
    query: FindChannelsQuery
  ): Promise<PaginatedResult<WhatsappChannel>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const { items, total } = await WhatsappChannelsQuery.findPaginated(
        tx,
        { q: query.q, providerType: query.providerType, active },
        { page: query.page, pageSize: query.pageSize }
      );
      return {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalPagesOf(total, query.pageSize),
      };
    });
  },

  findById: async (tenantId: string, id: string): Promise<WhatsappChannel> => {
    return withTenant(db, tenantId, async (tx) => {
      const channel = await WhatsappChannelsQuery.findById(tx, id);
      if (!channel) throw new AppError('Canal não encontrado', 404);
      return channel;
    });
  },

  create: async (
    tenantId: string,
    input: CreateChannelInput
  ): Promise<WhatsappChannel> => {
    return withTenant(db, tenantId, async (tx) => {
      const existing = await WhatsappChannelsQuery.findByNameInTenant(tx, input.name);
      if (existing) throw new AppError('Já existe um canal com este nome', 409);
      return WhatsappChannelsQuery.create(tx, tenantId, input);
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateChannelInput
  ): Promise<WhatsappChannel> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await WhatsappChannelsQuery.findById(tx, id);
      if (!current) throw new AppError('Canal não encontrado', 404);

      if (input.name && input.name !== current.name) {
        const existing = await WhatsappChannelsQuery.findByNameInTenant(tx, input.name, id);
        if (existing) throw new AppError('Já existe um canal com este nome', 409);
      }

      const updated = await WhatsappChannelsQuery.update(tx, id, input);
      if (!updated) throw new AppError('Canal não encontrado', 404);
      return updated;
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return WhatsappChannelsQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Canal não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // FK violations (whatsapp_contacts/conversations/templates apontam pro canal).
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Canal possui contatos ou conversas vinculados e não pode ser removido. Desative em vez de excluir.',
          409
        );
      }
      throw err;
    }
  },

  // Hard delete de conversas, mensagens e contatos do canal (o canal fica).
  // Tudo numa transação — falhou no meio, nada some.
  purgeConversations: async (
    tenantId: string,
    id: string
  ): Promise<PurgeChannelConversationsResult> => {
    const result = await withTenant(db, tenantId, async (tx) => {
      const channel = await WhatsappChannelsQuery.findById(tx, id);
      if (!channel) throw new AppError('Canal não encontrado', 404);
      return WhatsappChannelsQuery.purgeConversations(tx, id);
    });
    logger.warn(
      { tenantId, channelId: id, ...result },
      '[WhatsappChannels] conversas e contatos do canal excluídos (hard delete)',
    );
    return result;
  },

  deactivate: async (tenantId: string, id: string): Promise<WhatsappChannel> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await WhatsappChannelsQuery.findById(tx, id);
      if (!current) throw new AppError('Canal não encontrado', 404);
      if (!current.active) throw new AppError('Canal já está desativado', 409);
      const updated = await WhatsappChannelsQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Canal não encontrado', 404);
      return updated;
    });
  },

  activate: async (tenantId: string, id: string): Promise<WhatsappChannel> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await WhatsappChannelsQuery.findById(tx, id);
      if (!current) throw new AppError('Canal não encontrado', 404);
      if (current.active) throw new AppError('Canal já está ativo', 409);
      const updated = await WhatsappChannelsQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Canal não encontrado', 404);
      return updated;
    });
  },

  // ===================================================================
  // Operações Evolution (provisionamento + estado da conexão)
  // ===================================================================

  // Provisiona instância no Evolution e grava credenciais no canal.
  // Idempotente: se `provider_config` já tem instanceName/apiKey, retorna o
  // canal como está. Pra re-pareamento (caso de logout no WhatsApp), o admin
  // deleta a instância no Evolution e provisiona de novo.
  //
  // Canais mock (`provider_config.mock === true`) não passam por aqui — não
  // têm representação no Evolution.
  provision: async (
    tenantId: string,
    id: string,
  ): Promise<WhatsappChannel> => {
    const channel = await WhatsappChannelsService.findById(tenantId, id);
    const config = (channel.providerConfig ?? {}) as Record<string, unknown>;

    if (config.mock === true) {
      throw new AppError(
        'Canal Mock não pode ser provisionado no Evolution',
        409,
      );
    }
    if (config.instanceName && config.apiKey && config.webhookToken) {
      logger.info(
        { channelId: id, instanceName: config.instanceName },
        '[WhatsappChannels] provision idempotente — credenciais já existem',
      );
      return channel;
    }

    // Nome da instância: prefixo `tenant-<id8>-<channel-id8>` pra evitar
    // colisões cross-tenant E identificar visualmente no manager Evolution.
    const instanceName =
      typeof config.instanceName === 'string' && config.instanceName.length > 0
        ? config.instanceName
        : `elora-${tenantId.slice(0, 8)}-${id.slice(0, 8)}`;

    const webhookToken = randomBytes(24).toString('hex');
    const webhookUrl = evolutionAdmin.buildWebhookUrl(id);

    const result = await evolutionAdmin.createInstance({
      instanceName,
      integration: channel.providerType,
      webhookUrl,
      webhookToken,
    });

    // Grava as credenciais no `provider_config`. Mantém qualquer chave
    // pré-existente (config.mock=false, override de baseUrl etc).
    const newConfig: Record<string, unknown> = {
      ...config,
      baseUrl: (config.baseUrl as string | undefined) ?? env.evolution.baseUrl,
      instanceName: result.instanceName,
      apiKey: result.instanceApiKey,
      integration: channel.providerType,
      webhookToken,
    };

    // Rollback se a gravação falhar — instância já existe no Evolution e
    // a webhook URL já aponta pra cá. Sem rollback, ficaria órfã (instância
    // viva no gateway sem credenciais no banco → loop de 500 no webhook).
    let updated: WhatsappChannel | undefined;
    try {
      updated = await withTenant(db, tenantId, async (tx) => {
        return WhatsappChannelsQuery.update(tx, id, {
          providerConfig: newConfig,
        });
      });
    } catch (err) {
      logger.error(
        { channelId: id, instanceName: result.instanceName, err: err instanceof Error ? err.message : err },
        '[WhatsappChannels] gravação pós-create falhou — rollback Evolution',
      );
      await evolutionAdmin.deleteInstance(result.instanceName).catch((cleanupErr) => {
        logger.error(
          { instanceName: result.instanceName, err: cleanupErr instanceof Error ? cleanupErr.message : cleanupErr },
          '[WhatsappChannels] rollback Evolution falhou — instância órfã!',
        );
      });
      throw err;
    }
    if (!updated) {
      // Race rara: canal foi deletado no meio. Rollback Evolution também.
      await evolutionAdmin.deleteInstance(result.instanceName).catch(() => {});
      throw new AppError('Canal não encontrado', 404);
    }
    return updated;
  },

  // Retorna QR base64 da instância pareando. Falha 409 se canal mock ou
  // ainda não provisionado.
  getQrCode: async (
    tenantId: string,
    id: string,
  ): Promise<QrCodeResult> => {
    const channel = await WhatsappChannelsService.findById(tenantId, id);
    const config = (channel.providerConfig ?? {}) as Record<string, unknown>;
    if (config.mock === true) {
      throw new AppError('Canal Mock não tem QR code', 409);
    }
    const instanceName = config.instanceName;
    if (typeof instanceName !== 'string' || instanceName.length === 0) {
      throw new AppError(
        'Canal ainda não provisionado — chame POST /provision primeiro',
        409,
      );
    }
    return evolutionAdmin.getQrCode(instanceName);
  },

  // Persiste o estado do socket reportado por CONNECTION_UPDATE. Retorna o
  // canal atualizado SE mudou de fato, ou `null` se já estava nesse estado
  // (caller skipa publish do evento — evita spam pra UI).
  setConnectionState: async (
    tenantId: string,
    id: string,
    state: string,
    stateAt: Date,
  ): Promise<WhatsappChannel | null> => {
    return withTenant(db, tenantId, async (tx) => {
      const updated = await WhatsappChannelsQuery.setConnectionState(
        tx,
        id,
        state,
        stateAt,
      );
      return updated ?? null;
    });
  },

  getConnectionState: async (
    tenantId: string,
    id: string,
  ): Promise<ConnectionStateResult> => {
    const channel = await WhatsappChannelsService.findById(tenantId, id);
    const config = (channel.providerConfig ?? {}) as Record<string, unknown>;
    if (config.mock === true) {
      // Mock simula "sempre conectado" pro UI não precisar tratar caso especial.
      return { state: 'open', raw: { mock: true } };
    }
    const instanceName = config.instanceName;
    if (typeof instanceName !== 'string' || instanceName.length === 0) {
      return { state: 'closed', raw: { reason: 'not_provisioned' } };
    }
    return evolutionAdmin.getConnectionState(instanceName);
  },
};

