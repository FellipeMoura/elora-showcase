import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { logger } from '../../shared/observability/logger.js';
import { createWhatsappProvider } from '../../shared/providers/whatsapp/providerFactory.js';
import type { WebhookRequest } from '../../shared/providers/whatsapp/types.js';
import { enqueueInbound } from '../../shared/workers/inboundNormalizer/index.js';
import { WhatsappChannelsService } from '../whatsappChannels/WhatsappChannelsService.js';
import { WebhooksService } from './WebhooksService.js';
import type { WebhookChannelParam } from './WebhooksTypes.js';

// Endpoint público — não passa por tenantContextMiddleware. Resolve tenant
// via SECURITY DEFINER function, valida assinatura via adapter, enfileira
// e responde rápido. Processamento real fica no worker BullMQ
// (shared/workers/inboundNormalizer).
//
// Política de status code:
// - 200 + enfileirado → caminho feliz
// - 200 + drop silencioso → eventos válidos mas irrelevantes (presence, typing)
// - 401 → assinatura inválida (provider deveria revisar config)
// - 410 → channel não existe / desativado (Gone — provider deve parar de
//   tentar; semanticamente correto pra evitar spam de retries no log)

// Dedup de log pra canais desconhecidos. Evolution v2 pode chamar o webhook
// várias vezes por segundo se a instância está ativa — logar TODA chamada
// gera centenas de WARN. Mantemos um Set com canais já avisados e logamos
// só a primeira ocorrência por id. Set vive em memória do processo —
// reinicia ao deploy, comportamento aceito (queremos reavisar pós-restart).
const unknownChannelsLogged = new Set<string>();

export const WebhooksController = {
  whatsapp: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { channelId } = req.params as WebhookChannelParam;

      const tenantId = await WebhooksService.resolveChannelTenant(channelId);
      if (!tenantId) {
        // Canal não existe ou está inativo: 410 Gone — semântica HTTP que
        // sinaliza "recurso desapareceu permanentemente". Provider que
        // honra deveria parar de tentar (Evolution v2 ainda insiste mas o
        // backoff aumenta). Loga só a primeira ocorrência por channelId.
        if (!unknownChannelsLogged.has(channelId)) {
          unknownChannelsLogged.add(channelId);
          logger.warn(
            { channelId },
            '[webhook] canal desconhecido — provavelmente instância Evolution órfã (mesmo aviso só uma vez por id)',
          );
        }
        res.status(StatusCodes.GONE).json({ error: 'Canal não encontrado' });
        return;
      }

      // Carrega channel com tenant context pra criar adapter.
      const channel = await WhatsappChannelsService.findById(tenantId, channelId);
      const provider = createWhatsappProvider(channel);

      // Verificação de assinatura: Mock retorna sempre true; Evolution valida
      // Bearer token configurado em provider_config.webhookToken. rawBody fica
      // disponível pra futuros adapters que precisem HMAC.
      if (!req.rawBody) {
        logger.warn({ channelId, tenantId }, '[webhook] rawBody ausente');
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Payload inválido' });
        return;
      }

      const webhookReq: WebhookRequest = {
        headers: req.headers,
        rawBody: req.rawBody,
        query: req.query as Record<string, string | string[] | undefined>,
      };

      const valid = await provider.verifyWebhook(webhookReq);
      if (!valid) {
        logger.warn({ channelId, tenantId }, '[webhook] assinatura inválida');
        res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Assinatura inválida' });
        return;
      }

      // Short-circuit pra eventos noop (CONNECTION_UPDATE, PRESENCE, etc).
      // Evolution v2 com Baileys pode disparar dezenas por segundo destes —
      // enfileirar/dequeue/worker pra cada um polui o log e desperdiça
      // Redis/CPU. Normalizamos aqui pra peek; se ignored, drop limpo sem
      // job no BullMQ. Worker re-normaliza no fluxo principal — custo
      // desprezível (parse JSON + switch); decoupling vale a pena.
      const normalized = provider.normalizeWebhook(req.body);
      if (normalized.kind === 'ignored') {
        res.status(StatusCodes.OK).json({ status: 'ignored' });
        return;
      }

      // Enfileira raw payload — worker faz parse + pipeline. Responder antes
      // do await libera o provider mais rápido, mas perde garantia de
      // enfileiramento. Mantemos o await: BullMQ.add é rápido (1 LPUSH no
      // Redis) e a garantia vale a pena.
      await enqueueInbound({
        tenantId,
        channelId,
        rawPayload: req.body,
        receivedAt: new Date().toISOString(),
      });

      res.status(StatusCodes.OK).json({ status: 'queued' });
    } catch (err) {
      next(err);
    }
  },
};
