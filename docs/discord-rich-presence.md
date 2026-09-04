# Discord Rich Presence

O Workdeck publica a atividade pelo IPC local do aplicativo desktop do Discord. Nenhum token de usuário ou bot é necessário, e nenhum dado dessa integração passa pelo backend do Workdeck.

## Configuração da aplicação oficial

1. Crie uma aplicação chamada `Workdeck` no [Discord Developer Portal](https://discord.com/developers/applications).
2. Em **General Information**, use o ícone do Workdeck e copie o **Application ID**.
3. Em **Rich Presence → Art Assets**, envie as imagens usando exatamente estas chaves:
   - `workdeck`
   - `premiere-pro`
   - `after-effects`
   - `blender`
   - `photoshop`
   - `figma`
4. No GitHub, crie a variável de Actions `WORKDECK_DISCORD_CLIENT_ID` com o Application ID. O ID é público e pode ser incluído com segurança no aplicativo.
5. Gere a release normalmente. O Rust lê essa variável durante a compilação e a configuração deixa de aparecer para o usuário final.

## Comportamento e privacidade

- A presença só aparece enquanto um software acompanhado estiver aberto e o usuário não estiver ausente.
- O contador da sessão usa o instante em que o processo foi detectado; suspensão e retorno do computador iniciam uma nova sessão.
- O usuário pode ocultar separadamente o nome do software, o cronômetro, o tempo total e o ícone pequeno.
- Desativar a integração remove imediatamente a atividade do perfil do Discord.
- Se o Discord for aberto depois do Workdeck, uma nova tentativa acontece automaticamente no próximo ciclo de rastreamento.
- Aplicativos personalizados continuam exibindo o logo do Workdeck, mas não recebem ícone pequeno até existir um asset correspondente.

O recurso funciona no Windows, macOS e Linux porque conversa com o pipe/socket local exposto pelo cliente desktop do Discord.
