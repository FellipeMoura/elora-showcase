# Elora

SaaS multi-tenant de gestão para **clínicas de estética e depilação a laser**: agenda com equipamentos como recurso, pacotes de sessões, avaliações e anamnese, vendas e orçamentos, contratos com assinatura digital, caixa, funil de leads, dashboard e **WhatsApp nativo com agente de IA**.

Está em produção. É a primeira das três bases da família e definiu a arquitetura que [Quartzo](https://github.com/FellipeMoura/quartzo-showcase) e [Frostie](https://github.com/FellipeMoura/frostie-showcase) herdaram.

> **Sobre este repositório.** É uma vitrine. O código vem de um repositório privado, que tem o histórico completo, e documentos operacionais e de infraestrutura de produção foram removidos.

## Destaques técnicos

- **Modular monolith**: `core` (gestão clínica), `chat` (WhatsApp) e `agent` (IA) são apps separados que se comunicam por contratos tipados (`packages/*-contracts`) e eventos. Deploy e falha de um não derrubam os outros ([docs/arquitetura.md](./docs/arquitetura.md)).
- **Multi-tenancy pool model + Postgres RLS** com `FORCE ROW LEVEL SECURITY`. O tenant é resolvido pelo subdomínio e fixado na transação.
- **Camada WhatsApp com adapter pattern** sobre a Evolution API:
  - normalizador de webhooks e modelo de domínio próprio;
  - envio assíncrono com persistência antecipada e worker;
  - edição e revogação de mensagens;
  - pipeline de mídia no MinIO.
- **Agente de IA** (`apps/agent`) sobre o SDK da Anthropic, operando nas conversas com ferramentas do domínio (dados do cliente, procedimentos, horários, etiquetas e transferência para humano) ([docs/ai-agent-implementation.md](./docs/ai-agent-implementation.md)).
- **Contratos digitais**: templates com variáveis resolvidas a partir do cadastro e assinatura via ZapSign ([docs/contracts-domain.md](./docs/contracts-domain.md)).
- **Agenda** com equipamento como recurso do agendamento (o laser é o gargalo real), disponibilidade configurável e pacotes de sessões com saldo por procedimento.
- **Realtime** por Socket.io e **push notifications** (Web Push).

## Stack

| Camada | Tecnologias |
|---|---|
| Backend | Node.js, TypeScript, Express (módulos por domínio), Zod, Drizzle ORM, PostgreSQL + RLS |
| Filas e realtime | Redis, BullMQ, Socket.io |
| Frontend | React, Vite, TanStack Query, React Hook Form, shadcn/ui + Tailwind, Nivo, dnd-kit |
| Integrações | Evolution API (WhatsApp), Anthropic API, ZapSign, MinIO, Web Push |
| Infra | Docker Compose, Nginx, PM2, Sentry, pnpm workspaces |

## Estrutura

```
apps/
  core/       API: 26 módulos (appointments, availability, procedures, sessions, contracts, sales...)
  chat/       WhatsApp: gateway Evolution, workers, mídia
  agent/      agente de IA
  frontend/   SPA React
packages/
  db/         schema Drizzle, 44 migrations, withTenant (RLS)
  auth/ · agent-contracts/ · events-contracts/ · shared-utils/
infra/        docker-compose (Postgres, Redis, MinIO, Evolution), nginx
docs/         decisões de arquitetura e documentos de domínio
```

## Rodando localmente

Pré-requisitos: Node.js 20+, pnpm 9+, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up                        # Postgres, Redis, MinIO
pnpm db:migrate && pnpm db:seed
pnpm --filter @elora/core dev
pnpm --filter @elora/frontend dev
```

## Documentação

- [docs/visao-geral.md](./docs/visao-geral.md): nicho, origem e diferenciais
- [docs/arquitetura.md](./docs/arquitetura.md): topologia, tenancy, camada WhatsApp, testes, observabilidade
- [docs/chat-domain.md](./docs/chat-domain.md): domínio de conversas
- [docs/realtime-socket-events.md](./docs/realtime-socket-events.md): contrato de eventos realtime

Faz parte de uma família de três SaaS com a mesma arquitetura: Elora, [Quartzo](https://github.com/FellipeMoura/quartzo-showcase) e [Frostie](https://github.com/FellipeMoura/frostie-showcase).
