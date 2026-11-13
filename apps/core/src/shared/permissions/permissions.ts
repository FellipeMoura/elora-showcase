// Fonte única de verdade pras permissões de módulo. Mapeia ações
// (`<recurso>:<ação>`) pros roles que têm autorização. Cada `groups.role_code`
// no banco precisa estar listado aqui — adicionar role novo é migration +
// atualização deste arquivo (PR único, revisão obrigatória).
//
// Visibilidade de menu é coisa diferente — fica em `menu_groups`, controlada
// pelo admin do tenant via UI. Aqui é regra de negócio do app.

export const ROLE_CODES = [
  'admin',
  'manager',
  'professional',
  'reception',
  'viewer',
  // System agent (apps/agent, V1 2026-06) — não-humano. Vincula-se ao group
  // global "Agente IA" via user is_system_agent=true. Permissions enxutas:
  // ler catálogos + agendamento + envio de mensagem (mensagens/conversas
  // vivem em apps/chat e não usam este map; o JWT do agent só ganha o que
  // precisa pra rodar tools do apps/core). Ver docs/ai-agent-implementation.md.
  'agent',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSIONS = {
  // Usuários
  'users:read': ['admin', 'manager'],
  'users:write': ['admin'],
  'users:delete': ['admin'],

  // Grupos
  'groups:read': ['admin', 'manager'],
  'groups:write': ['admin'],
  'groups:delete': ['admin'],

  // Menus (CRUD — quem configura a navegação do tenant)
  'menus:read': ['admin', 'manager'],
  'menus:write': ['admin'],
  'menus:delete': ['admin'],

  // Clientes — entidade central do negócio. Praticamente todos os roles
  // operacionais leem; cadastro/edição fica com staff de gestão e recepção.
  // Agente lê pra carregar contexto do cliente no system prompt.
  'clients:read': ['admin', 'manager', 'professional', 'reception', 'viewer', 'agent'],
  'clients:write': ['admin', 'manager', 'reception'],
  'clients:delete': ['admin'],

  // Procedimentos (catálogo) — staff operacional consulta pra montar quotes
  // e agendar; edição/criação é decisão de gestão (preço, sessão default).
  // Agente lê pra responder dúvidas e montar slot search.
  'procedures:read': ['admin', 'manager', 'professional', 'reception', 'viewer', 'agent'],
  'procedures:write': ['admin', 'manager'],
  'procedures:delete': ['admin'],

  // Salas (units) — leitura aberta pra todos os papéis operacionais (recepção
  // associa appointment à sala). Cadastro fica em admin/manager.
  'units:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'units:write': ['admin', 'manager'],
  'units:delete': ['admin'],

  // Equipamentos — mesma regra de units. Recepção/aplicadora consultam pra
  // vincular ao appointment; gestão cuida do catálogo.
  'equipments:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'equipments:write': ['admin', 'manager'],
  'equipments:delete': ['admin'],

  // Jornadas — entidade central do funil. Reception cria manual + marca
  // won/lost; professional vê pra contexto clínico; viewer só lê.
  'journeys:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'journeys:write': ['admin', 'manager', 'reception'],
  'journeys:delete': ['admin'],

  // Templates de ficha (anamnese, avaliação). Edição/criação é decisão
  // estrutural (admin/manager); leitura precisa pra avaliadora preencher.
  'formTemplates:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'formTemplates:write': ['admin', 'manager'],
  'formTemplates:delete': ['admin'],

  // Fichas preenchidas (anamnese aplicada). Avaliadora (professional)
  // preenche e completa; reception cria nova ficha pra cliente novo.
  'clientForms:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'clientForms:write': ['admin', 'manager', 'professional', 'reception'],
  'clientForms:delete': ['admin'],

  // Avaliações (entidade clínica). Avaliadora preenche + completa; recepção
  // cria a entidade junto com o appointment.
  'evaluations:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'evaluations:write': ['admin', 'manager', 'professional', 'reception'],
  'evaluations:delete': ['admin'],

  // Orçamentos. Avaliadora (professional) cria pós-avaliação; recepção
  // fecha venda; admin/manager têm visão completa.
  'quotes:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'quotes:write': ['admin', 'manager', 'professional', 'reception'],
  'quotes:delete': ['admin'],

  // Vendas (sales + payments). Recepção fecha venda e marca parcela paga;
  // admin/manager têm relatórios financeiros completos. Professional só lê
  // (precisa pra ver histórico do cliente). Delete só admin (estorno).
  'sales:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'sales:write': ['admin', 'manager', 'reception'],
  'sales:delete': ['admin'],

  // Caixa (view operacional dos payments recebidos). Recepção precisa ver
  // entradas do dia pra conferência; admin/manager têm visão completa;
  // viewer lê pra auditoria. Sem write/delete (caixa é só leitura no MVP).
  'cashier:read': ['admin', 'manager', 'reception', 'viewer'],

  // Agenda unificada (evaluations + procedures). Recepção agenda + confirma;
  // aplicadora marca presença (attended). attended em kind=procedure dispara
  // cascata treatment + transition; em kind=evaluation marca evaluation done.
  // Agente lê pra confirmar disponibilidade do cliente; write pra criar
  // agendamento via confirmAppointment (fase 2 do flow).
  'appointments:read': ['admin', 'manager', 'professional', 'reception', 'viewer', 'agent'],
  'appointments:write': ['admin', 'manager', 'professional', 'reception', 'agent'],
  'appointments:delete': ['admin'],

  // Sessões de procedimento. Aplicadora edita evolutionNotes; admin/manager
  // têm override manual (done/cancel) pra casos legacy/importação.
  'procedureSessions:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'procedureSessions:write': ['admin', 'manager', 'professional'],
  'procedureSessions:delete': ['admin'],

  // Presença assinada (foto + assinatura) de sessões de procedimento.
  // Recepção é quem gera o link no popover da agenda; admin/manager têm
  // acesso pra reverter casos excepcionais. Professional lê pra ver
  // atestado de presença ao iniciar evolução.
  'procedureSessionAttendances:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'procedureSessionAttendances:write': ['admin', 'manager', 'reception'],
  'procedureSessionAttendances:delete': ['admin'],

  // Tratamentos. Aplicadora ajusta nome/notes e pode fechar manualmente;
  // admin/manager reabrem.
  'treatments:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'treatments:write': ['admin', 'manager', 'professional'],
  'treatments:delete': ['admin'],

  // Disponibilidade do profissional (regras semanais + exceções + free slots).
  // Read aberto pra todos (recepção precisa consultar pra agendar).
  // Write inclui professional porque o Service aplica gate self-only
  // pra professional (admin/manager têm liberdade total). Ver
  // AvailabilityService.assertCanManage.
  // Agente lê pra calcular slots livres dentro do tool searchAvailableSlots.
  'availability:read': ['admin', 'manager', 'professional', 'reception', 'viewer', 'agent'],
  'availability:write': ['admin', 'manager', 'professional'],

  // Contratos digitais (assinatura via ZapSign). Recepção dispara contrato
  // pro cliente como parte do fluxo pré-procedimento; professional vê pra
  // contexto clínico; viewer só lê (auditoria). Delete = cancelar documento.
  'contracts:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'contracts:write': ['admin', 'manager', 'reception'],
  'contracts:delete': ['admin'],

  // Templates de contrato (apontamento pra template no painel ZapSign).
  // Decisão administrativa de catálogo — admin/manager apenas.
  'contractTemplates:read': ['admin', 'manager'],
  'contractTemplates:write': ['admin', 'manager'],
  'contractTemplates:delete': ['admin'],

  // Tags de conversa (catálogo definido por tenant, aplicado a conversations
  // via conversation_tag_assignments). Aplicação por humano (chat UI) ou pelo
  // agente IA (tool tagConversation). Read aberto pra todos os roles
  // operacionais — chip aparece em qualquer lista de conversation. Write é
  // gestão do catálogo (admin/manager) + agente. Aplicação/remoção de tag
  // numa conversation passa pelo endpoint de assignments (própria permission).
  'conversationTags:read': ['admin', 'manager', 'professional', 'reception', 'viewer', 'agent'],
  'conversationTags:write': ['admin', 'manager', 'agent'],
  'conversationTags:delete': ['admin'],

  // Dashboard (home analítica). Visão geral agregada do negócio — todos os
  // roles operacionais visualizam por padrão (V1). Só leitura: não há write
  // nem delete (números são derivados de outras entidades).
  'dashboard:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],

  // Relatórios. Read = listar e executar os que enxergam (filtrados por
  // report_tenants + report_groups). Write = super-admin gerencia visibility
  // do catálogo (gate adicional via requirePlatformAccess nas rotas).
  // Catálogo em si é code-driven (reportRegistry) — não há delete pelo banco.
  'reports:read': ['admin', 'manager', 'professional', 'reception', 'viewer'],
  'reports:write': ['admin'],

  // Chat WhatsApp (apps/chat). Espelho de apps/chat/src/shared/permissions/
  // permissions.ts — mudar os dois juntos. Aqui o core usa pra escolher as
  // salas do socket e pro `chatEnabled` do /auth/me.
  //   - chat:use: inbox, conversas e envio. Todos os roles (clínica não tem
  //     recorte de carteira — toda a equipe vê todas as conversas). O agente
  //     IA envia resposta via POST /conversations/:id/messages.
  //   - chat:manage: canais WhatsApp (criar, parear, desativar, limpar),
  //     escrita de templates, contatos (listar/editar/opt-in) e payload bruto.
  'chat:use': ['admin', 'manager', 'professional', 'reception', 'viewer', 'agent'],
  'chat:manage': ['admin', 'manager'],
} as const satisfies Record<string, readonly RoleCode[]>;

export type PermissionAction = keyof typeof PERMISSIONS;

export function hasPermission(
  userRoles: readonly RoleCode[],
  action: PermissionAction
): boolean {
  const allowed = PERMISSIONS[action] as readonly RoleCode[];
  return userRoles.some((role) => allowed.includes(role));
}
