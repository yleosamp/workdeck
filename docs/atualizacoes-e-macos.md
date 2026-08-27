# Atualizações automáticas e macOS

## O que muda a partir da versão 0.7.0

A versão 0.8.1 é a **versão ponte para instalações HTTP**. Quem ainda usa uma versão anterior precisa instalar esse setup uma última vez, porque as versões antigas não aceitam o transporte HTTP usado pela VPS sem domínio. A partir daí, o Workdeck procura atualizações ao abrir e depois a cada quatro horas. Quando encontra uma versão nova, mostra um cartão, aguarda 30 segundos e instala automaticamente. O usuário pode clicar em **Depois** para adiar ou desligar esse comportamento em **Settings → Atualizações automáticas**.

Os pacotes são assinados. O Workdeck rejeita qualquer instalador alterado ou que não tenha sido assinado com a chave privada correta.

## Opção recomendada: GitHub Actions

O arquivo `.github/workflows/release.yml` cria automaticamente:

- setup do Windows x64;
- aplicativo para Macs Apple Silicon (M1, M2, M3 e posteriores);
- aplicativo para Macs Intel;
- assinaturas do atualizador e o arquivo `latest.json`.

No repositório, cadastre estes segredos em **Settings → Secrets and variables → Actions**:

- `TAURI_SIGNING_PRIVATE_KEY`: conteúdo da chave privada do atualizador;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: senha da chave, se existir;
- os segredos `APPLE_*` descritos abaixo para assinar e notarizar o aplicativo do Mac.

Depois, crie e envie uma tag igual à versão do aplicativo, por exemplo `v0.7.0`. A esteira compila nas máquinas reais do GitHub e publica uma Release com todos os pacotes.

Na `.env` da VPS, aponte o backend para o manifesto publicado:

```env
UPDATE_MANIFEST_URL=https://github.com/SEU_USUARIO/SEU_REPOSITORIO/releases/latest/download/latest.json
```

Reinicie o backend. Não é necessário trocar essa URL em cada versão.

## Opção alternativa: arquivos na própria VPS

Deixe `UPDATE_MANIFEST_URL` vazio e configure:

```env
RELEASES_DIR=./releases
PUBLIC_API_URL=https://api.seudominio.com
```

No Windows, depois de compilar e assinar, rode:

```powershell
.\scripts\publicar-atualizacao.ps1 -Version 0.7.0 -Notes "Resumo das melhorias"
```

O script copia o setup e a assinatura para `releases` e cria `latest.json`. Os pacotes do Mac podem ser acrescentados pelos parâmetros `MacIntelArchive`, `MacIntelSignature`, `MacArmArchive` e `MacArmSignature`.

## Assinatura e notarização do macOS

O código está preparado para macOS 13.0 ou superior e para Intel e Apple Silicon. O mínimo foi elevado para permitir a captura de tela e a janela de transmissão com o suporte moderno do macOS. Na primeira chamada, autorize Microfone, Câmera e Gravação de Tela em **Ajustes do Sistema → Privacidade e Segurança**. Para distribuir sem o aviso de aplicativo não confiável do Gatekeeper, é necessário participar do Apple Developer Program e cadastrar no GitHub:

- `APPLE_CERTIFICATE`: certificado Developer ID Application em Base64;
- `APPLE_CERTIFICATE_PASSWORD`: senha do certificado;
- `KEYCHAIN_PASSWORD`: senha temporária forte usada pela esteira para o chaveiro do Mac;
- `APPLE_ID`: conta Apple usada na notarização;
- `APPLE_PASSWORD`: senha específica de aplicativo;
- `APPLE_TEAM_ID`: identificador da equipe Apple.

Sem essas credenciais, a esteira gera um pacote com assinatura ad-hoc para testes, mas ele não equivale a uma versão pública notarizada. Quando o certificado existe, a esteira o importa em um chaveiro temporário, encontra automaticamente a identidade `Developer ID Application`, assina e envia o pacote para notarização. A compilação e os testes automatizados do Mac rodam em máquinas macOS do GitHub, pois Windows não consegue produzir nem validar completamente um `.app`/`.dmg` final.

## Publicar uma nova versão

1. Atualize a versão em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. Rode os testes.
3. Envie o código e uma tag com a mesma versão.
4. Aguarde a ação **Publicar Workdeck** terminar nos três sistemas.
5. Abra uma instalação antiga e use **Settings → Verificar atualizações** para conferir.

Guarde cópias seguras da chave privada do atualizador. Se ela for perdida, os aplicativos já instalados não aceitarão pacotes assinados por uma chave nova.
