import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { hashPassword } from '@elora/auth';
import {
  appointments,
  clientForms,
  clients,
  conversations,
  createDb,
  eq,
  evaluations,
  formAnswers,
  formQuestions,
  formTemplates,
  groups,
  journeyEvents,
  journeys,
  menuGroups,
  menuTenants,
  menus,
  messageTemplates,
  messages,
  payments,
  procedureSessions,
  procedures,
  quoteItems,
  quotes,
  reportGroups,
  reportTenants,
  reports,
  saleItems,
  sales,
  sql,
  tenants,
  treatmentProcedures,
  treatments,
  units,
  userGroups,
  userUnits,
  users,
  whatsappChannels,
  // Agente de IA (V1, 2026-06)
  conversationTags,
} from './src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { db } = createDb({
  host: process.env.DATABASE_HOST!,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER!,
  password: process.env.DATABASE_PASSWORD!,
  database: process.env.DATABASE_NAME!,
});

const tenantsToSeed = [
  { slug: 'clinica', name: 'Clínica' },
];

// Slug do tenant de demonstração que recebe dados fictícios de kanban.
// Pra outros tenants client (se existirem), só users/menus/canal mock/templates.
const DEMO_TENANT_SLUG = 'clinica';

// Nomes BR realistas pra gerar combinações de clientes fictícios. Misturados
// masculino/feminino — clínicas atendem ambos.
const DEMO_FIRST_NAMES = [
  'Ana', 'Beatriz', 'Carla', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela',
  'Helena', 'Isabela', 'Júlia', 'Larissa', 'Mariana', 'Natália', 'Olívia',
  'Patrícia', 'Rafaela', 'Sofia', 'Tatiana', 'Vanessa', 'Yasmin',
  'André', 'Bruno', 'Caio', 'Diego', 'Eduardo', 'Fábio', 'Gustavo',
  'Henrique', 'Igor', 'João', 'Lucas', 'Marcos', 'Otávio', 'Paulo', 'Rafael',
];

const DEMO_LAST_NAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa',
  'Ferreira', 'Almeida', 'Rodrigues', 'Gomes', 'Martins', 'Carvalho',
  'Araújo', 'Ribeiro', 'Barbosa', 'Cardoso', 'Castro', 'Dias', 'Moreira',
];

const DEMO_SOURCES = ['whatsapp', 'manual', 'form'] as const;

// Stages não-lead recebem 2 journeys cada; leadSubstage fica NULL.
const DEMO_NON_LEAD_STAGES = ['evaluation', 'sale', 'treatment', 'result'] as const;

// Substages do funil de lead — 3-5 journeys (random) cada pra kanban orgânico.
// Substage é setado direto (sem messages/appointments/quotes de suporte) —
// suficiente pra visualização do kanban; rodar `recomputeLeadSubstage` por cima
// resetaria pra 'new' por falta de eventos derivados. Aceito pra dados de demo.
const DEMO_LEAD_SUBSTAGES = [
  'new', 'template', 'contact', 'scheduled', 'no_show', 'rescheduled', 'quoted',
] as const;

function demoPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function demoRandInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function demoDaysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function demoDaysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function demoHoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// Catálogo mínimo de procedimentos por tenant demo. defaultSessions reflete
// pacote típico de depilação a laser (8-10 sessões/região). Cor pro card na
// agenda quando user está no modo `procedure`.
const DEMO_PROCEDURES = [
  { name: 'Depilação Axila', defaultSessions: 8, defaultPrice: '120.00', color: '#3b82f6' },
  { name: 'Depilação Buço', defaultSessions: 6, defaultPrice: '80.00', color: '#f59e0b' },
  { name: 'Depilação Pernas Inteiras', defaultSessions: 10, defaultPrice: '380.00', color: '#10b981' },
  { name: 'Depilação Virilha Completa', defaultSessions: 8, defaultPrice: '180.00', color: '#ec4899' },
];

// Anamnese inicial — uma única template marcada `requiredForEvaluation=true`
// pra exercitar o guard rail "ficha obrigatória antes de mover evaluation→sale".
const DEMO_FORM_TEMPLATE = {
  name: 'Anamnese inicial',
  description: 'Histórico clínico e de pele preenchido na primeira avaliação.',
  requiredForEvaluation: true,
};

const DEMO_FORM_QUESTIONS = [
  {
    prompt: 'Já fez algum procedimento estético antes?',
    questionType: 'yes_no' as const,
    section: 'Histórico',
    position: 0,
    required: true,
  },
  {
    prompt: 'Possui alguma alergia conhecida?',
    questionType: 'text' as const,
    section: 'Histórico',
    position: 1,
    required: false,
  },
  {
    prompt: 'Toma algum medicamento contínuo?',
    questionType: 'text' as const,
    section: 'Histórico',
    position: 2,
    required: false,
  },
  {
    prompt: 'Tipo de pele (Fitzpatrick)',
    questionType: 'multiple_choice' as const,
    options: ['I', 'II', 'III', 'IV', 'V', 'VI'],
    section: 'Avaliação clínica',
    position: 3,
    required: true,
  },
  {
    prompt: 'Nível de sensibilidade à dor (0-10)',
    questionType: 'scale' as const,
    options: { min: 0, max: 10 },
    section: 'Avaliação clínica',
    position: 4,
    required: false,
  },
  {
    prompt: 'Data da última exposição solar prolongada',
    questionType: 'date' as const,
    section: 'Avaliação clínica',
    position: 5,
    required: false,
  },
];

// Janela temporal por stage avançado (dias atrás em que a journey nasceu).
// Calibrada pra densificar os 2 gráficos comerciais do dashboard (Evolução +
// Funil) na janela padrão (~30-90d).
//
// CRÍTICO — os FLOORS evitam datas no futuro. O seed é "forward": a partir do
// createdAt, encadeia eventos com offsets (stage_changed +1-5d, avaliação
// +2-10d, orçamento +1-3d, aceite +1-5d). Se a journey nascer recente demais,
// o último evento (avaliação realizada, venda fechada, conclusão) cai DEPOIS
// de agora — gerando avaliação `performed`/venda `closed` no futuro. Floors:
//  - evaluation: ≥15d (avaliação realizada = created + até ~15d).
//  - sale:       ≥25d (venda fechada = created + até ~23d).
//  - treatment:  ≥45d (venda fechada cedo; sessões pendentes podem ser futuras
//                — OK, ficam 'scheduled').
//  - result:     ≥185d (tratamento conclui em created + até ~179d: 8 sessões
//                × 21d + pré-tratamento). Nasce ~6 meses atrás pra concluir no
//                passado recente → journey 'won' na janela.
const STAGE_CREATED_RANGE: Record<
  'evaluation' | 'sale' | 'treatment' | 'result',
  [number, number]
> = {
  evaluation: [15, 33],
  sale: [25, 55],
  treatment: [45, 115],
  result: [185, 215],
};

// Quantas journeys ativas semear por stage avançado. `sale` em maior volume
// (motor das Vendas R$/qtd + ticket médio recentes); `result` em bom número
// pra render journeys 'won' (conversão + ciclo lead→venda).
const DEMO_STAGE_COUNTS: Record<
  'evaluation' | 'sale' | 'treatment' | 'result',
  number
> = {
  evaluation: 8,
  sale: 14,
  treatment: 5,
  result: 10,
};

// Journeys PERDIDAS (status='lost') — negócios que caíram após a avaliação.
// Ficam em stage='evaluation' (avaliação realizada, cliente não fechou),
// NUNCA em 'lead' (poluiria o kanban — o board lista todo stage='lead'
// independentemente de status). Fecham nos últimos ~30d → dão denominador
// pra conversão lead→venda e alimentam os motivos de perda (bloco C3).
const DEMO_LOST_COUNT = 10;
const DEMO_LOST_REASONS = ['price', 'disqualified', 'timeout', 'other'] as const;

// Frases curtas PT-BR pra dar corpo às conversas fictícias do kanban.
// Sem emoji por preferência de codebase. Conteúdo é genérico — qualquer
// substage pode embarcar qualquer frase sem destoar.
const DEMO_INBOUND_TEXTS = [
  'Oi! Gostaria de saber mais sobre depilação a laser',
  'Vocês atendem aos sábados?',
  'Qual é o valor da sessão de axila?',
  'Bom dia, quero marcar uma avaliação',
  'Olá, vocês têm desconto pra pacote?',
  'Oi, peguei o contato pelo Instagram',
  'Pode me passar mais informações?',
  'Estou interessada, como funciona?',
  'Vocês fazem em outras regiões além da axila?',
  'Quanto tempo dura o tratamento completo?',
  'Posso reagendar minha avaliação?',
  'Recebi o orçamento, vou analisar e te retorno',
];

const DEMO_OUTBOUND_TEXTS = [
  'Olá! Que bom que entrou em contato',
  'Claro, vou te passar todas as informações',
  'Temos disponibilidade essa semana, posso agendar?',
  'Nossa avaliação é gratuita e dura cerca de 30 minutos',
  'Te mando o link com os horários disponíveis',
  'Posso tirar suas dúvidas, pode falar',
  'Sim, oferecemos descontos especiais em pacotes',
  'Vou te enviar nosso catálogo completo agora',
  'Confirma sua presença para amanhã às 10h?',
  'Estamos à disposição quando quiser remarcar',
  'Te enviei o orçamento, qualquer dúvida me avisa',
];

// Follow-ups inbound usados pra ancorar a "caixa de entrada viva" — cliente
// retomando contato sem resposta da equipe. Alimentam o D3 do dashboard
// ("Conversas sem resposta há >2h"). Tom de quem aguarda retorno.
const DEMO_FOLLOWUP_TEXTS = [
  'Oi, conseguiu ver minha mensagem?',
  'Ainda tem horário disponível essa semana?',
  'Bom dia! Aguardo retorno sobre o orçamento',
  'Olá, gostaria de confirmar se posso agendar',
  'Oi, vocês ainda atendem por aqui?',
  'Consegue me passar os valores atualizados?',
  'Boa tarde, fiquei na dúvida sobre o pacote',
  'Oi! Posso remarcar minha avaliação?',
  'Ficou alguma pendência pra eu fechar o agendamento?',
  'Olá, retomando aqui — ainda tenho interesse',
];

interface DemoMessageSpec {
  direction: 'inbound' | 'outbound';
  body: string;
  offsetMin: number;
}

// Gera sequência de mensagens compatível com o substage manualmente setado:
//  - new:       só inbound (sem outbound de staff)
//  - template:  termina em outbound (sem inbound posterior)
//  - contact:   termina em inbound posterior à última outbound
//  - demais:    mix orgânico — apenas dá corpo à timeline
// Mantém coerência mesmo sabendo que substage não é derivado por
// `recomputeLeadSubstage` (que poderia recalcular dif. — risco aceito).
function craftDemoMessages(substage: string | null): DemoMessageSpec[] {
  const out: DemoMessageSpec[] = [];
  let cursor = 0;

  if (substage === 'new') {
    const n = demoRandInt(1, 2);
    for (let i = 0; i < n; i++) {
      out.push({ direction: 'inbound', body: demoPick(DEMO_INBOUND_TEXTS), offsetMin: cursor });
      cursor += demoRandInt(5, 60);
    }
    return out;
  }

  if (substage === 'template') {
    out.push({ direction: 'inbound', body: demoPick(DEMO_INBOUND_TEXTS), offsetMin: cursor });
    cursor += demoRandInt(30, 240);
    const n = demoRandInt(1, 2);
    for (let i = 0; i < n; i++) {
      out.push({ direction: 'outbound', body: demoPick(DEMO_OUTBOUND_TEXTS), offsetMin: cursor });
      cursor += demoRandInt(60, 600);
    }
    return out;
  }

  if (substage === 'contact') {
    out.push({ direction: 'inbound', body: demoPick(DEMO_INBOUND_TEXTS), offsetMin: cursor });
    cursor += demoRandInt(5, 60);
    const outboundN = demoRandInt(1, 2);
    for (let i = 0; i < outboundN; i++) {
      out.push({ direction: 'outbound', body: demoPick(DEMO_OUTBOUND_TEXTS), offsetMin: cursor });
      cursor += demoRandInt(2, 30);
    }
    const inboundAfterN = demoRandInt(1, 2);
    for (let i = 0; i < inboundAfterN; i++) {
      out.push({ direction: 'inbound', body: demoPick(DEMO_INBOUND_TEXTS), offsetMin: cursor });
      cursor += demoRandInt(2, 30);
    }
    return out;
  }

  // Default: mix orgânico (cobre scheduled/no_show/rescheduled/quoted e
  // todos os stages não-lead). Começa com inbound; alterna com leve viés.
  const total = demoRandInt(3, 7);
  let direction: 'inbound' | 'outbound' = 'inbound';
  for (let i = 0; i < total; i++) {
    out.push({
      direction,
      body: direction === 'inbound' ? demoPick(DEMO_INBOUND_TEXTS) : demoPick(DEMO_OUTBOUND_TEXTS),
      offsetMin: cursor,
    });
    cursor += demoRandInt(5, 90);
    // Alterna com ~70% de chance, senão repete (cliente mandando 2 seguidas etc).
    if (Math.random() < 0.7) {
      direction = direction === 'inbound' ? 'outbound' : 'inbound';
    }
  }
  return out;
}

// Templates default por tenant. Cobrem os 3 estágios mais comuns onde
// templates aparecem como sugestão na UI (chat-domain.md §9 nível 2).
// `surface_in_stage` é a chave — frontend filtra por stage atual da journey
// ativa. Admin do tenant edita/cria mais depois.
const defaultTemplates = [
  {
    name: 'Boas-vindas',
    body: 'Olá {{nome}}! Recebemos seu contato. Como podemos te ajudar?',
    kind: 'text' as const,
    surfaceInStage: ['lead'],
  },
  {
    name: 'Lembrete avaliação D-1',
    body:
      'Oi {{nome}}, lembrando da sua avaliação amanhã às {{hora}} na {{unidade}}. ' +
      'Confirma sua presença?',
    kind: 'text' as const,
    surfaceInStage: ['lead', 'evaluation'],
  },
  {
    name: 'Pós-procedimento — cuidados',
    body:
      'Oi {{nome}}, como você está se sentindo? Lembrando dos cuidados pós: ' +
      'evitar exposição solar 48h e usar protetor FPS 50+.',
    kind: 'text' as const,
    surfaceInStage: ['treatment', 'result'],
  },
];

// Catálogo global de menus. Itens marcados `platformOnly: true` ficam visíveis
// apenas pra equipe Elora (tenant `platform`); tenants clientes não recebem
// vínculo em `menu_tenants` pra eles. Ver requirePlatformAccess.ts.
interface MenuSeed {
  label: string;
  icon?: string;
  path?: string;
  position: number;
  platformOnly?: boolean;
  children?: MenuSeed[];
}

// Catálogo refletindo o estado real do banco (ajustado manualmente via UI
// de Menus). Inconsistência de leading slash em paths é intencional —
// preservada do estado de produção/dev atual.
//
// Posições não são contíguas — Jornadas vive em 98 e Configurações em 99 pra
// reservar espaço pra inserções futuras no meio sem renumerar tudo.
const defaultMenus: MenuSeed[] = [
  { label: 'Dashboard', icon: 'home', path: '/', position: 0 },
  { label: 'Leads', icon: 'kanban', path: 'leads', position: 1 },
  { label: 'Clientes', icon: 'users', path: 'clients', position: 2 },
  { label: 'Agenda', icon: 'calendar-days', path: 'agenda', position: 3 },
  // Avaliações como módulo operacional de 1ª classe — lista/condução das
  // avaliações clínicas dos clientes. O catálogo de templates de ficha
  // (perguntas) vive em Configurações > Fichas de avaliação, pois é config.
  { label: 'Avaliações', icon: 'stethoscope', path: '/evaluations', position: 4 },
  // Evoluções — visão da agenda do aplicador focada em registrar a
  // evolução clínica das sessões (signed → done). Apenas a agenda do
  // próprio usuário pra professional; admin/manager escolhem qualquer
  // aplicador via filtro na toolbar.
  { label: 'Evoluções', icon: 'notebook-pen', path: '/evolutions', position: 6 },
  { label: 'Orçamentos', icon: 'file-text', path: 'quotes', position: 5 },
  // Vendas saiu do menu padrão — acesso fica restrito a admin via URL direta
  // (/sales) pra auditoria. A info essencial da venda (valor + data) aparece
  // inline na listagem de orçamentos quando o quote foi fechado.
  { label: 'Caixa', icon: 'wallet', path: 'cashier', position: 7 },
  { label: 'Procedimentos', icon: 'clipboard-list', path: 'procedures', position: 8 },
  // Tratamentos — visão agregada por cliente dos pacotes vendidos. Lista
  // todos os treatments com progresso (sessões realizadas / total) e
  // permite drill-in pra ver sessions, evoluções clínicas e assinaturas.
  { label: 'Tratamentos', icon: 'activity', path: 'treatments', position: 12 },
  // Contratos digitais (assinatura ZapSign). Usado pré-procedimento (termo
  // de consentimento) e pós-venda (contrato de pacote). Os templates moram
  // em Configurações > Templates de contrato.
  { label: 'Contratos', icon: 'file-signature', path: 'contracts', position: 9 },
  // Chat é container (sem path próprio) — abre lista de templates/canais
  // dentro. UI da conversa vive como tab da sidebar (FloatingChatWindow).
  {
    label: 'Chat',
    icon: 'message-circle-code',
    position: 10,
    children: [
      {
        label: 'Templates',
        icon: 'message-square-text',
        path: 'settings/message-templates',
        position: 0,
      },
      {
        label: 'Canais',
        icon: 'message-square-code',
        path: '/settings/whatsapp-channels',
        position: 3,
      },
    ],
  },
  { label: 'Jornadas', icon: 'route', path: 'journeys', position: 98 },
  // Relatórios — catálogo dinâmico (cada tenant/grupo enxerga uma combinação
  // personalizada via report_tenants + report_groups). Handlers em código no
  // registry de apps/core/src/modules/reports/registry.ts.
  { label: 'Relatórios', icon: 'bar-chart-3', path: '/reports', position: 11 },
  {
    label: 'Configurações',
    icon: 'settings',
    position: 99,
    children: [
      // Preferências do user logado (tema, notificações, etc).
      {
        label: 'Preferências',
        icon: 'palette',
        path: 'settings/preferences',
        position: 0,
      },
      // Catálogo de menus é gerenciado SÓ pela equipe Elora — gate em
      // requirePlatformAccess. Não exibir o item pra tenants clientes.
      {
        label: 'Menus',
        icon: 'menu',
        path: '/settings/menus',
        position: 1,
        platformOnly: true,
      },
      // Grupos é acessível via toolbar da UsersPage (Sheet read-only). Sem
      // entrada no menu — catálogo global gerenciado pela equipe Elora.
      { label: 'Usuários', icon: 'user', path: '/settings/users', position: 2 },
      {
        label: 'Disponibilidade',
        icon: 'clock',
        path: 'settings/availability',
        position: 4,
      },
      {
        label: 'Salas',
        icon: 'door-open',
        path: 'settings/units',
        position: 6,
      },
      {
        label: 'Equipamentos',
        icon: 'wrench',
        path: 'settings/equipments',
        position: 7,
      },
      // Catálogo de templates de ficha (perguntas) — config de avaliação.
      // Preenchimento das fichas dos clientes acontece no detalhe do cliente.
      // Colisão de position com Disponibilidade preservada do estado real do
      // banco (ambas em 4) — backend ordena por label como desempate.
      {
        label: 'Fichas de avaliação',
        icon: 'clipboard-pen',
        path: 'form-templates',
        position: 4,
      },
      // Templates de contrato — apontamento pra modelos cadastrados no
      // painel ZapSign + lista de variáveis esperadas pra renderizar o form
      // de envio. Cadastrado por admin/manager.
      {
        label: 'Templates de contrato',
        icon: 'file-signature',
        path: 'settings/contract-templates',
        position: 8,
      },
      // Catálogo de tags aplicáveis a conversations (humano via UI chat
      // ou agente IA via tool tagConversation). agentInstruction preenchida
      // = tag disponível pro agente; vazia = tag só pra humano.
      {
        label: 'Tags da conversa',
        icon: 'tags',
        path: 'settings/conversation-tags',
        position: 9,
      },
      // Gerenciamento de tenants (clínicas) — equipe Elora apenas.
      {
        label: 'Tenants',
        icon: 'building-2',
        path: '/settings/tenants',
        position: 5,
        platformOnly: true,
      },
    ],
  },
];

// Slug do tenant da equipe Elora — espelha PLATFORM_TENANT_SLUG do middleware.
// Não importar aqui pra manter o pacote db independente do app core.
const PLATFORM_SLUG = 'main';

// Marker pra encontrar e printar a config completa do canal Mock no final.
interface SeededChannelInfo {
  tenantSlug: string;
  channelId: string;
  channelName: string;
}

async function seed(): Promise<void> {
  // ---- Snapshot de canais REAIS (não-mock) antes do TRUNCATE ----
  // Pareação WhatsApp vive no Evolution (instanceName + apiKey identificam
  // a instância). Se a gente recriar a linha de whatsapp_channels apontando
  // pro mesmo instanceName/apiKey, a conexão volta sem precisar parear de
  // novo. Mocks são descartados (próximo seed recria como sempre).
  //
  // CRÍTICO: também preservar `id` (UUID) do canal — o webhook URL gravado
  // dentro do Evolution embute esse UUID. Se mudar o id, todo evento
  // recebido bate em endpoint inexistente, gerando 404 spam.
  //
  // Vinculação por `tenant.slug` — slugs são estáveis entre seeds.
  const preservedChannels = await db
    .select({
      id: whatsappChannels.id,
      tenantSlug: tenants.slug,
      name: whatsappChannels.name,
      providerType: whatsappChannels.providerType,
      providerConfig: whatsappChannels.providerConfig,
      phoneNumber: whatsappChannels.phoneNumber,
      active: whatsappChannels.active,
    })
    .from(whatsappChannels)
    .innerJoin(tenants, eq(tenants.id, whatsappChannels.tenantId))
    .where(sql`(${whatsappChannels.providerConfig}->>'mock')::boolean IS NOT TRUE`);

  // Indexa por slug pra restaurar o canal INLINE dentro da transação do
  // tenant (em vez de só pós-loop). Necessário porque o chat demo precisa de
  // um channel_id válido já durante o seed dos clientes/conversas — quando há
  // canal real preservado, sem isso o bloco de chat era pulado e o tenant
  // ficava sem nenhuma conversa (D3 do dashboard vazio).
  const preservedChannelBySlug = new Map(
    preservedChannels.map((c) => [c.tenantSlug, c]),
  );
  // Slugs cujo canal preservado já foi restaurado dentro da transação do
  // tenant — a restauração pós-loop os ignora pra não inserir 2x.
  const restoredInlineSlugs = new Set<string>();
  const restoredChannels: SeededChannelInfo[] = [];

  // TRUNCATE não respeita RLS — limpa direto. CASCADE cuida das FKs e
  // alcança todas as tabelas que referenciam tenants (direta ou
  // transitivamente: clients, journeys, whatsapp_*, conversations,
  // messages, etc).
  await db.execute(
    sql`TRUNCATE report_tenants, report_groups, reports, menu_tenants, menu_groups, menus, user_groups, groups, user_units, units, users, tenants CASCADE`
  );

  // ---- Grupos GLOBAIS (1:1 com role_code) ----
  // Criados uma única vez, antes de qualquer tenant. Tenants vinculam users
  // via user_groups; nunca criam grupos próprios.
  const globalGroupSeeds = [
    {
      name: 'Administradores',
      roleCode: 'admin' as const,
      description: 'Acesso total ao tenant.',
    },
    {
      name: 'Gerentes',
      roleCode: 'manager' as const,
      description: 'Gestão operacional do tenant (sem configurações de plataforma).',
    },
    {
      name: 'Profissionais',
      roleCode: 'professional' as const,
      description: 'Equipe técnica — agenda, fichas, sessões.',
    },
    {
      name: 'Recepção',
      roleCode: 'reception' as const,
      description: 'Atendimento e cadastro de clientes.',
    },
    {
      name: 'Visualizadores',
      roleCode: 'viewer' as const,
      description: 'Acesso somente leitura.',
    },
    {
      name: 'Agente IA',
      roleCode: 'agent' as const,
      description:
        'System agent (apps/agent) — não-humano. Único user por tenant com is_system_agent=true. Permissions enxutas: leitura de catálogos + agendamento + envio de mensagem.',
    },
  ];

  const globalGroups = await db.insert(groups).values(globalGroupSeeds).returning();
  const groupByRole = new Map(globalGroups.map((g) => [g.roleCode, g]));
  const adminGroup = groupByRole.get('admin')!;
  const managerGroup = groupByRole.get('manager')!;
  const professionalGroup = groupByRole.get('professional')!;
  const receptionGroup = groupByRole.get('reception')!;
  const viewerGroup = groupByRole.get('viewer')!;
  const agentGroup = groupByRole.get('agent')!;

  // Cria o catálogo de menus GLOBAL uma única vez, antes dos tenants.
  // Separa IDs platformOnly dos demais — só o tenant `platform` vê os
  // platformOnly; tenants clientes recebem o resto.
  const allMenuIds: string[] = [];
  const platformOnlyMenuIds = new Set<string>();
  // Mapa de path → menuId pra montar a matriz menu_groups global por slug
  // (mais legível que "todos exceto X" quando a grade cresce).
  const menuIdByPath = new Map<string, string>();
  // parentId por menuId, pra subir e incluir pais quando um filho é visível.
  const parentById = new Map<string, string | null>();

  async function insertGlobalMenuRecursive(
    seed: MenuSeed,
    parentId: string | null,
    parentIsPlatformOnly: boolean
  ): Promise<void> {
    const [created] = await db
      .insert(menus)
      .values({
        parentId,
        label: seed.label,
        icon: seed.icon ?? null,
        path: seed.path ?? null,
        position: seed.position,
      })
      .returning();
    if (!created) throw new Error(`Falha ao criar menu ${seed.label}`);
    allMenuIds.push(created.id);
    parentById.set(created.id, parentId);
    if (seed.path) menuIdByPath.set(seed.path, created.id);
    // Filhos herdam platformOnly do pai — não faz sentido um filho público
    // viver dentro de um pai restrito.
    const isPlatformOnly = parentIsPlatformOnly || Boolean(seed.platformOnly);
    if (isPlatformOnly) platformOnlyMenuIds.add(created.id);
    if (seed.children) {
      for (const child of seed.children) {
        await insertGlobalMenuRecursive(child, created.id, isPlatformOnly);
      }
    }
  }

  for (const root of defaultMenus) {
    await insertGlobalMenuRecursive(root, null, false);
  }

  const clientTenantMenuIds = allMenuIds.filter(
    (id) => !platformOnlyMenuIds.has(id)
  );

  // ---- menu_groups GLOBAL ----
  // Matriz menu × grupo única no sistema. Cada tenant herda a mesma
  // visibilidade. Equipe Elora ajusta via UI super-admin (futuro).
  //
  // Refletindo o estado atual do banco (ajustado manualmente):
  //   - admin:        TODOS (inclui Menus + Tenants platformOnly)
  //   - manager:      tudo exceto platformOnly (Menus, Tenants)
  //   - professional: operacionais (Dashboard, Agenda, Clientes, Leads,
  //                   Fichas, Orçamentos, Procedimentos, Jornadas,
  //                   Preferências, Disponibilidade). Sem Chat.
  //   - reception:    operacionais + Chat>Templates (atende cliente, envia
  //                   templates fora-de-janela). Sem Canais (config).
  //   - viewer:       Dashboard, Preferências (leitura básica).
  const visibleToManager = clientTenantMenuIds; // todos não-platformOnly
  const operationalPaths = [
    '/',
    'settings/preferences',
    'clients',
    'leads',
    'journeys',
    'procedures',
    'quotes',
    'sales',
    'cashier',
    'agenda',
    'settings/availability',
    'settings/units',
    'settings/equipments',
    'form-templates',
    '/evaluations',
    '/evolutions',
    'treatments',
    '/reports',
  ];
  const visibleToProfessional = operationalPaths
    .map((p) => menuIdByPath.get(p))
    .filter((id): id is string => Boolean(id));
  // Reception = professional + acesso a templates de mensagem (envio de
  // templates pra retomar conversa fora da janela 24h, atendimento direto).
  // Canais (config de WhatsApp) fica fora — admin/manager configuram.
  const visibleToReception = [
    ...visibleToProfessional,
    menuIdByPath.get('settings/message-templates'),
  ].filter((id): id is string => Boolean(id));
  const visibleToViewer = ['/', 'settings/preferences']
    .map((p) => menuIdByPath.get(p))
    .filter((id): id is string => Boolean(id));

  // Pais entram junto pra árvore não ficar com "buracos" no sidebar
  // (nó pai 'Cadastros'/'Agenda'/'Configurações' não tem path próprio mas
  // precisa aparecer se algum filho aparecer).
  function expandWithParents(menuIds: string[]): string[] {
    const set = new Set(menuIds);
    for (const id of menuIds) {
      let current = parentById.get(id) ?? null;
      while (current && !set.has(current)) {
        set.add(current);
        current = parentById.get(current) ?? null;
      }
    }
    return [...set];
  }

  const menuGroupPairs = new Set<string>(); // dedup por "menuId|groupId"
  const menuGroupRows: Array<{ menuId: string; groupId: string }> = [];
  function pushPair(menuId: string, groupId: string): void {
    const key = `${menuId}|${groupId}`;
    if (menuGroupPairs.has(key)) return;
    menuGroupPairs.add(key);
    menuGroupRows.push({ menuId, groupId });
  }

  // admin: tudo explícito (inclui Menus platformOnly).
  // manager: lista expandida (já contém o pai Configurações via clientTenantMenuIds).
  // professional/reception/viewer: só folhas — backend resolve ancestrais
  // dinamicamente em MenusService.getVisibleTree (inclui pais cujo filho é
  // visível). Popular pais aqui só inflaria menu_groups sem ganho funcional.
  for (const menuId of allMenuIds) pushPair(menuId, adminGroup.id);
  for (const menuId of expandWithParents(visibleToManager)) pushPair(menuId, managerGroup.id);
  for (const menuId of visibleToProfessional) pushPair(menuId, professionalGroup.id);
  for (const menuId of visibleToReception) pushPair(menuId, receptionGroup.id);
  for (const menuId of visibleToViewer) pushPair(menuId, viewerGroup.id);

  await db.insert(menuGroups).values(menuGroupRows);

  // ---- Reports GLOBAIS ----
  // Catálogo é code-driven (reportRegistry em apps/core). Seed insere o
  // estado inicial pra que, mesmo antes do primeiro boot do core, exista
  // visibility válida e o smoke test funcione. No boot do core o
  // syncReportsRegistry faz onConflictDoUpdate — sem colisão.
  const seedReports = [
    {
      slug: 'leads.summary',
      name: 'Resumo de leads',
      description:
        'Visão consolidada dos leads entrados no período: conversões, perdas, ' +
        'breakdown diário com comparativos vs média, distribuição por origem e ' +
        'motivos de perda.',
      category: 'comercial',
    },
    {
      slug: 'sales.summary',
      name: 'Resumo de vendas',
      description:
        'KPIs de vendas fechadas no período com comparativo vs período ' +
        'anterior de mesma duração. Inclui top procedimentos, distribuição ' +
        'por método de pagamento e performance por vendedor.',
      category: 'comercial',
    },
  ];

  const insertedReports = await db.insert(reports).values(seedReports).returning();

  // report_groups GLOBAL — todos os 5 grupos veem os relatórios seedados.
  // Super-admin gerencia visibility fina via UI quando relatório sensível
  // entrar (ex: financeiro só pra admin).
  const reportGroupRows: Array<{ reportId: string; groupId: string }> = [];
  for (const r of insertedReports) {
    for (const g of globalGroups) {
      reportGroupRows.push({ reportId: r.id, groupId: g.id });
    }
  }
  await db.insert(reportGroups).values(reportGroupRows);

  // Hash bcrypt da senha master (compartilhada entre platform e tenants demo).
  // Em prod foi fornecida pelo dono; em dev local roda hashPassword('senha123')
  // pra manter compatibilidade com docs antigos. NODE_ENV=production usa o
  // hash hardcoded pra evitar dependency de bcrypt em ambientes minimalistas.
  const passwordHash =
    process.env.NODE_ENV === 'production'
      ? '$2b$12$psTL1K2hMOGWomX4Wca4memJd7rFYB.G6zHH2zSxYq3MFR7H0rBEe'
      : await hashPassword('senha123');
  const seededChannels: SeededChannelInfo[] = [];

  // ---- Tenant da equipe Elora (super-admin) ----
  // Acesso a todo o catálogo, sem WhatsApp/templates (não faz sentido pra
  // equipe interna). Login: admin@elora.app.br no subdomínio main.
  const [platformTenant] = await db
    .insert(tenants)
    .values({ slug: PLATFORM_SLUG, name: 'Elora — Plataforma' })
    .returning();
  if (!platformTenant) throw new Error('Falha ao criar tenant main');

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant', ${platformTenant.id}, true)`
    );

    const [unit] = await tx
      .insert(units)
      .values({ tenantId: platformTenant.id, name: 'Equipe' })
      .returning();
    if (!unit) throw new Error('Falha ao criar unit platform');

    const [user] = await tx
      .insert(users)
      .values({
        tenantId: platformTenant.id,
        // Username é a credencial de login; email é contato real (super-admin
        // recebe recovery aqui).
        username: 'admin',
        email: 'admin@elora.app.br',
        passwordHash,
        name: 'Admin Plataforma',
      })
      .returning();
    if (!user) throw new Error('Falha ao criar admin platform');

    await tx.insert(userUnits).values({
      userId: user.id,
      unitId: unit.id,
      tenantId: platformTenant.id,
    });

    // Vincula super-admin ao grupo global "admin".
    await tx.insert(userGroups).values({
      userId: user.id,
      groupId: adminGroup.id,
      tenantId: platformTenant.id,
    });

    // System agent user — mantido pra preservar a invariante "todo tenant
    // tem 1 user is_system_agent". Platform não vai habilitar agent, mas
    // ter o user simplifica o boot do apps/agent (sempre encontra o user
    // por tenant via single query). passwordHash reusa o do admin: seguro
    // porque login pelo agent é bloqueado em camada superior (PR 3+).
    // Email null: agente não recebe comunicação humana.
    await tx.insert(users).values({
      tenantId: platformTenant.id,
      username: 'system_agent',
      email: null,
      passwordHash,
      name: 'Agente IA',
      isSystemAgent: true,
    });
    const [platformAgentUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        sql`${users.tenantId} = ${platformTenant.id} AND ${users.isSystemAgent} = true`,
      )
      .limit(1);
    if (!platformAgentUser) throw new Error('Falha ao localizar agent user platform');
    await tx.insert(userGroups).values({
      userId: platformAgentUser.id,
      groupId: agentGroup.id,
      tenantId: platformTenant.id,
    });

    // Platform enxerga TODO o catálogo, incluindo itens platformOnly.
    await tx.insert(menuTenants).values(
      allMenuIds.map((menuId) => ({ menuId, tenantId: platformTenant.id }))
    );
    // menu_groups é global agora — já populado uma vez antes do loop de tenants.

    // Platform enxerga todos os relatórios — super-admin opera sobre o
    // catálogo. report_groups (global) controla quem dentro de cada
    // tenant efetivamente vê.
    if (insertedReports.length > 0) {
      await tx.insert(reportTenants).values(
        insertedReports.map((r) => ({
          reportId: r.id,
          tenantId: platformTenant.id,
        }))
      );
    }
  });

  for (const t of tenantsToSeed) {
    const [tenant] = await db.insert(tenants).values(t).returning();
    if (!tenant) throw new Error(`Falha ao criar tenant ${t.slug}`);

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenant.id}, true)`);

      const [unit] = await tx
        .insert(units)
        .values({ tenantId: tenant.id, name: 'Matriz' })
        .returning();
      if (!unit) throw new Error('Falha ao criar unit');

      const [user] = await tx
        .insert(users)
        .values({
          tenantId: tenant.id,
          // Username padrão pro admin do tenant demo. Email null: tenants
          // reais preenchem via UI depois quando quiserem recuperação de
          // senha (fluxo futuro).
          username: 'admin',
          email: null,
          passwordHash,
          name: `Admin ${t.name}`,
        })
        .returning();
      if (!user) throw new Error('Falha ao criar user');

      await tx.insert(userUnits).values({
        userId: user.id,
        unitId: unit.id,
        tenantId: tenant.id,
      });

      // Admin do tenant cliente vinculado ao grupo global "admin".
      await tx.insert(userGroups).values({
        userId: user.id,
        groupId: adminGroup.id,
        tenantId: tenant.id,
      });

      // System agent user — 1 por tenant, invariante mantida pelo provisioning
      // de tenant novo (quando virar fluxo automatizado) e pelo seed aqui.
      // Username é o mesmo entre tenants — unique constraint é (tenant_id, username).
      // Email null: agente não recebe comunicação humana.
      // Não vai pra userUnits: agente não tem associação a sala física.
      await tx.insert(users).values({
        tenantId: tenant.id,
        username: 'system_agent',
        email: null,
        passwordHash,
        name: 'Agente IA',
        isSystemAgent: true,
      });
      const [agentUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          sql`${users.tenantId} = ${tenant.id} AND ${users.isSystemAgent} = true`,
        )
        .limit(1);
      if (!agentUser) throw new Error('Falha ao localizar agent user');
      await tx.insert(userGroups).values({
        userId: agentUser.id,
        groupId: agentGroup.id,
        tenantId: tenant.id,
      });

      // Catálogo inicial de tags da conversa pro tenant demo. `agentInstruction`
      // preenchida = tag disponível pro agente IA usar; sem instrução = humano
      // apenas. Cores escolhidas pra contraste em ambos os temas (light/dark).
      await tx.insert(conversationTags).values([
        {
          tenantId: tenant.id,
          name: 'Interessado em laser',
          color: '#3B82F6',
          agentInstruction:
            'Aplique quando o cliente menciona depilação a laser, cita pelos como problema ou pergunta sobre tratamento de pelos.',
        },
        {
          tenantId: tenant.id,
          name: 'Pergunta preço',
          color: '#F59E0B',
          agentInstruction:
            'Aplique quando o cliente pede valor, preço, custo, pacote ou orçamento.',
        },
        {
          tenantId: tenant.id,
          name: 'Quer remarcar',
          color: '#8B5CF6',
          agentInstruction:
            'Aplique quando o cliente pede pra remarcar, mudar horário, adiar ou cancelar um agendamento existente.',
        },
        {
          tenantId: tenant.id,
          name: 'Reclamação',
          color: '#EF4444',
          agentInstruction:
            'Aplique quando o cliente expressa insatisfação, reclama de atendimento/resultado ou ameaça desistir. Considere chamar handoffToHuman em paralelo.',
        },
        {
          tenantId: tenant.id,
          name: 'Curioso',
          color: '#10B981',
          agentInstruction:
            'Aplique quando o cliente pergunta sobre procedimentos em geral, indicações ou informações educativas sem demonstrar intenção clara de agendar.',
        },
      ]);

      // Vincula só os menus públicos (platformOnly fica fora). Super-admin
      // pode ajustar via UI depois de criar mais menus.
      await tx.insert(menuTenants).values(
        clientTenantMenuIds.map((menuId) => ({ menuId, tenantId: tenant.id }))
      );
      // menu_groups é global — não precisa por tenant.

      // Tenant cliente recebe acesso a todos os relatórios seedados.
      // Super-admin pode revogar via UI (PUT /reports/:slug/tenants).
      if (insertedReports.length > 0) {
        await tx.insert(reportTenants).values(
          insertedReports.map((r) => ({
            reportId: r.id,
            tenantId: tenant.id,
          }))
        );
      }

      // Canal de chat do tenant — sempre resolvido pra um id válido aqui
      // dentro, pra o chat demo (conversas/mensagens) ter onde se ancorar.
      //
      //  - Com canal real preservado (pareação Evolution): restaura INLINE
      //    com o UUID original (webhook URL gravado no Evolution embute esse
      //    id — ver snapshot acima). Marca o slug pra restauração pós-loop
      //    pular e não inserir 2x.
      //  - Sem canal preservado: cria um WhatsApp Mock (`provider_config.mock
      //    =true` → factory devolve MockAdapter; testa webhook/outbound sem
      //    Evolution real).
      let chatChannelId: string | null = null;
      const preserved = preservedChannelBySlug.get(t.slug);
      if (preserved) {
        const [restored] = await tx
          .insert(whatsappChannels)
          .values({
            id: preserved.id,
            tenantId: tenant.id,
            name: preserved.name,
            providerType: preserved.providerType,
            providerConfig: preserved.providerConfig,
            phoneNumber: preserved.phoneNumber,
            active: preserved.active,
          })
          .returning();
        if (!restored) throw new Error('Falha ao restaurar whatsapp_channel');
        chatChannelId = restored.id;
        restoredInlineSlugs.add(t.slug);
        restoredChannels.push({
          tenantSlug: t.slug,
          channelId: restored.id,
          channelName: restored.name,
        });
      } else {
        const [channel] = await tx
          .insert(whatsappChannels)
          .values({
            tenantId: tenant.id,
            name: 'WhatsApp Mock',
            providerType: 'baileys',
            providerConfig: { mock: true },
            phoneNumber: '+5511999990000',
          })
          .returning();
        if (!channel) throw new Error('Falha ao criar whatsapp_channel');
        chatChannelId = channel.id;
        seededChannels.push({
          tenantSlug: t.slug,
          channelId: channel.id,
          channelName: channel.name,
        });
      }

      // Templates default — admin customiza/cria mais via UI depois.
      await tx.insert(messageTemplates).values(
        defaultTemplates.map((tmpl) => ({
          tenantId: tenant.id,
          name: tmpl.name,
          body: tmpl.body,
          kind: tmpl.kind,
          surfaceInStage: tmpl.surfaceInStage,
        }))
      );

      // ---- Dados fictícios pro tenant de demonstração ----
      // 2 journeys por stage não-lead + 3-5 (random) por substage de lead.
      // Stages avançados ganham timeline clínica completa (evaluation →
      // appointment → quote → treatment → procedure_sessions) consistente
      // com `journey.stage`, mais journey_events de auditoria.
      // Sem canal mock = pula chat dos leads; eventos clínicos seguem.
      if (t.slug === DEMO_TENANT_SLUG) {
        // ---- Catálogo de procedimentos do tenant ----
        const procedureRows = await tx
          .insert(procedures)
          .values(DEMO_PROCEDURES.map((p) => ({ ...p, tenantId: tenant.id })))
          .returning();

        // ---- Form template "Anamnese inicial" + perguntas ----
        const [formTpl] = await tx
          .insert(formTemplates)
          .values({ ...DEMO_FORM_TEMPLATE, tenantId: tenant.id })
          .returning();
        if (!formTpl) throw new Error('Falha ao criar form_template demo');

        const questionRows = await tx
          .insert(formQuestions)
          .values(
            DEMO_FORM_QUESTIONS.map((q) => ({
              ...q,
              tenantId: tenant.id,
              formTemplateId: formTpl.id,
            }))
          )
          .returning();

        const demoPlan: Array<{
          stage: typeof DEMO_NON_LEAD_STAGES[number] | 'lead';
          substage: typeof DEMO_LEAD_SUBSTAGES[number] | null;
          // Quando true, a journey é fechada como perdida ao fim do seeding
          // do stage (ver bloco de mark-lost no loop). Só em stage avançado.
          lost?: boolean;
        }> = [];
        for (const stage of DEMO_NON_LEAD_STAGES) {
          for (let i = 0; i < DEMO_STAGE_COUNTS[stage]; i++) {
            demoPlan.push({ stage, substage: null });
          }
        }
        // Perdidas: avaliação realizada, sem fechamento. Stage evaluation pra
        // não aparecer no kanban de leads (que lista todo stage='lead').
        for (let i = 0; i < DEMO_LOST_COUNT; i++) {
          demoPlan.push({ stage: 'evaluation', substage: null, lost: true });
        }
        for (const sub of DEMO_LEAD_SUBSTAGES) {
          const count = demoRandInt(3, 5);
          for (let i = 0; i < count; i++) {
            demoPlan.push({ stage: 'lead', substage: sub });
          }
        }

        // Contador por stage pra alternar variações (`stageIndex % 2`).
        // Evita 2 journeys idênticas no mesmo stage.
        const stageVariant: Record<string, number> = {};

        // Refs das conversas criadas — usadas depois do loop pra ancorar um
        // subconjunto no presente (caixa de entrada viva pro D3 do dashboard).
        const demoConversations: Array<{
          convId: string;
          clientId: string;
          journeyId: string;
          stage: typeof DEMO_NON_LEAD_STAGES[number] | 'lead';
          lastDirection: 'inbound' | 'outbound';
        }> = [];

        for (let i = 0; i < demoPlan.length; i++) {
          const item = demoPlan[i]!;
          // Lost força avaliação realizada (variant 1 = performed) pra render
          // eval agendada + realizada no funil antes de fechar como perdida —
          // sem consumir o contador de variação das journeys ativas.
          const variantIdx = item.lost ? 1 : (stageVariant[item.stage] ?? 0);
          if (!item.lost) stageVariant[item.stage] = variantIdx + 1;

          const name = `${demoPick(DEMO_FIRST_NAMES)} ${demoPick(DEMO_LAST_NAMES)}`;
          // 13 dígitos pós-`+` = padrão BR mobile (+55 11 9XXXX-XXXX). Sequencial
          // pra garantir unicidade dentro do tenant (clients_tenant_phone_unique).
          const phoneE164 = `+551191000${String(1000 + i).padStart(4, '0')}`;

          const [client] = await tx
            .insert(clients)
            .values({
              tenantId: tenant.id,
              name,
              phoneE164,
              isVip: Math.random() < 0.1,
            })
            .returning();
          if (!client) throw new Error('Falha ao criar client demo');

          // Janela temporal — leads (0-30d) vs stages avançados (range
          // dedicado em STAGE_CREATED_RANGE). lastActivity é atualizada
          // depois pelos sub-seeders conforme o último evento clínico.
          const createdRange =
            item.lost
              ? ([16, 38] as const)
              : item.stage === 'lead'
                ? ([0, 30] as const)
                : STAGE_CREATED_RANGE[item.stage];
          const createdDaysAgo = demoRandInt(createdRange[0], createdRange[1]);
          const initialActivityDaysAgo = Math.max(
            0,
            demoRandInt(0, Math.min(30, createdDaysAgo)),
          );
          const journeyCreatedAt = demoDaysAgo(createdDaysAgo);
          let journeyActivityAt = demoDaysAgo(initialActivityDaysAgo);

          const [journey] = await tx
            .insert(journeys)
            .values({
              tenantId: tenant.id,
              clientId: client.id,
              stage: item.stage,
              source: demoPick(DEMO_SOURCES),
              status: 'active',
              leadSubstage: item.substage,
              lastActivityAt: journeyActivityAt,
              createdAt: journeyCreatedAt,
            })
            .returning();
          if (!journey) throw new Error('Falha ao criar journey demo');

          // Evento de auditoria: criação da journey. Audit trail base
          // pra JourneyStripSection renderizar o primeiro dot.
          await tx.insert(journeyEvents).values({
            tenantId: tenant.id,
            journeyId: journey.id,
            eventType: 'journey_created',
            payload: { source: journey.source, stage: journey.stage },
            actorUserId: user.id,
            createdAt: journeyCreatedAt,
          });

          // ---- Sub-seeder de stage avançado (closure sobre tx/tenant/etc) ----
          // Retorna o effectiveLastActivityAt; atualizamos a journey no fim.
          if (item.stage !== 'lead') {
            journeyActivityAt = await seedAdvancedStage({
              stage: item.stage,
              variantIdx,
              journeyId: journey.id,
              clientId: client.id,
              journeyCreatedAt,
            });
          }

          // ---- Fecha journeys perdidas (avaliação realizada, sem venda) ----
          // Perda poucos dias após a avaliação, nunca no futuro. Dá
          // denominador pra conversão lead→venda + motivos de perda (C3).
          if (item.lost) {
            const reason = demoPick(DEMO_LOST_REASONS);
            const lostAt = new Date(
              Math.min(
                Date.now() - 60 * 60 * 1000,
                journeyActivityAt.getTime() +
                  demoRandInt(1, 7) * 24 * 60 * 60 * 1000,
              ),
            );
            await tx
              .update(journeys)
              .set({
                status: 'lost',
                lostReason: reason,
                closedAt: lostAt,
                lastActivityAt: lostAt,
              })
              .where(eq(journeys.id, journey.id));
            await tx.insert(journeyEvents).values({
              tenantId: tenant.id,
              journeyId: journey.id,
              eventType: 'marked_lost',
              payload: { reason },
              actorUserId: user.id,
              createdAt: lostAt,
            });
            journeyActivityAt = lostAt;
          }

          // ---- Chat (só se houver canal mock) ----
          if (chatChannelId) {
            const specs = craftDemoMessages(item.substage);
            if (specs.length > 0) {
              const baseStart = new Date(journeyCreatedAt.getTime() + 60_000);
              const windowMs = Math.max(
                60_000,
                journeyActivityAt.getTime() - baseStart.getTime(),
              );
              const totalSpec = specs[specs.length - 1]!.offsetMin;
              const scale =
                totalSpec > 0
                  ? Math.min(1, windowMs / (totalSpec * 60_000))
                  : 1;

              const [conv] = await tx
                .insert(conversations)
                .values({
                  tenantId: tenant.id,
                  clientId: client.id,
                  whatsappChannelId: chatChannelId,
                  createdAt: baseStart,
                })
                .returning();
              if (!conv) throw new Error('Falha ao criar conversation demo');

              const messageRows = specs.map((s) => {
                const at = new Date(baseStart.getTime() + s.offsetMin * 60_000 * scale);
                return {
                  tenantId: tenant.id,
                  conversationId: conv.id,
                  journeyId: journey.id,
                  direction: s.direction,
                  kind: 'text' as const,
                  body: s.body,
                  authorUserId: s.direction === 'outbound' ? user.id : null,
                  deliveryStatus: 'sent' as const,
                  sentAt: at,
                  createdAt: at,
                };
              });
              await tx.insert(messages).values(messageRows);

              const lastMessageAt = messageRows[messageRows.length - 1]!.createdAt;
              const lastDirection = specs[specs.length - 1]!.direction;
              // Inbound final → conversa não-lida (sem `lastStaffSeenAt`).
              // Outbound final → staff já viu (alinha com `lastMessageAt`).
              await tx
                .update(conversations)
                .set({
                  lastMessageAt,
                  lastStaffSeenAt:
                    lastDirection === 'outbound' ? lastMessageAt : null,
                })
                .where(eq(conversations.id, conv.id));

              demoConversations.push({
                convId: conv.id,
                clientId: client.id,
                journeyId: journey.id,
                stage: item.stage,
                lastDirection,
              });
            }
          }

          // ---- Sincroniza lastActivityAt da journey com o que veio dos
          // sub-seeders (eventos clínicos mais recentes que a atividade inicial).
          if (item.stage !== 'lead') {
            await tx
              .update(journeys)
              .set({ lastActivityAt: journeyActivityAt })
              .where(eq(journeys.id, journey.id));
          }
        }

        // ---- Caixa de entrada "viva" — conversas sem resposta recentes ----
        // O D3 do dashboard ("Conversas sem resposta há >2h") lê a última
        // `messages` inbound por conversa sem outbound posterior. Os
        // timestamps de chat do loop caem dentro da janela da journey — boa
        // parte velha demais pra parecer pendência atual. Aqui ancoramos um
        // punhado no presente: anexamos um follow-up inbound do cliente entre
        // ~3h e ~48h atrás e deixamos `last_staff_seen_at` nulo, simulando uma
        // fila de atendimento real. Prioriza conversas de lead (caixa de
        // entrada típica). Reaproveita clients/journeys já criados.
        if (chatChannelId && demoConversations.length > 0) {
          const leadFirst = [...demoConversations].sort(
            (a, b) =>
              (a.stage === 'lead' ? 0 : 1) - (b.stage === 'lead' ? 0 : 1),
          );
          const targetCount = Math.min(8, leadFirst.length);
          for (let k = 0; k < targetCount; k++) {
            const c = leadFirst[k]!;
            // Recência escalonada: 3 primeiras "de hoje" (~3-8h), demais
            // espalhadas até 48h — todas > 2h, então todas entram no D3.
            const hoursAgo = k < 3 ? demoRandInt(3, 8) : demoRandInt(10, 48);
            const at = demoHoursAgo(hoursAgo);
            await tx.insert(messages).values({
              tenantId: tenant.id,
              conversationId: c.convId,
              journeyId: c.journeyId,
              direction: 'inbound',
              kind: 'text',
              body: demoPick(DEMO_FOLLOWUP_TEXTS),
              authorUserId: null,
              deliveryStatus: 'sent',
              sentAt: at,
              createdAt: at,
            });
            // Inbound recente sem resposta → conversa não-lida (seen nulo).
            await tx
              .update(conversations)
              .set({ lastMessageAt: at, lastStaffSeenAt: null })
              .where(eq(conversations.id, c.convId));
            // Mantém a journey coerente — última atividade = follow-up recente.
            await tx
              .update(journeys)
              .set({ lastActivityAt: at })
              .where(eq(journeys.id, c.journeyId));
          }
        }

        // ---- Sub-seeder de stages avançados ----
        // Closure sobre tx/tenant/user/unit/procedureRows/formTpl/questionRows.
        // Retorna o `lastActivityAt` resultante (timestamp do evento clínico
        // mais recente). Caller atualiza a journey.
        async function seedAdvancedStage(args: {
          stage: 'evaluation' | 'sale' | 'treatment' | 'result';
          variantIdx: number;
          journeyId: string;
          clientId: string;
          journeyCreatedAt: Date;
        }): Promise<Date> {
          const { stage, variantIdx, journeyId, clientId, journeyCreatedAt } = args;
          const tenantId = tenant.id;
          const unitId = unit.id;
          const performerId = user.id;
          const procPool = procedureRows;
          const formTplId = formTpl!.id;
          const questions = questionRows;

          // Audit do `stage_changed` lead → evaluation (anchor temporal pra
          // ordem dos eventos seguintes). Acontece logo após journey_created.
          const stageChangedAt = new Date(
            journeyCreatedAt.getTime() + demoRandInt(1, 5) * 24 * 60 * 60 * 1000,
          );
          await tx.insert(journeyEvents).values({
            tenantId,
            journeyId,
            eventType: 'stage_changed',
            payload: { from: 'lead', to: 'evaluation' },
            actorUserId: performerId,
            createdAt: stageChangedAt,
          });

          // ---- evaluation (variante 0 = pendente futuro, variante 1 = realizada) ----
          const isPendingEval = stage === 'evaluation' && variantIdx === 0;
          // Realizada: clampa no passado (created recente + offset poderia
          // cair logo após agora — avaliação 'performed' nunca no futuro).
          const evalScheduledAt = isPendingEval
            ? demoDaysFromNow(demoRandInt(1, 14))
            : new Date(
                Math.min(
                  Date.now() - 60 * 60 * 1000,
                  stageChangedAt.getTime() + demoRandInt(2, 10) * 24 * 60 * 60 * 1000,
                ),
              );

          const [evaluation] = await tx
            .insert(evaluations)
            .values({
              tenantId,
              journeyId,
              clientId,
              kind: 'initial',
              status: isPendingEval ? 'pending' : 'performed',
              performedAt: isPendingEval ? null : evalScheduledAt,
              performedByUserId: isPendingEval ? null : performerId,
              generalNotes: isPendingEval
                ? null
                : 'Cliente compareceu. Pele tipo III, sem contraindicações.',
              createdAt: stageChangedAt,
            })
            .returning();
          if (!evaluation) throw new Error('Falha ao criar evaluation demo');

          await tx.insert(appointments).values({
            tenantId,
            journeyId,
            clientId,
            kind: 'evaluation',
            evaluationId: evaluation.id,
            professionalId: performerId,
            unitId,
            scheduledAt: evalScheduledAt,
            durationMinutes: 30,
            status: isPendingEval ? 'scheduled' : 'attended',
            createdAt: stageChangedAt,
          });

          // Pra pending, a "última atividade" foi quando o staff agendou
          // (stageChangedAt), não a data futura do appointment.
          let lastEventAt = isPendingEval ? stageChangedAt : evalScheduledAt;

          // Ficha de avaliação preenchida quando evaluation está performed.
          if (!isPendingEval) {
            const [cliForm] = await tx
              .insert(clientForms)
              .values({
                tenantId,
                evaluationId: evaluation.id,
                clientId,
                formTemplateId: formTplId,
                status: 'completed',
                filledAt: evalScheduledAt,
                completedByUserId: performerId,
                createdAt: evalScheduledAt,
              })
              .returning();
            if (!cliForm) throw new Error('Falha ao criar client_form demo');

            // 1 resposta por pergunta, populando a coluna tipada apropriada.
            const answerRows = questions.map((q) => {
              const base = {
                tenantId,
                clientFormId: cliForm.id,
                questionId: q.id,
                answeredAt: evalScheduledAt,
                createdAt: evalScheduledAt,
                answerText: null as string | null,
                answerOption: null as string | null,
                answerBoolean: null as boolean | null,
                answerNumber: null as string | null,
                answerDate: null as string | null,
              };
              switch (q.questionType) {
                case 'yes_no':
                  return { ...base, answerBoolean: Math.random() < 0.4 };
                case 'text':
                  return { ...base, answerText: 'Sem ocorrências relevantes.' };
                case 'multiple_choice':
                  return { ...base, answerOption: 'III' };
                case 'scale':
                  return { ...base, answerNumber: String(demoRandInt(2, 7)) };
                case 'number':
                  return { ...base, answerNumber: String(demoRandInt(20, 60)) };
                case 'date':
                  return {
                    ...base,
                    answerDate: demoDaysAgo(demoRandInt(30, 180))
                      .toISOString()
                      .slice(0, 10),
                  };
                default:
                  return base;
              }
            });
            await tx.insert(formAnswers).values(answerRows);

            await tx.insert(journeyEvents).values({
              tenantId,
              journeyId,
              eventType: 'evaluation_performed',
              payload: { evaluationId: evaluation.id },
              actorUserId: performerId,
              createdAt: evalScheduledAt,
            });
          }

          if (stage === 'evaluation') return lastEventAt;

          // ---- sale (quote enviado → aceito vira venda fechada) ----
          // Stages 'treatment'/'result' sempre aceitam (já estão além da
          // venda). No stage 'sale', ~2/3 aceitam (fecham venda → linha de
          // Vendas R$/qtd + ticket) e ~1/3 fica em 'sent' (orçamento sem
          // resposta → degrau quote_sent > sale_closed no funil).
          const quoteCreatedAt = new Date(
            evalScheduledAt.getTime() + demoRandInt(1, 3) * 24 * 60 * 60 * 1000,
          );
          const quoteIsAccepted = stage !== 'sale' || variantIdx % 3 !== 0;
          const quoteSentAt = quoteCreatedAt;
          const quoteAcceptedAt = quoteIsAccepted
            ? new Date(
                quoteSentAt.getTime() + demoRandInt(1, 5) * 24 * 60 * 60 * 1000,
              )
            : null;

          // 1-2 procedimentos por quote. quantitySessions usa o default do procedure.
          const chosenProcs = [
            procPool[demoRandInt(0, procPool.length - 1)]!,
          ];
          if (Math.random() < 0.5) {
            const second = procPool[demoRandInt(0, procPool.length - 1)]!;
            if (second.id !== chosenProcs[0]!.id) chosenProcs.push(second);
          }
          const totalAmount = chosenProcs.reduce(
            (sum, p) =>
              sum + Number(p.defaultPrice ?? '0') * (p.defaultSessions ?? 1),
            0,
          );

          const [quote] = await tx
            .insert(quotes)
            .values({
              tenantId,
              journeyId,
              origin: 'evaluation',
              totalAmount: totalAmount.toFixed(2),
              discountAmount: '0',
              status: quoteIsAccepted ? 'accepted' : 'sent',
              validUntil: demoDaysFromNow(30),
              createdByUserId: performerId,
              sentAt: quoteSentAt,
              acceptedAt: quoteAcceptedAt,
              createdAt: quoteCreatedAt,
            })
            .returning();
          if (!quote) throw new Error('Falha ao criar quote demo');

          const insertedQuoteItems = await tx
            .insert(quoteItems)
            .values(
              chosenProcs.map((p) => ({
                tenantId,
                quoteId: quote.id,
                procedureId: p.id,
                quantitySessions: p.defaultSessions ?? 1,
                unitPrice: p.defaultPrice ?? '0',
                discountPct: '0',
              }))
            )
            .returning({
              id: quoteItems.id,
              procedureId: quoteItems.procedureId,
              unitPrice: quoteItems.unitPrice,
              quantitySessions: quoteItems.quantitySessions,
              discountPct: quoteItems.discountPct,
            });

          // stage_changed evaluation→sale ancora a transição na criação do quote.
          await tx.insert(journeyEvents).values([
            {
              tenantId,
              journeyId,
              eventType: 'stage_changed',
              payload: { from: 'evaluation', to: 'sale' },
              actorUserId: performerId,
              createdAt: quoteCreatedAt,
            },
            {
              tenantId,
              journeyId,
              eventType: 'quote_sent',
              payload: { quoteId: quote.id, total: quote.totalAmount },
              actorUserId: performerId,
              createdAt: quoteSentAt,
            },
          ]);
          lastEventAt = quoteSentAt;

          // Map procedureId → saleItemId, populado quando há sale fechada.
          // Usado pelo bloco de treatment pra linkar procedure_sessions ao
          // sale_item correspondente. Vazio quando quote ainda em sent.
          const procToSaleItemId = new Map<string, string>();

          if (quoteIsAccepted && quoteAcceptedAt) {
            // ---- sale (fechamento de venda) ----
            // Demo cria 1 sale por quote accepted com TODOS os items
            // (sem item "perdido"). Parcelas variam por perfil pra exibir
            // diversidade: à vista, 2x/3x cartão, com mix de paid/pending
            // e ocasional parcela vencida.
            const [sale] = await tx
              .insert(sales)
              .values({
                tenantId,
                quoteId: quote.id,
                journeyId,
                clientId,
                subtotalAmount: totalAmount.toFixed(2),
                discountAmount: '0',
                totalAmount: totalAmount.toFixed(2),
                paidAmount: '0',
                status: 'open',
                closedAt: quoteAcceptedAt,
                closedByUserId: performerId,
                createdAt: quoteAcceptedAt,
              })
              .returning();
            if (!sale) throw new Error('Falha ao criar sale demo');

            const insertedSaleItems = await tx
              .insert(saleItems)
              .values(
                insertedQuoteItems.map((qi) => {
                  const unitC = Math.round(Number(qi.unitPrice) * 100);
                  const pct = Number(qi.discountPct);
                  const lineCents = Math.round(
                    unitC * qi.quantitySessions * (1 - pct / 100)
                  );
                  return {
                    tenantId,
                    saleId: sale.id,
                    quoteItemId: qi.id,
                    procedureId: qi.procedureId,
                    quantitySessions: qi.quantitySessions,
                    unitPrice: qi.unitPrice,
                    discountPct: qi.discountPct,
                    computedAmount: (lineCents / 100).toFixed(2),
                    createdAt: quoteAcceptedAt,
                  };
                })
              )
              .returning({
                id: saleItems.id,
                procedureId: saleItems.procedureId,
              });

            for (const si of insertedSaleItems) {
              procToSaleItemId.set(si.procedureId, si.id);
            }

            // ---- Perfil de parcelas (5 buckets pra variabilidade) ----
            // Cada bucket descreve [método, dueOffsetDias, status, paidAtOffsetDias?]
            // dueOffset/paidAtOffset são relativos ao quoteAcceptedAt.
            type InstallmentSpec = {
              method: 'pix' | 'credit_card' | 'debit_card' | 'cash';
              dueOffset: number;
              status: 'pending' | 'paid';
              paidAtOffset?: number;
            };
            const profileRoll = Math.random();
            let installmentSpecs: InstallmentSpec[];
            if (profileRoll < 0.35) {
              // À vista PIX
              installmentSpecs = [
                { method: 'pix', dueOffset: 0, status: 'paid', paidAtOffset: 0 },
              ];
            } else if (profileRoll < 0.55) {
              // 2x cartão, ambas pagas (venda antiga quitada)
              installmentSpecs = [
                { method: 'credit_card', dueOffset: 0, status: 'paid', paidAtOffset: 0 },
                { method: 'credit_card', dueOffset: 30, status: 'paid', paidAtOffset: 30 },
              ];
            } else if (profileRoll < 0.75) {
              // 2x cartão: primeira paga, segunda pendente
              installmentSpecs = [
                { method: 'credit_card', dueOffset: 0, status: 'paid', paidAtOffset: 0 },
                { method: 'credit_card', dueOffset: 30, status: 'pending' },
              ];
            } else if (profileRoll < 0.92) {
              // 3x cartão: primeira paga, restante pendente
              installmentSpecs = [
                { method: 'credit_card', dueOffset: 0, status: 'paid', paidAtOffset: 0 },
                { method: 'credit_card', dueOffset: 30, status: 'pending' },
                { method: 'credit_card', dueOffset: 60, status: 'pending' },
              ];
            } else {
              // Atraso real: 1ª paga, 2ª vencida (due no passado, ainda pending)
              installmentSpecs = [
                { method: 'credit_card', dueOffset: 0, status: 'paid', paidAtOffset: 0 },
                { method: 'credit_card', dueOffset: 30, status: 'pending' },
                { method: 'credit_card', dueOffset: 60, status: 'pending' },
              ];
            }

            // Distribui valor total em centavos pra evitar drift (primeira
            // parcela absorve o resto da divisão).
            const totalCents = Math.round(totalAmount * 100);
            const nInst = installmentSpecs.length;
            const baseCents = Math.floor(totalCents / nInst);
            const remainderCents = totalCents - baseCents * nInst;
            const amountsCents = installmentSpecs.map((_, i) =>
              i === 0 ? baseCents + remainderCents : baseCents
            );

            let paidCents = 0;
            const oneDayMs = 24 * 60 * 60 * 1000;
            const isoDate = (d: Date): string => {
              const pad = (n: number) => n.toString().padStart(2, '0');
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            };

            await tx.insert(payments).values(
              installmentSpecs.map((spec, i) => {
                const due = new Date(
                  quoteAcceptedAt.getTime() + spec.dueOffset * oneDayMs
                );
                const paidAt =
                  spec.paidAtOffset !== undefined
                    ? new Date(
                        quoteAcceptedAt.getTime() + spec.paidAtOffset * oneDayMs
                      )
                    : null;
                if (spec.status === 'paid') paidCents += amountsCents[i]!;
                return {
                  tenantId,
                  saleId: sale.id,
                  installmentNumber: i + 1,
                  totalInstallments: nInst,
                  amount: (amountsCents[i]! / 100).toFixed(2),
                  paymentMethod: spec.method,
                  dueDate: isoDate(due),
                  paidAt,
                  status: spec.status,
                  createdAt: quoteAcceptedAt,
                };
              })
            );

            // Atualiza paid_amount/status da sale (recomputado conforme as
            // parcelas geradas). `paid` quando todas parcelas pagas.
            const saleStatus: 'open' | 'paid' =
              paidCents >= totalCents ? 'paid' : 'open';
            await tx
              .update(sales)
              .set({
                paidAmount: (paidCents / 100).toFixed(2),
                status: saleStatus,
              })
              .where(eq(sales.id, sale.id));

            await tx.insert(journeyEvents).values({
              tenantId,
              journeyId,
              eventType: 'sale_closed',
              payload: {
                quoteId: quote.id,
                saleId: sale.id,
                totalAmount: totalAmount.toFixed(2),
                installments: nInst,
              },
              actorUserId: performerId,
              createdAt: quoteAcceptedAt,
            });
            lastEventAt = quoteAcceptedAt;
          }

          if (stage === 'sale') return lastEventAt;

          // ---- treatment / result ----
          // Stage treatment: progresso parcial (40-70% das sessions done).
          // Stage result: todas done + treatment.completed.
          const treatmentStartedAt = new Date(
            quoteAcceptedAt!.getTime() + demoRandInt(1, 7) * 24 * 60 * 60 * 1000,
          );
          const isCompleted = stage === 'result';

          // Cria 1 treatment por journey agrupando todas as sessions.
          const [treatment] = await tx
            .insert(treatments)
            .values({
              tenantId,
              journeyId,
              clientId,
              name: chosenProcs.map((p) => p.name).join(' + '),
              status: isCompleted ? 'completed' : 'active',
              startedAt: treatmentStartedAt,
              completedAt: null, // setado depois quando todas sessions feitas
              createdAt: treatmentStartedAt,
            })
            .returning();
          if (!treatment) throw new Error('Falha ao criar treatment demo');

          await tx.insert(journeyEvents).values([
            {
              tenantId,
              journeyId,
              eventType: 'stage_changed',
              payload: { from: 'sale', to: 'treatment' },
              actorUserId: performerId,
              createdAt: treatmentStartedAt,
            },
            {
              tenantId,
              journeyId,
              eventType: 'treatment_started',
              payload: { treatmentId: treatment.id },
              actorUserId: performerId,
              createdAt: treatmentStartedAt,
            },
          ]);

          // Cria procedure_sessions baseado nos quote_items. Cada item gera
          // `quantitySessions` sessões. Limita o total a no máx 8 sessões pra
          // evitar dados infláveis em treatments grandes (depilação tem 8/10
          // por região, multiplicado por 2 procedures vira muito).
          const sessionSpecs: Array<{ procedureId: string }> = [];
          for (const p of chosenProcs) {
            const n = Math.min(p.defaultSessions ?? 1, 6);
            for (let s = 0; s < n; s++) {
              sessionSpecs.push({ procedureId: p.id });
            }
          }
          const cappedSpecs = sessionSpecs.slice(0, 8);

          // Spacing entre sessões: ~21 dias (cadência típica de laser).
          const SESSION_GAP_DAYS = 21;
          const doneCount = isCompleted
            ? cappedSpecs.length
            : Math.max(
                1,
                Math.floor(cappedSpecs.length * (0.4 + Math.random() * 0.3)),
              );

          let lastSessionEvent = treatmentStartedAt;

          for (let s = 0; s < cappedSpecs.length; s++) {
            const scheduledAt = new Date(
              treatmentStartedAt.getTime() +
                s * SESSION_GAP_DAYS * 24 * 60 * 60 * 1000,
            );
            // Só 'done' se a sessão já passou — em treatment recente as
            // sessões futuras da cadência ficam 'pending'/'scheduled' (nunca
            // uma sessão realizada com data no futuro).
            const isDone = s < doneCount && scheduledAt.getTime() < Date.now();

            const procId = cappedSpecs[s]!.procedureId;
            const [procSession] = await tx
              .insert(procedureSessions)
              .values({
                tenantId,
                clientId,
                procedureId: procId,
                saleItemId: procToSaleItemId.get(procId) ?? null,
                status: isDone ? 'done' : 'pending',
                executedAt: isDone ? scheduledAt : null,
                executedByUserId: isDone ? performerId : null,
                evolutionNotes: isDone
                  ? 'Sessão realizada sem intercorrências.'
                  : null,
                createdAt: treatmentStartedAt,
              })
              .returning();
            if (!procSession) throw new Error('Falha ao criar procedure_session demo');

            await tx.insert(treatmentProcedures).values({
              tenantId,
              treatmentId: treatment.id,
              procedureSessionId: procSession.id,
            });

            await tx.insert(appointments).values({
              tenantId,
              journeyId,
              clientId,
              kind: 'procedure',
              procedureSessionId: procSession.id,
              professionalId: performerId,
              unitId,
              scheduledAt,
              durationMinutes: 30,
              status: isDone ? 'attended' : 'scheduled',
              createdAt: treatmentStartedAt,
            });

            if (isDone) {
              await tx.insert(journeyEvents).values({
                tenantId,
                journeyId,
                eventType: 'session_done',
                payload: {
                  sessionId: procSession.id,
                  procedureId: procSession.procedureId,
                },
                actorUserId: performerId,
                createdAt: scheduledAt,
              });
              lastSessionEvent = scheduledAt;
            }
          }
          lastEventAt = lastSessionEvent;

          if (isCompleted) {
            const completedAt = new Date(
              lastSessionEvent.getTime() + 2 * 24 * 60 * 60 * 1000,
            );
            await tx
              .update(treatments)
              .set({ status: 'completed', completedAt })
              .where(eq(treatments.id, treatment.id));

            await tx.insert(journeyEvents).values([
              {
                tenantId,
                journeyId,
                eventType: 'treatment_completed',
                payload: { treatmentId: treatment.id },
                actorUserId: performerId,
                createdAt: completedAt,
              },
              {
                tenantId,
                journeyId,
                eventType: 'stage_changed',
                payload: { from: 'treatment', to: 'result' },
                actorUserId: performerId,
                createdAt: completedAt,
              },
            ]);

            // Tratamento concluído → journey ganha. won ⟺ stage=result
            // (invariante de markJourneyWon, stageTransition.ts). closed_at na
            // conclusão alimenta conversão + ciclo lead→venda do dashboard.
            await tx
              .update(journeys)
              .set({
                status: 'won',
                closedAt: completedAt,
                lastActivityAt: completedAt,
              })
              .where(eq(journeys.id, journeyId));
            await tx.insert(journeyEvents).values({
              tenantId,
              journeyId,
              eventType: 'marked_won',
              actorUserId: performerId,
              createdAt: completedAt,
            });
            lastEventAt = completedAt;
          }

          return lastEventAt;
        }
      }
    });
  }

  // ---- Restaurar canais reais preservados (os não tratados inline) ----
  // Roda depois que todos os tenants foram (re)criados — usamos slug como
  // chave estável pra mapear pro novo tenantId. Tenants do loop de seed já
  // tiveram o canal restaurado dentro da transação (restoredInlineSlugs);
  // aqui sobra restaurar os demais (ex: tenant `main`, que não passa pelo
  // loop). Canais cujo slug não existe mais no seed são descartados com aviso.
  if (preservedChannels.length > 0) {
    const allTenants = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants);
    const slugToId = new Map(allTenants.map((t) => [t.slug, t.id]));

    for (const ch of preservedChannels) {
      if (restoredInlineSlugs.has(ch.tenantSlug)) continue;
      const tenantId = slugToId.get(ch.tenantSlug);
      if (!tenantId) {
        console.warn(
          `Canal preservado descartado — tenant '${ch.tenantSlug}' não foi recriado.`,
        );
        continue;
      }
      const [restored] = await db
        .insert(whatsappChannels)
        .values({
          // UUID preservado pra o webhook URL gravado no Evolution
          // continuar válido (ver comentário do snapshot acima).
          id: ch.id,
          tenantId,
          name: ch.name,
          providerType: ch.providerType,
          providerConfig: ch.providerConfig,
          phoneNumber: ch.phoneNumber,
          active: ch.active,
        })
        .returning();
      if (restored) {
        restoredChannels.push({
          tenantSlug: ch.tenantSlug,
          channelId: restored.id,
          channelName: restored.name,
        });
      }
    }
  }

  const passwordHint =
    process.env.NODE_ENV === 'production' ? '<senha fornecida pelo dono>' : 'senha123';
  console.log('Seeds:');
  console.log(`  - ${PLATFORM_SLUG} (admin@elora.app.br / ${passwordHint})  ← equipe Elora`);
  tenantsToSeed.forEach((t) =>
    console.log(`  - ${t.slug} (admin@${t.slug}.test / ${passwordHint})`)
  );
  if (seededChannels.length > 0) {
    console.log('\nCanais WhatsApp Mock (use no webhook):');
    seededChannels.forEach((c) => {
      console.log(`  - ${c.tenantSlug}: ${c.channelId}`);
      console.log(
        `    POST http://localhost:5502/webhook/whatsapp/${c.channelId}`
      );
    });
  }
  if (restoredChannels.length > 0) {
    console.log('\nCanais reais preservados (pareação Evolution mantida):');
    restoredChannels.forEach((c) => {
      console.log(`  - ${c.tenantSlug}: ${c.channelName} (${c.channelId})`);
    });
  }
  console.log(
    `\nPayload de teste (inbound message):\n  {"kind":"message_received","from":"+5511988887777","profileName":"Maria","text":"oi, gostaria de info"}`
  );
}

seed()
  .catch((err) => {
    console.error('Erro ao executar seed:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
