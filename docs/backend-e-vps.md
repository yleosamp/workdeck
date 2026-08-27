# Backend local e publicação em VPS

## Configuração simples

Todos os dados que você precisa trocar ficam no arquivo `.env`, na raiz do projeto. Ele é privado e está ignorado pelo Git.

Campos do banco:

- `MYSQL_HOST`: endereço do MySQL
- `MYSQL_PORT`: normalmente `3306`
- `MYSQL_USER`: usuário do banco
- `MYSQL_PASSWORD`: senha do banco
- `MYSQL_DATABASE`: nome do banco, normalmente `workdeck`

Campos do servidor:

- `JWT_SECRET`: chave aleatória longa usada para assinar sessões
- `API_HOST`: endereço no qual a API escuta
- `API_PORT`: porta da API
- `PUBLIC_API_URL`: endereço público final, sem barra no fim
- `CLIENT_ORIGINS`: origens permitidas, separadas por vírgula
- `RELEASES_DIR`: pasta dos instaladores quando a própria VPS hospeda as atualizações
- `UPDATE_MANIFEST_URL`: URL opcional do `latest.json` publicado pelo GitHub
- `TURN_URLS`: URLs do relay TURN separadas por vírgula (opcional, recomendado para chamadas e P2P fora da rede local)
- `TURN_SECRET`: segredo compartilhado com o relay TURN (opcional; nunca publique este valor)

O `.env.example` é um modelo seguro. Nunca envie o `.env` real nem coloque sua senha dentro do instalador.

## Rodar localmente

Com o MySQL em execução, dê dois cliques em `INICIAR_WORKDECK_LOCAL.cmd`. O atalho:

1. compila o backend na primeira vez, se necessário;
2. inicia a API oculta em `http://127.0.0.1:8787`;
3. espera o servidor responder;
4. abre o Workdeck instalado.

Use `PARAR_BACKEND_LOCAL.cmd` para parar a API iniciada pelo atalho. Fechar somente a janela do Workdeck não encerra o backend.

## Preparar o MySQL da VPS

Em produção, crie um usuário exclusivo em vez de usar `root`. Um exemplo para executar no MySQL da VPS, trocando a senha antes:

```sql
CREATE DATABASE workdeck CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'workdeck'@'127.0.0.1' IDENTIFIED BY 'COLOQUE_UMA_SENHA_FORTE_AQUI';
GRANT ALL PRIVILEGES ON workdeck.* TO 'workdeck'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Não exponha a porta 3306 à internet. A API e o MySQL podem conversar pela rede privada ou pelo localhost da VPS.

## Publicar a API na VPS

Instale Node.js 22 LTS, copie o projeto e execute:

```bash
npm ci
npm run build:api
```

Crie o `.env` da VPS a partir do `.env.example`. As mudanças principais serão semelhantes a:

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=workdeck
MYSQL_PASSWORD=UMA_SENHA_FORTE
MYSQL_DATABASE=workdeck
JWT_SECRET=UMA_CHAVE_ALEATORIA_COM_PELO_MENOS_64_CARACTERES
API_HOST=127.0.0.1
API_PORT=8787
PUBLIC_API_URL=https://api.seudominio.com
CLIENT_ORIGINS=tauri://localhost,http://tauri.localhost
RELEASES_DIR=./releases
UPDATE_MANIFEST_URL=https://github.com/SEU_USUARIO/SEU_REPOSITORIO/releases/latest/download/latest.json
TURN_URLS=turn:IP_DA_VPS:3478?transport=udp,turn:IP_DA_VPS:3478?transport=tcp
TURN_SECRET=UMA_CHAVE_LONGA_E_ALEATORIA
```

Manter `API_HOST=127.0.0.1` é mais seguro quando Caddy ou Nginx está na mesma VPS e faz o proxy. Se o backend estiver em outro contêiner ou máquina, ajuste para a rede privada apropriada.

Para manter o processo ativo com PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

O repositório também inclui um `Dockerfile` para implantação em contêiner. Passe as variáveis do `.env` pela ferramenta da hospedagem; não copie o arquivo secreto para a imagem.

## HTTPS e WebSocket

Use Caddy, Nginx ou o proxy da hospedagem na frente da porta 8787. Ele precisa:

- emitir HTTPS válido;
- encaminhar requisições para `127.0.0.1:8787`;
- permitir upgrade de WebSocket na rota `/realtime`;
- liberar apenas portas 80 e 443 no firewall público.

Após publicar, abra o Workdeck, expanda **Configuração do servidor** na tela de login e informe `https://api.seudominio.com`. Essa preferência é salva no computador, então o mesmo instalador funciona localmente e na VPS.

Os links de perfil passam a ser `https://api.seudominio.com/p/nome_do_usuario`.

A rota pública `/updates` entrega somente o manifesto e os instaladores assinados. Se usar o GitHub Releases, o backend lê `UPDATE_MANIFEST_URL`; se deixar essa variável vazia, ele serve os arquivos de `RELEASES_DIR`. Veja [Atualizações automáticas e macOS](atualizacoes-e-macos.md).

O perfil público mostra os últimos 12 meses, o programa atual quando a presença está configurada como **Everyone with my link**, descrição, foto e banner. A aba **Studios** usa as mesmas sessões para comunidades, canais de texto/voz, chamadas P2P e compartilhamento de tela.

## Antes de convidar muita gente

- Configure backup diário do MySQL e teste a restauração.
- Troque imediatamente a senha provisória e o `JWT_SECRET`.
- Use um serviço de e-mail para recuperação de conta.
- Execute `scripts/configurar-turn-vps.sh` na VPS para instalar e manter o relay TURN em uma `screen` chamada `workdeck-turn`. O script abre somente `3478` e `49160-49200` no firewalld e não altera outros serviços.
- Coloque monitoramento, limite de armazenamento de mensagens e política de privacidade.
- Para várias cópias da API, adicione Redis para distribuir presença e eventos WebSocket.
