import { withTenant } from '@elora/db';
import { env } from '../../env.js';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/observability/logger.js';
import { createWhatsappProvider } from '../../shared/providers/whatsapp/providerFactory.js';
import { MediaStorage } from '../../shared/storage/index.js';
import {
  type PaginatedResult,
  totalPagesOf,
} from '../../shared/types/pagination.js';
import { WhatsappChannelsQuery } from '../whatsappChannels/WhatsappChannelsQuery.js';
import { WhatsappChannelsService } from '../whatsappChannels/WhatsappChannelsService.js';
import { WhatsappContactsQuery } from './WhatsappContactsQuery.js';
import type {
  FindContactsQuery,
  UpdateContactInput,
  WhatsappContact,
} from './WhatsappContactsTypes.js';

function triStateToBool(value: 'yes' | 'no' | 'all'): boolean | undefined {
  if (value === 'all') return undefined;
  return value === 'yes';
}

export const WhatsappContactsService = {
  find: async (
    tenantId: string,
    query: FindContactsQuery
  ): Promise<PaginatedResult<WhatsappContact>> => {
    return withTenant(db, tenantId, async (tx) => {
      const { items, total } = await WhatsappContactsQuery.findPaginated(
        tx,
        {
          q: query.q,
          channelId: query.channelId,
          optedIn: triStateToBool(query.optedIn),
          hasClient: triStateToBool(query.hasClient),
        },
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

  findById: async (tenantId: string, id: string): Promise<WhatsappContact> => {
    return withTenant(db, tenantId, async (tx) => {
      const contact = await WhatsappContactsQuery.findById(tx, id);
      if (!contact) throw new AppError('Contato não encontrado', 404);
      return contact;
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateContactInput
  ): Promise<WhatsappContact> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await WhatsappContactsQuery.findById(tx, id);
      if (!current) throw new AppError('Contato não encontrado', 404);
      const updated = await WhatsappContactsQuery.update(tx, id, input);
      if (!updated) throw new AppError('Contato não encontrado', 404);
      return updated;
    });
  },

  // Idempotente: usado pelo webhook normalizer (passo 7) quando inbound chega.
  // Cria contato ou atualiza profile_name se mudou. Race condition no insert
  // é coberto pelo unique (channel, phone) + ON CONFLICT DO NOTHING.
  findOrCreateByPhone: async (
    tenantId: string,
    channelId: string,
    phoneE164: string,
    profileName?: string
  ): Promise<WhatsappContact> => {
    return withTenant(db, tenantId, async (tx) => {
      const existing = await WhatsappContactsQuery.findByChannelAndPhone(
        tx,
        channelId,
        phoneE164
      );
      if (existing) {
        // Atualiza profile_name se mudou (provedor às vezes manda nome novo).
        if (profileName && profileName !== existing.profileName) {
          const updated = await WhatsappContactsQuery.update(tx, existing.id, {
            profileName,
          });
          return updated ?? existing;
        }
        return existing;
      }

      // ON CONFLICT em vez de catch de 23505: depois de um erro o Postgres
      // aborta a transação e o re-fetch falharia (inbounds simultâneos do
      // mesmo número). Quem perde a corrida lê a linha do vencedor.
      const created = await WhatsappContactsQuery.createIfAbsent(tx, tenantId, {
        whatsappChannelId: channelId,
        phoneE164,
        profileName,
      });
      if (created) return created;
      const reread = await WhatsappContactsQuery.findByChannelAndPhone(
        tx,
        channelId,
        phoneE164
      );
      if (!reread) throw new Error('Falha ao criar contato WhatsApp');
      return reread;
    });
  },

  // Registra opt-in. Idempotente — chamadas repetidas sobrescrevem timestamp.
  // Útil pra integração com formulário externo, fluxo manual de recepção, etc.
  recordOptIn: async (
    tenantId: string,
    id: string,
    source: string
  ): Promise<WhatsappContact> => {
    return WhatsappContactsService.update(tenantId, id, {
      optedInAt: new Date(),
      optInSource: source,
    });
  },

  // Opt-in implícito disparado pelo normalizer quando um inbound chega:
  // cliente que iniciou conversa = consentimento. Idempotente E conservador
  // — só grava se ainda não havia opt-in. Preserva o `optedInAt` original
  // como auditoria de "quando o consentimento começou", em vez de mover a
  // data a cada mensagem nova.
  //
  // Diferente de `recordOptIn` (sobrescreve sempre, caminho MANUAL/admin);
  // este é o caminho AUTOMÁTICO do inbound. Usa `at` do evento — não
  // `new Date()` — pra manter coerência temporal com a mensagem que
  // disparou o opt-in.
  //
  // Side-effect: dispara refreshProfilePicture em background (fire-and-forget)
  // na primeira vez que vemos o contato (optedInAt era null). Best-effort —
  // erro de rede/foto não bloqueia o pipeline. Inbound subsequentes não
  // refazem o fetch automaticamente (pra não bater no provider sem motivo;
  // admin tem endpoint manual de refresh).
  ensureInboundOptIn: async (
    tenantId: string,
    id: string,
    at: Date
  ): Promise<WhatsappContact> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await WhatsappContactsQuery.findById(tx, id);
      if (!current) throw new AppError('Contato não encontrado', 404);
      if (current.optedInAt) return current;
      const updated = await WhatsappContactsQuery.update(tx, id, {
        optedInAt: at,
        optInSource: 'inbound_initiated',
      });

      // Fire-and-forget: catch silencioso porque refresh é best-effort.
      // Se o canal estiver offline ou Evolution timeout, opt-in não falha.
      void WhatsappContactsService.refreshProfilePicture(tenantId, id).catch(
        (err) => {
          logger.debug(
            { tenantId, contactId: id, err: err instanceof Error ? err.message : err },
            '[refreshProfilePicture] erro no first-inbound — drop',
          );
        },
      );

      return updated ?? current;
    });
  },

  // Refresh manual ou automático (no first inbound) da foto de perfil do
  // contato. Baixa do WhatsApp via adapter, re-uploada pro MinIO em path
  // estável, atualiza coluna `profile_picture_url` com o objectKey. Se o
  // provider devolver null (contato sem foto / privacidade restrita),
  // limpa o campo no DB — sinaliza pra UI mostrar avatar default.
  refreshProfilePicture: async (
    tenantId: string,
    contactId: string,
  ): Promise<WhatsappContact> => {
    const contact = await WhatsappContactsService.findById(tenantId, contactId);
    const channel = await WhatsappChannelsService.findById(
      tenantId,
      contact.whatsappChannelId,
    );
    const provider = createWhatsappProvider(channel);
    // Foto de perfil é por conta WhatsApp — preferir o número resolvido
    // (whatsappE164) quando disponível, fallback pra phoneE164.
    const sourceUrl = await provider.getProfilePicture(
      contact.whatsappE164 ?? contact.phoneE164,
    );

    if (!sourceUrl) {
      // Provider disse que não tem foto — limpa o campo (estado consistente).
      return withTenant(db, tenantId, async (tx) => {
        const updated = await WhatsappContactsQuery.update(tx, contactId, {
          profilePictureUrl: null,
        });
        return updated ?? contact;
      });
    }

    const result = await MediaStorage.persistProfilePicture({
      tenantId,
      channelId: contact.whatsappChannelId,
      contactId: contact.id,
      sourceUrl,
    });

    return withTenant(db, tenantId, async (tx) => {
      const updated = await WhatsappContactsQuery.update(tx, contactId, {
        profilePictureUrl: result.objectKey,
      });
      if (!updated) throw new AppError('Contato não encontrado após update', 500);
      return updated;
    });
  },

  // Verifica se número tem WhatsApp ativo. Usa um canal "default" do tenant
  // (primeiro active, preferindo `connection_state='open'`). Quando o
  // tenant ainda não tem canal cadastrado, retorna `onWhatsApp=false` com
  // `reason='no_channel'` — UX no cadastro vira warning (cliente é criado
  // sem contact) em vez de bloquear.
  //
  // Erros do provider (timeout, instância derrubada) também caem em
  // `onWhatsApp=false` com `reason='provider_error'` — best-effort. Logamos
  // pra debug.
  checkNumber: async (
    tenantId: string,
    phoneE164: string,
  ): Promise<{
    onWhatsApp: boolean;
    whatsappE164: string | null;
    checkedAt: string;
    reason?: 'no_channel' | 'provider_error';
  }> => {
    const channel = await withTenant(db, tenantId, async (tx) => {
      return WhatsappChannelsQuery.findDefaultActive(tx);
    });
    const checkedAt = new Date().toISOString();
    if (!channel) {
      return { onWhatsApp: false, whatsappE164: null, checkedAt, reason: 'no_channel' };
    }
    try {
      const provider = createWhatsappProvider(channel);
      const resolved = await provider.resolveNumber(phoneE164);
      return {
        onWhatsApp: resolved.exists,
        whatsappE164: resolved.matchedE164,
        checkedAt,
      };
    } catch (err) {
      logger.warn(
        {
          tenantId,
          channelId: channel.id,
          phoneE164,
          err: err instanceof Error ? err.message : err,
        },
        '[checkNumber] provider falhou — assumindo onWhatsApp=false',
      );
      return {
        onWhatsApp: false,
        whatsappE164: null,
        checkedAt,
        reason: 'provider_error',
      };
    }
  },

  // Presigned URL pro frontend renderizar o avatar. Lazy: gera só quando UI
  // pedir, não inclui na listagem (presigned tem TTL curto).
  getProfilePictureUrl: async (
    tenantId: string,
    contactId: string,
  ): Promise<{ url: string | null; expiresInSec: number }> => {
    const contact = await WhatsappContactsService.findById(tenantId, contactId);
    if (!contact.profilePictureUrl) {
      return { url: null, expiresInSec: env.minio.presignedUrlTtlSec };
    }
    const url = await MediaStorage.getSignedDownloadUrl(contact.profilePictureUrl);
    return { url, expiresInSec: env.minio.presignedUrlTtlSec };
  },
};
