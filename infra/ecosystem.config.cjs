// PM2 ecosystem pra PRODUCAO. Subir com:
//   pm2 start /srv/elora/repo/infra/ecosystem.config.cjs
//   pm2 save
//
// NOTA: arquivo precisa terminar em '.config.cjs' (ou .config.js) pra PM2
// reconhecer como ecosystem. Senao, ele trata como app comum e tenta rodar
// o arquivo inteiro como processo Node.
//
// Reload zero-downtime (apos rebuild):
//   cd /srv/elora/repo && git pull && pnpm install --frozen-lockfile && pnpm build
//   pm2 reload all
//
// PM2 cria service systemd 'pm2-elora.service' (configurado na Fase 2) que
// sobe esses apps no boot. Lista de processos persistida via 'pm2 save'.

module.exports = {
  apps: [
    {
      name: 'elora-core',
      cwd: '/srv/elora/repo/apps/core',
      script: 'dist/server.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      // Em cluster mode socket.io exige sticky sessions; fork e mais simples
      // e 1 vCPU sobra pra atender o trafego inicial. Migrar pra cluster
      // quando trafego justificar (precisa nginx ip_hash ou redis adapter).

      // PM2 mata o processo e reinicia se passar disso. Deixa folga pros
      // outros (chat 450M, agent 350M, evolution 800M, postgres 1G, redis 256M).
      max_memory_restart: '450M',

      env: {
        NODE_ENV: 'production',
      },

      error_file: '/srv/elora/logs/core-error.log',
      out_file: '/srv/elora/logs/core-out.log',
      merge_logs: true,
      time: true,
    },

    {
      name: 'elora-chat',
      cwd: '/srv/elora/repo/apps/chat',
      script: 'dist/server.js',
      interpreter: 'node',
      exec_mode: 'fork',
      // SINGLETON obrigatorio: BullMQ workers, locks de conversa (Redis SETNX)
      // e estado de instancias Baileys/Evolution nao toleram replicacao.
      instances: 1,
      max_memory_restart: '450M',

      env: {
        NODE_ENV: 'production',
      },

      error_file: '/srv/elora/logs/chat-error.log',
      out_file: '/srv/elora/logs/chat-out.log',
      merge_logs: true,
      time: true,
    },

    {
      name: 'elora-agent',
      cwd: '/srv/elora/repo/apps/agent',
      script: 'dist/server.js',
      interpreter: 'node',
      exec_mode: 'fork',
      // SINGLETON obrigatorio: BullMQ worker de triggers + InboundSubscriber
      // (Redis pub/sub) nao toleram replicacao — 2 instancias = 2 respostas
      // do agente pra mesma mensagem.
      instances: 1,
      // Menor que core/chat: agente e I/O bound (aguarda API Anthropic),
      // payloads pequenos, sem socket.io nem upload de midia.
      max_memory_restart: '350M',

      env: {
        NODE_ENV: 'production',
      },

      error_file: '/srv/elora/logs/agent-error.log',
      out_file: '/srv/elora/logs/agent-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
