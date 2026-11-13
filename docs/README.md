# Documentação Elora

Pasta de referência viva do projeto. Tudo que for decidido sobre arquitetura, escopo, padrões e processos é registrado aqui antes de virar código.

## Índice

| Documento | O que contém |
|---|---|
| [visao-geral.md](./visao-geral.md) | O que é o Elora, nicho, origem, escopo de produto |
| [arquitetura.md](./arquitetura.md) | Decisões técnicas registradas — stack, tenancy, modular monolith, abstração WhatsApp |
| [chat-domain.md](./chat-domain.md) | Modelo do ciclo do cliente — jornadas, conversas, mensagens, tratamentos, automações |
| [contracts-domain.md](./contracts-domain.md) | Assinatura digital de documentos — ZapSign adapter, webhook, persistência do PDF, fases |
| [payment-links-domain.md](./payment-links-domain.md) | Link de pagamento por parcela via Asaas (conta da clínica): fluxos, regras, webhook, modelo de dados. Esboço, não implementado |
| [db-workflow.md](./db-workflow.md) | Como adicionar/alterar/remover estrutura de banco — schema.ts → migration → apply |
| [api-openapi.md](./api-openapi.md) | OpenAPI registry + Postman auto-update — pattern de `registerPath` que toda rota HTTP segue |
| [frontend-design-system.md](./frontend-design-system.md) | Padrões em uso no `apps/frontend` — catálogo de componentes, tokens, anti-patterns |
| [realtime-socket-events.md](./realtime-socket-events.md) | Inventário de eventos socket — publishers, payloads, salas, consumers, query invalidations, gaps conhecidos |
| [dashboard-domain.md](./dashboard-domain.md) | Métricas, blocos e regras de filtro do dashboard `/` — esboço fechado do V1 |
| dashboard-implementation.md | Guia prático de implementação do dashboard — arquivos, contrato do endpoint, roteiro de 8 PRs |
| decisoes-pendentes.md | Tópicos ainda em aberto, ordenados pelo bloqueio que geram |

## Como manter

- **Toda decisão arquitetural relevante entra em [arquitetura.md](./arquitetura.md)** com formato: contexto → opções consideradas → escolha → justificativa. Não basta dizer "usamos X" — o "por que" é o que evita revisitar a discussão depois.
- **Quando uma decisão pendente vira fechada**, move de decisoes-pendentes.md para [arquitetura.md](./arquitetura.md) (ou outro doc apropriado).
- **Decisão revertida não some** — vira nota em [arquitetura.md](./arquitetura.md) explicando o que mudou e por quê. Histórico de decisões é tão útil quanto a decisão atual.
- **Documentos curtos e específicos** sempre que possível. Quando um tópico crescer demais (ex: WhatsApp, billing), extrai pra arquivo próprio.
