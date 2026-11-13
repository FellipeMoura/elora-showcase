# Configuração Nginx — produção

Arquivos versionados pra reverse proxy + TLS termination da VPS.

## Estrutura

```
infra/nginx/
├── conf.d/
│   └── websocket-upgrade.conf      ← map $connection_upgrade (escopo http)
└── sites/
    ├── http-redirect.conf           ← :80 -> :443
    ├── elora-frontend.conf          ← elora.app.br + *.elora.app.br + www
    ├── elora-api.conf               ← api.elora.app.br -> :5501
    ├── elora-chat.conf              ← chat.elora.app.br -> :5502
    └── elora-evolution.conf         ← evolution.elora.app.br -> :5503
```

## Instalação na VPS

```bash
cd /srv/elora/repo

# 1. Symlinks pros configs (mudar no repo + reload = update direto)
sudo ln -sf /srv/elora/repo/infra/nginx/conf.d/websocket-upgrade.conf /etc/nginx/conf.d/websocket-upgrade.conf

sudo ln -sf /srv/elora/repo/infra/nginx/sites/http-redirect.conf      /etc/nginx/sites-available/elora-http-redirect.conf
sudo ln -sf /srv/elora/repo/infra/nginx/sites/elora-frontend.conf     /etc/nginx/sites-available/elora-frontend.conf
sudo ln -sf /srv/elora/repo/infra/nginx/sites/elora-api.conf          /etc/nginx/sites-available/elora-api.conf
sudo ln -sf /srv/elora/repo/infra/nginx/sites/elora-chat.conf         /etc/nginx/sites-available/elora-chat.conf
sudo ln -sf /srv/elora/repo/infra/nginx/sites/elora-evolution.conf    /etc/nginx/sites-available/elora-evolution.conf

# 2. Habilita (symlinks de sites-available -> sites-enabled)
sudo ln -sf /etc/nginx/sites-available/elora-http-redirect.conf       /etc/nginx/sites-enabled/elora-http-redirect.conf
sudo ln -sf /etc/nginx/sites-available/elora-frontend.conf            /etc/nginx/sites-enabled/elora-frontend.conf
sudo ln -sf /etc/nginx/sites-available/elora-api.conf                 /etc/nginx/sites-enabled/elora-api.conf
sudo ln -sf /etc/nginx/sites-available/elora-chat.conf                /etc/nginx/sites-enabled/elora-chat.conf
sudo ln -sf /etc/nginx/sites-available/elora-evolution.conf           /etc/nginx/sites-enabled/elora-evolution.conf

# 3. Remove o site default (pagina padrao "Welcome to nginx!")
sudo rm -f /etc/nginx/sites-enabled/default

# 4. Permissao de leitura do Nginx no /srv/elora/repo/apps/frontend/dist
sudo chmod o+x /srv/elora /srv/elora/repo /srv/elora/repo/apps /srv/elora/repo/apps/frontend
sudo chmod -R o+rX /srv/elora/repo/apps/frontend/dist

# 5. Testa config (n = noeval)
sudo nginx -t

# 6. Reload (sem downtime, valida antes de aplicar)
sudo systemctl reload nginx
```

## Atualização de configs

Mudou algo em `infra/nginx/`? `git pull` + `sudo nginx -t` + `sudo systemctl reload nginx`. Symlinks já apontam pro repo, mudança é automática.

## Logs

Cada server block escreve logs separados em `/var/log/nginx/elora-*.{access,error}.log`. Pra acompanhar:

```bash
sudo tail -f /var/log/nginx/elora-api.error.log
sudo tail -f /var/log/nginx/elora-frontend.access.log
```
