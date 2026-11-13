import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { logger } from '../../shared/observability/logger.js';
import { getSignatureProvider } from '../../shared/providers/signature/index.js';
import { ContractsQuery } from './ContractsQuery.js';
import { ContractsService } from './ContractsService.js';

// =====================================================================
// Webhook do provider de assinatura (ZapSign por enquanto).
//
// Endpoint público — ZapSign bate num endpoint fixo configurado no painel
// deles (api.elora.app.br/webhooks/zapsign). Não há subdomínio de tenant
// nem channelId; identificamos o contrato via `token` (= zapsign document id)
// que vem no payload, e resolvemos o tenant via SECURITY DEFINER function
// (mesmo padrão do webhook do WhatsApp em apps/chat).
//
// Política de status code:
// - 200 + processado → caminho feliz
// - 200 + drop silencioso → eventos válidos mas irrelevantes (unknown,
//   contrato órfão) — provider não precisa retentar
// - 401 → assinatura/token inválida (provider deveria revisar config)
// - 200 com `status:'ignored'` quando contrato não existe — evita que
//   provider fique batendo num webhook que nunca vai virar válido
// =====================================================================

export const ContractsWebhookController = {
  zapsign: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provider = getSignatureProvider();

      // 1. Verifica autenticidade do webhook (header secret cadastrado no
      // painel ZapSign como X-Elora-Webhook-Token). Sem token configurado
      // = modo dev: aceita qualquer payload (adapter retorna true).
      const valid = provider.verifyWebhook({ headers: req.headers, body: req.body });
      if (!valid) {
        logger.warn(
          { headers: redactSecrets(req.headers) },
          'contracts.webhook.invalid_signature',
        );
        res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Assinatura inválida' });
        return;
      }

      // 2. Normaliza pro shape canônico. Eventos não mapeados viram
      // `kind:'unknown'` — caller (service) loga e dropa.
      const event = provider.normalizeWebhook(req.body);

      if (!event.externalDocumentId) {
        // Eventos sem token (raros, geralmente teste de conexão do painel
        // ZapSign) — acknowledge e segue.
        res.status(StatusCodes.OK).json({ status: 'ignored', reason: 'no_document_id' });
        return;
      }

      // 3. Resolve tenant via SECURITY DEFINER (bypassa RLS só pra essa
      // lookup específica). Tenant null = contrato órfão (apagado,
      // documento que não conhecemos, instância de teste do painel) —
      // acknowledge sem processar pra parar retries.
      const tenantId = await ContractsQuery.resolveTenantByZapsignDocumentId(
        event.externalDocumentId,
      );
      if (!tenantId) {
        logger.info(
          { externalDocumentId: event.externalDocumentId, eventKind: event.kind },
          'contracts.webhook.unknown_document_acknowledged',
        );
        res.status(StatusCodes.OK).json({ status: 'ignored', reason: 'unknown_document' });
        return;
      }

      // 4. Processa o evento. Service é idempotente (estados terminais não
      // regridem; viewed em contrato signed é skip silencioso).
      await ContractsService.handleSignatureEvent(tenantId, event);

      res.status(StatusCodes.OK).json({ status: 'processed' });
    } catch (err) {
      next(err);
    }
  },
};

// Redacta valores que podem conter secrets antes de logar headers (defesa em
// profundidade: se algum dia adicionarmos HMAC, a assinatura passa em header).
function redactSecrets(headers: Request['headers']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/token|signature|auth/i.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = value;
    }
  }
  return out;
}
