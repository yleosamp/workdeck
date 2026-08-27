# Workdeck

O Workdeck é uma “Steam para softwares profissionais”: acompanha o tempo gasto em Blender, Premiere Pro, After Effects, Photoshop, Figma e programas personalizados, reúne amigos e presença em tempo real e permite enviar arquivos diretamente pelo chat.

## O que já funciona

- Contas reais com cadastro, login, sessão renovável e senha protegida com Argon2id
- Rastreamento nativo dos processos no Windows e macOS a cada 15 segundos
- Horas de hoje, total e histórico diário separado por software
- Heatmap de 364 dias, geral ou filtrado por programa
- Biblioteca de programas e adição por nome do processo, como `Resolve.exe`
- Pedidos de amizade, aceitar, recusar, remover, bloquear e desbloquear
- Status online/offline, software aberto e notificação em tempo real
- Chat persistente, mensagens offline, não lidas e confirmação de leitura
- Envio de arquivos entre amigos por WebRTC P2P, com aceite e progresso
- Preview de imagens e player de áudio diretamente no chat após o recebimento P2P
- Janela nativa **Salvar como** para escolher pasta e nome do arquivo recebido
- Ranking diário, semanal, mensal e anual somente entre você e seus amigos
- Perfil público por link, com software atual, recentes, heatmap e privacidade configurável
- Perfil do amigo dentro do Workdeck, sem sair da conversa
- Descrição, foto de perfil e banner personalizados
- Aviso próprio e clicável no canto da tela, no estilo Steam, que abre o chat do amigo
- Ícone na bandeja do Windows e na barra de menus do macOS; fechar/minimizar mantém o rastreador em segundo plano
- Atualizador assinado: verifica ao abrir, repete a cada quatro horas e instala sem baixar setup manualmente
- Builds automáticos para Windows x64, macOS Intel e macOS Apple Silicon
- Sessões isoladas por janela para testar duas contas no mesmo computador
- Backend Fastify + MySQL e aplicativo desktop Tauri + React + Rust

O rastreador lê somente os nomes dos processos em execução. Ele não acessa seus projetos, arquivos abertos, teclas digitadas nem o conteúdo da tela.

## Usar no seu computador agora

1. Mantenha o MySQL ligado.
2. Instale a versão mais recente do Workdeck.
3. Dê dois cliques em `INICIAR_WORKDECK_LOCAL.cmd`.
4. Crie sua conta na tela de cadastro.

Esse atalho inicia o backend de forma invisível e abre o Workdeck instalado. Para encerrar apenas o backend local, use `PARAR_BACKEND_LOCAL.cmd`.

Fechar ou minimizar a janela envia o Workdeck para a bandeja do Windows ou barra de menus do macOS. Clique no ícone para reabrir; use **Sair completamente** para encerrar o aplicativo e o rastreador.

Na primeira execução, o backend cria automaticamente o banco `workdeck` e todas as tabelas. Os dados de conexão ficam no arquivo `.env`, que não entra no instalador nem no controle de versão. Para mudar de banco, edite somente esse arquivo.

## Entender o modo local

O rastreamento sempre acontece no próprio computador e continua salvo em SQLite. O MySQL guarda contas, amizades, presença, mensagens e a cópia sincronizada das estatísticas autorizadas.

O instalador público vem configurado para `http://144.22.135.127:8787`. A opção **Configuração do servidor** permite trocar o endereço sem recompilar o aplicativo. Para desenvolvimento inteiramente local, salve `http://127.0.0.1:8787` nessa opção.

O passo a passo completo está em [Backend local e VPS](docs/backend-e-vps.md). Para publicar novas versões e gerar os aplicativos de Mac, veja [Atualizações automáticas e macOS](docs/atualizacoes-e-macos.md). A organização interna está em [Arquitetura](docs/architecture.md).

## Testar sozinho com duas contas

1. Abra o Workdeck normalmente e entre na primeira conta.
2. Abra o Workdeck outra vez.
3. Na segunda janela, abra **Settings** e clique em **Use another account in this window**.
4. Entre ou crie a segunda conta. A primeira janela continua autenticada na primeira conta.
5. Use **Friends → Solicitações** para aceitar o pedido.

Em **Settings**, o botão **Test P2P on this PC** faz uma transferência real entre dois pares WebRTC locais e confirma se o recurso funciona no computador. **Testar aviso estilo Steam** mostra o novo cartão de atividade no canto da tela.

## Executar pelo código-fonte

Requisitos: Node.js 20 ou superior, MySQL 8, Rust e as ferramentas nativas do sistema (MSVC/WebView2 no Windows ou Xcode no macOS).

```powershell
npm install
npm run build:api
npm run start:api:prod
```

Em outro terminal:

```powershell
npm run tauri dev
```

Para gerar o instalador do sistema atual:

```powershell
npm run tauri:build:windows
```

No macOS, use `npm run tauri:build:macos`. A esteira do GitHub já executa os dois builds do Mac automaticamente.

Verificações:

```powershell
npm run test:api
npm run test
npm run build
cd src-tauri
cargo check
```

## Limites desta versão

- O rastreamento continua enquanto o processo do Workdeck estiver na bandeja; **Sair completamente** encerra o rastreador.
- A transferência de arquivos é P2P e depende de WebRTC. Redes restritivas podem exigir um servidor TURN, que não está incluído nesta versão.
- Recuperação de senha por e-mail, denúncias, assinatura Authenticode do setup do Windows e criptografia ponta a ponta das mensagens de texto ficam para a etapa de produção pública.
- A distribuição pública no macOS sem alertas do Gatekeeper exige certificado e notarização do Apple Developer Program; o código e a esteira já aceitam essas credenciais.
- O arquivo não é armazenado no servidor; apenas seus metadados e as mensagens do chat ficam no MySQL.
- Previews P2P ficam somente na memória da conversa atual e desaparecem ao recarregar, pois não existe cópia dos bytes no servidor.
