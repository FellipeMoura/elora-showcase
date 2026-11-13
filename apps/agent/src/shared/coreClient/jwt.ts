import { signToken, type TokenPayload } from '@elora/auth';
import { env } from '../../env.js';

// =====================================================================
// JWT do system agent.
//
// Cada chamada HTTP do agente pra core/chat assina um token efêmero
// (default 60s). Janela curta limita o blast radius caso vaze do log de
// rede, e mantém o pattern simétrico ao de service-to-service auth.
//
// Por que JWT efêmero e não um secret estático compartilhado (X-Internal-
// Auth como chat usa hoje):
//   - core já valida JWT em todas as rotas via ensureAuthenticated. Reusar
//     simplifica — não precisa de path especial pra agent.
//   - `req.userId` fica preenchido com o system agent user → permissions
//     fluem naturalmente (`requirePermission('appointments:write')` checa
//     contra roleCode='agent').
//   - Audit trail nos logs do core mostra o userId real do agente, e a
//     row de `appointments.created_by` (ou equivalente) também.
// =====================================================================

export interface AgentJwtSubject {
  tenantId: string;
  userId: string;
  username: string;
}

export function signAgentJwt(subject: AgentJwtSubject): string {
  const payload: TokenPayload = {
    userId: subject.userId,
    tenantId: subject.tenantId,
    username: subject.username,
  };
  // signToken aceita string compatível com `ms`. Encapsulamos em string
  // (`Ns`) pra deixar a config em segundos (env.jwt.expiresInSec).
  return signToken(payload, env.jwt.secret, `${env.jwt.expiresInSec}s`);
}
