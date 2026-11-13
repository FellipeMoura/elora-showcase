# Visão Geral

## O que é o Elora

SaaS de gestão para clínicas de estética, depilação a laser e procedimentos estéticos em geral, com integração nativa ao WhatsApp como diferencial central.

## Origem

O Elora é a evolução conceitual de um **sistema anterior** — um monolito personalizado para uma única rede de franquias. O sistema anterior valida o domínio (gestão clínica, agenda, vendas, contratos, anamnese, antes/depois) e serve de referência de padrão de código, mas tem três limitações que o Elora corrige desde o desenho:

1. **Não é multi-tenant de verdade** — multi-unidade dentro de um único cliente.
2. **Performance comprometida** em alguns pontos (bundle pesado, queries não otimizadas).
3. **Chat acoplado ao core** — o módulo de chat (Chatwoot) vive dentro do mesmo backend.

## Nicho

Clínicas que vendem **pacotes de sessões** (não consultas avulsas) — depilação a laser é o exemplo prototípico. Características que diferenciam esse nicho de gestão clínica genérica:

- Saldo de sessões por área corporal
- Mapa corporal (áreas tratadas, evolução)
- Equipamento como recurso de agendamento (laser X, laser Y) — gargalo real de operação
- Anamnese específica de laser (fototipo, medicações, exposição solar)
- Ciclo de relacionamento longo (cliente fica em base ativa por 12+ meses)
- Alta dependência de WhatsApp para confirmação, lembretes, pós-procedimento e reativação

## Diferenciais frente ao sistema anterior

| Aspecto | Sistema anterior | Elora |
|---|---|---|
| Modelo | Monolito personalizado, 1 cliente | SaaS multi-tenant |
| Tenancy | Multi-unidade (campo `empresa`) | Pool model + Postgres RLS |
| Banco | MySQL | Postgres |
| Chat | Acoplado ao backend principal | Aplicação separada (modular monolith) |
| WhatsApp | Via Chatwoot (web), sem automações nativas | Nativo, com automações disparadas por eventos do core |
| Filas/jobs | `node-cron` solto | Redis + BullMQ |
| Frontend | React + MUI + Vite (SPA) | React + MUI + Vite (SPA) — mantido |

## Stack escolhida (resumo)

- **Backend**: Node.js + TypeScript + Express + Knex + Postgres
- **Filas/Cache/Pub-Sub**: Redis + BullMQ
- **Realtime**: Socket.io
- **Frontend**: React 18 + Vite + TypeScript + MUI + Redux Toolkit + RHF/Yup + socket.io-client
- **Storage**: MinIO
- **WhatsApp**: QuePasa (não oficial) inicialmente, com adapter pattern para migração futura à Meta Cloud API

Detalhes em [arquitetura.md](./arquitetura.md).

## Glossário rápido

Termos técnicos usados em decisões e que vale dominar:

- **Pool model** (AWS SaaS Lens): single DB compartilhado entre tenants com isolamento via `tenant_id` e RLS. Padrão dominante no SaaS B2B moderno.
- **Bridge model**: schema-per-tenant. Em declínio.
- **Silo model**: DB-per-tenant. Renascendo via Neon/Turso para casos específicos.
- **RLS (Row-Level Security)**: feature do Postgres que aplica filtro em todas as queries automaticamente, baseado em variáveis de sessão. Rede de segurança pra isolamento de tenant.
- **Modular monolith**: arquitetura onde o sistema é dividido em módulos com fronteiras claras, mas roda como poucos deploys. Ponto-meio entre monolito tradicional e microsserviços.
- **Service-based architecture**: variação do modular monolith com poucas aplicações deployáveis (no caso do Elora: `core` e `chat`).
- **Adapter pattern**: padrão de design onde uma interface única tem implementações diferentes (ex: `IWhatsAppProvider` com `QuePasaAdapter` e `MetaCloudAdapter`). Permite trocar implementação sem reescrever consumidores.
