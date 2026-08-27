# Arquitetura do Workdeck

## Visão geral

O projeto separa o rastreador desktop do serviço social. Isso preserva a privacidade, evita enviar uma lista de processos para a internet e facilita portar o cliente para Linux e macOS.

```text
Programas profissionais
    │ somente correspondência local do nome do processo
    ▼
Rastreador Rust
    ├── SQLite: total e histórico diário por programa
    └── Tauri + React
            │ totais, presença e atividade autorizada
            ▼
      API Fastify + MySQL
       ├── contas, sessões e privacidade
       ├── amigos, bloqueios, perfis públicos e rankings privados
       ├── chat e confirmações de leitura
       └── WebSocket: presença + sinalização WebRTC
                              │
                  arquivos P2P entre os computadores
```

## Cliente desktop

O rastreador consulta os processos a cada 15 segundos. Cada intervalo é limitado a 60 segundos para impedir que suspensão ou hibernação conte horas incorretas. Ele reconhece aliases de executáveis e permite cadastrar programas personalizados.

O SQLite local contém:

- `app_catalog`: programas, aparência e aliases de processo
- `app_totals`: total acumulado e última abertura por programa
- `daily_activity`: segundos por data e por programa

O banco fica na pasta de dados do usuário do Windows ou macOS. O rastreador nativo continua atualizando esse banco a cada 15 segundos mesmo quando a janela está escondida na bandeja/barra de menus. O aplicativo envia ao servidor somente as estatísticas exibidas no perfil e o programa atualmente ativo.

## Backend

A API TypeScript usa Fastify, MySQL 8 e WebSocket. Na inicialização, cria o banco configurado e aplica as tabelas idempotentes. A configuração fica inteiramente no `.env`.

Principais tabelas:

- `users` e `sessions`
- `friend_requests`, `friendships` e `blocks`
- `presence`
- `messages`
- `activity_totals` e `activity_daily`

As senhas recebem hash Argon2id. O token de acesso dura 15 minutos; o token de renovação dura 30 dias, é rotacionado e somente seu hash é salvo. Operações sociais verificam amizade e bloqueio no servidor. A API limita requisições e valida todos os corpos e parâmetros.

Foto e banner são reduzidos no cliente para WebP e armazenados como imagens embutidas no perfil nesta fase inicial. Para uma comunidade grande, esses dois campos devem migrar para armazenamento de objetos, como S3 ou R2, mantendo apenas as URLs no MySQL.

Presença, novas mensagens, leitura, digitação e sinais WebRTC trafegam pela conexão WebSocket autenticada. A presença vira offline quando a última conexão do usuário fecha.

O leaderboard soma `activity_daily` apenas para o usuário autenticado e suas amizades diretas. Dia, semana, mês e ano usam períodos de calendário enviados pelo cliente; a tela consulta novamente a cada minuto enquanto estiver aberta, sem manter um fluxo pesado permanente.

## Transferência P2P

O chat registra no MySQL a oferta do arquivo — nome, tipo, tamanho e identificador — mas não recebe os bytes. Depois que o destinatário aceita, os clientes negociam uma conexão WebRTC pelo WebSocket e transferem blocos de 64 KiB diretamente, com controle de fluxo e progresso.

Imagens e áudios ganham uma URL temporária criada a partir do `Blob` recebido. O preview e o player usam essa URL em memória; ela é revogada quando o chat fecha. Assim, o servidor continua sem armazenar o conteúdo e a mídia precisa ser recebida novamente depois de recarregar a conversa.

WebRTC já cifra o transporte. Para uma publicação ampla ainda são recomendados:

- Servidor TURN para redes que bloqueiam conexão direta
- SHA-256 do arquivo inteiro após o recebimento
- Retomada de transferências interrompidas
- Antivírus e avisos extras para extensões executáveis
- Limite de tamanho definido pelo operador

## Escala e portabilidade

Uma instância atende bem ao desenvolvimento e a uma comunidade inicial. Para várias instâncias da API, a presença e a distribuição de eventos devem migrar do hub em memória para Redis pub/sub, mantendo o MySQL como origem persistente.

O núcleo usa `sysinfo`, Tauri e React. A futura portabilidade exige principalmente aliases de executáveis, permissões de execução em segundo plano, assinatura e empacotamento próprios de cada sistema operacional; a API social permanece igual.
