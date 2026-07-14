# Regem Edge — publicar e aplicar atualizações · tutorial completo

> Este é o guia **passo a passo** para **distribuir uma nova versão do servidor
> edge** (o backend do Regem que roda no PC da loja) e para a **loja aplicar** a
> atualização.
>
> **Como ler:** cada passo tem **Ação** (o que fazer), **Onde** (plataforma +
> caminho exato de menus), **Como** (comando/clique/valor literal), **Confirmação**
> (o que prova que deu certo) e, quando houver, **⚠️ Efeito colateral**. Faça na
> ordem. Se a Confirmação não bater, **pare** e resolva antes de seguir.

## Os dois mundos (não confunda)

| | **Nuvem** (`api`/`app.dmsregem.com`) | **Edge** (PC da loja) |
|---|---|---|
| Como atualiza | **Sozinha**, a cada `git push` na `main` (EasyPanel auto-deploy) | Você **publica** um pacote; **cada loja aplica** |
| Migrations (SQL) | **Manuais** no Supabase | **Automáticas** no update (`apply-all-local.mjs`) |
| Este guia serve para | ❌ não (a nuvem é automática) | ✅ **sim** |

## Glossário rápido

- **Versão** — número tipo `1.4.0` (maior.menor.correção). A comparação é
  **numérica por segmento**: `1.4.10` é **maior** que `1.4.2`. **Suba sempre** o
  número a cada publicação; se repetir, as lojas acham que já estão atualizadas.
- **Pacote** — o `.zip` que a loja baixa e instala (sai do `publicar.ps1`).
- **SHA-256** — a "impressão digital" do pacote. A loja **recusa** instalar se o
  SHA não bater (proteção contra download corrompido ou adulterado).

---

## Pré-requisitos da máquina que PUBLICA (a sua, de desenvolvimento)

Você só publica; a loja não precisa de nada disso.

| Ferramenta | Para quê | Link oficial / instalação | Verificar |
|---|---|---|---|
| **Node.js 20 LTS+** | compilar o backend e montar o pacote | https://nodejs.org/en/download — ou `winget install OpenJS.NodeJS.LTS` | `node -v` → mostra `v20.x` ou maior |
| **Git** | ter o repositório atualizado | https://git-scm.com/download/win — ou `winget install Git.Git` | `git --version` |
| **Windows PowerShell 5.1** | rodar o `publicar.ps1` | **já vem no Windows** (não instale nada) | `"$($PSVersionTable.PSVersion)"` |

> **Antes de tudo:** garanta que sua `main` está atualizada — `git pull origin main`.
> O edge usa o **mesmo código** que já está na nuvem; publicar é só empacotá-lo.

---

## PARTE A — Publicar uma nova versão (na SUA máquina)

### Passo 1 — Conferir que o build passa (os dois projetos)

- **Ação:** garantir que back e front compilam antes de empacotar (nunca publique build quebrado).
- **Onde:** terminal (PowerShell ou Git Bash), na raiz do repositório (`C:\Regen`).
- **Como:**
  ```bash
  cd backend && npm run build
  cd ../frontend && npm run build
  ```
- **Confirmação:** os dois terminam **sem erro** (o back mostra `nest build`; o front, `✓ Compiled successfully`).

### Passo 2 — Gerar o pacote da versão

- **Ação:** compilar, montar a pasta do edge, zipar e calcular o SHA-256.
- **Onde:** **PowerShell**, dentro da pasta `backend`.
- **Como:** troque `1.4.0` pela versão nova (maior que a atual):
  ```powershell
  cd backend
  .\edge\publicar.ps1 -Versao 1.4.0
  ```
  > Já rodou `npm run build` no Passo 1? Acelere com `-SkipBuild` (pula a recompilação).
- **Confirmação:** ao final o script:
  1. cria o arquivo **`regem-edge-1.4.0.zip`** ao lado da pasta `backend` (em `C:\Regen\..`);
  2. **imprime 3 linhas** prontas para colar no Passo 4, incluindo o **SHA-256**.
  Guarde essa saída (ou deixe o terminal aberto).

> **Perdeu o SHA?** Recalcule sem republicar:
> ```powershell
> (Get-FileHash -Algorithm SHA256 "C:\Regen\..\regem-edge-1.4.0.zip").Hash.ToLower()
> ```
> Tem que ser **exatamente** o valor que você vai colar em `EDGE_UPDATE_SHA256`.

### Passo 3 — Hospedar o `.zip` num endereço HTTPS público

O pacote precisa ficar num **URL HTTPS** que **qualquer loja baixe sem login**.

#### Qual serviço usar? (comparação de mercado)

| Opção | Como funciona | Prós | Contras | Quando usar |
|---|---|---|---|---|
| **Supabase Storage** ⭐ | bucket público no mesmo Supabase do projeto | você **já tem** conta; simples; grátis para arquivos pequenos | egress limitado no plano free (ok p/ poucas lojas) | **padrão recomendado** — menos plataformas para administrar |
| **Cloudflare R2** | bucket com URL público `pub-….r2.dev` | **egress grátis**; escala bem | `r2.dev` é **rate-limited / sem cache** (para produção real, exige domínio próprio) | muitas lojas / muito download |
| **AWS S3** | bucket + objeto público (ou CloudFront) | padrão de mercado, robusto | cobra egress; setup de policy/IAM mais chato | já usa AWS |
| **GitHub Releases** | anexo de release no repositório | versionado, grátis | **o repo é privado** → o download **exige token** (não serve p/ a loja baixar anônimo) | só se o repositório for público |

**Recomendação:** **Supabase Storage** — é o que já está no projeto, e o volume (um
`.zip` por versão, poucas lojas) cabe folgado no plano. Migre para **R2** se um dia
tiver muitas lojas baixando (egress grátis).

#### Passos (Supabase Storage — a opção recomendada)

- **Ação:** subir o `.zip` num bucket público e copiar a URL.
- **Onde:** **Supabase** → seu projeto Regem → menu lateral **Storage**.
- **Como:**
  1. **Storage** → botão **New bucket**.
  2. **Name:** `edge-updates` · **ligue** o toggle **Public bucket** → **Create bucket**.
     *(Bucket público = os arquivos ficam legíveis por qualquer um com a URL — é o que queremos para o instalador. **Não** guarde nada sensível nele.)*
  3. Abra o bucket `edge-updates` → **Upload file** → selecione `regem-edge-1.4.0.zip`.
  4. Clique no arquivo enviado → **Copy URL** (ou monte a URL pelo padrão abaixo).
- **Confirmação:** a URL segue o formato
  ```
  https://<REF-DO-PROJETO>.supabase.co/storage/v1/object/public/edge-updates/regem-edge-1.4.0.zip
  ```
  Cole-a numa **aba anônima** do navegador — o download começa **sem pedir login**.
- **⚠️ Efeito colateral:** um bucket público expõe **tudo** que estiver nele. Use um
  bucket **só** para os pacotes de update (nada de dados de cliente/segredos).

### Passo 4 — Anunciar a versão para as lojas (variáveis na nuvem)

É assim que **cada edge descobre** que há versão nova. São 3 variáveis obrigatórias
(+ 1 opcional). Formato no padrão da skill:

```
Variável: EDGE_LATEST_VERSION
Onde: EasyPanel → projeto Regem → serviço `regem-api` → aba Environment
Valor: 1.4.0            (a mesma versão do Passo 2)

Variável: EDGE_UPDATE_URL
Onde: (mesma tela)
Valor: https://<REF>.supabase.co/storage/v1/object/public/edge-updates/regem-edge-1.4.0.zip

Variável: EDGE_UPDATE_SHA256
Onde: (mesma tela)
Valor: <o SHA-256 impresso no Passo 2>   (minúsculo, sem espaços)

Variável: EDGE_UPDATE_NOTAS   (opcional — aparece pro lojista no card de update)
Onde: (mesma tela)
Valor: Impressão automática na cozinha + mapa de calor de entregas
```

- **Ação de efetivação:** depois de salvar as variáveis, clique **Deploy** no
  serviço `regem-api` (reinicia a API lendo os novos valores).
- **Confirmação:** abra no navegador
  `https://api.dmsregem.com/api/v1/edge/update-check?versao=0`
  → o JSON mostra `"ultima":"1.4.0"`, `"atualizar":true` e a `"url"`/`"sha256"` que você definiu.
- **⚠️ Efeito colateral:** o **Deploy reinicia a API da nuvem** (poucos segundos de
  indisponibilidade). As sessões dos usuários **não** caem (o JWT continua válido).

> ✅ **Pronto.** A partir daqui, cada loja se **avisa sozinha** ao abrir e **instala
> com 1 clique** (Parte B). Você não precisa acessar o PC da loja.

---

## PARTE B — Aplicar a atualização (no PC da loja)

Dois caminhos. O recomendado é o **botão no app**.

### Caminho 1 (recomendado) — pelo app, na tela do Servidor

- **Ação:** verificar e instalar a atualização pela interface.
- **Onde:** no app aberto **no servidor da loja** — `https://localhost:3001` (no
  próprio PC) ou `https://regem.local:3001` (de outro aparelho da rede) → menu
  lateral **Servidor local** (rota `/servidor`).
  > O card **só aparece** para **presidente/gerente** e **apenas no app do edge**.
- **Como:**
  1. No card **"Atualização do servidor"**, clique **Verificar atualização**.
     *(Ele consulta a nuvem ao vivo. Se disser "já está na versão mais recente", revise o Passo 4.)*
  2. Aparecendo a versão nova + as notas, clique **Instalar atualização** e **confirme** no aviso.
- **Confirmação:** aparece "Atualização iniciada… aguarde 1–2 minutos e recarregue".
  Após ~2 min, **recarregue a página** (Ctrl+Shift+R): a **"Versão instalada"** já é a nova.
- **⚠️ Efeito colateral:** os serviços reiniciam por **1–2 minutos** — **KDS, PDV e
  ponto ficam indisponíveis** nesse intervalo. **Faça com a loja fechada** ou em
  horário de baixo movimento.

### Caminho 2 (alternativo) — pelo script, direto no PC

Use se o app estiver inacessível, ou para instalar via acesso remoto ao PC.

- **Ação:** rodar o aplicador de atualização manualmente.
- **Onde:** **Windows PowerShell como Administrador**, no PC da loja.
  *(Menu Iniciar → digite "PowerShell" → clique com botão direito → **Executar como administrador**.)*
- **Como:**
  ```powershell
  C:\regem-edge\backend\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend"
  ```
  > Precisa reinstalar a **mesma** versão (ex.: para corrigir um serviço)? Acrescente `-Forcar`.
- **Confirmação:** o log termina com **`OK! Atualizado para 1.4.0`**. Confira os
  serviços de pé:
  ```powershell
  Get-Service RegemEdge*
  ```
  → `RegemEdgeApi`, `RegemEdgeSync`, `RegemEdgeImpressao`, `RegemEdgeWeb` = **Running**.

### Como funciona o aviso automático (e como configurar o horário)

A loja **verifica sozinha** se há versão nova **ao abrir** — nos **10 primeiros
minutos** após o horário de abertura e de novo **~30 minutos** depois. Ela **só
avisa** (não instala sozinha).

- **Ação:** definir o horário de abertura para o aviso cair na hora certa.
- **Onde:** app → **Delivery** → botão **⚙️** (configurar) → seção **Horários**.
- **Como:** marque o dia como **ativo** e preencha **Abre**/**Fecha** (seletor de hora).
- **Confirmação:** o horário aparece salvo na seção Horários.
- **Sem horário cadastrado?** O aviso cai no **padrão 04:00** (e ~04:30). Nada quebra —
  só verifica de madrugada em vez de na abertura.

---

## O que a atualização faz por baixo (segurança)

O `atualizar.ps1` é **seguro por padrão** — nada é aplicado se algo não bater:

1. **Confere a versão** na nuvem e **baixa o `.zip`**.
2. **Valida o SHA-256 antes de tocar em qualquer arquivo** (não bateu → **aborta**).
3. **Backup:** `pg_dump` do banco local + cópia da pasta `dist` (`dist.bak`).
4. **Para os serviços**, troca `dist / web / database / scripts`, **atualiza os
   scripts do edge** (`edge\*.mjs` e `.ps1` por cópia overlay), **registra serviços
   que faltarem** (ex.: a impressão `RegemEdgeImpressao`), roda `npm ci` e as
   **migrations locais**.
5. Atualiza `APP_VERSION` no `.env.local` e **sobe os serviços**.
6. **Health-check** no `/ping`. Falhou → **rollback automático** do código
   (`dist.bak`) + reinício; o banco fica com o backup do passo 3.

> **Migrations:** no **edge** rodam **sozinhas** no update. Na **nuvem**, migrations
> **não** sobem no deploy — quando a versão tiver um `.sql` novo, aplique à mão:
> ```
> Onde: Supabase → projeto Regem → SQL Editor → New query
> Como: cole o conteúdo do database/migrations/NNN_*.sql da versão → Run.
> ```

---

## Resolução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| App diz "já está na versão mais recente", mas você publicou | `EDGE_LATEST_VERSION` não subiu, ou faltou **Deploy** no `regem-api` | Refaça o Passo 4; o `update-check` no navegador tem que mostrar a versão nova |
| Log: "SHA-256 NAO confere" | `EDGE_UPDATE_SHA256` errado, ou o `.zip` no storage é de outra versão | Recalcule o SHA (Passo 2) e confira se subiu o `.zip` certo |
| Log: "a nuvem nao informou EDGE_UPDATE_URL/SHA256" | Faltou uma das 3 variáveis no `regem-api` | Defina as 3 no EasyPanel e **Deploy** |
| Download falha na loja | URL não é pública (pediu login) ou bucket privado | Abra a URL em aba anônima; no Supabase, o bucket tem que estar **Public** |
| Instalou, mas a **impressão automática** não veio (edge **antigo**) | Bootstrap: o `atualizar.ps1` **antigo** ainda não copiava `edge/` | Nesse PC, rode o **instalador completo** uma vez; dos próximos updates em diante, propaga tudo |
| "pg_dump/nssm/node não encontrado" | PATH sem os binários do bundle | O script resolve do bundle (`..\node`, `..\pgsql\bin`, `..\nssm`); confirme que a pasta bundle está ao lado de `backend` |
| Serviços não voltaram | Health-check falhou → já houve rollback | Veja o log em `C:\regem-edge\backend\logs\atualizar-*.log`; o código voltou ao anterior |

---

## Checklist rápido (para colar na parede)

**Publicar (você):**
1. `git pull` + `npm run build` (back **e** front) ✔
2. `.\edge\publicar.ps1 -Versao X.Y.Z` → guarda o **SHA** ✔
3. Sobe o `.zip` no Supabase Storage (bucket **Public**) e copia a **URL** ✔
4. EasyPanel → `regem-api` → Environment: `EDGE_LATEST_VERSION` / `_URL` / `_SHA256` (+ `_NOTAS`) → **Deploy** ✔
5. Abre `…/edge/update-check?versao=0` e confere a versão ✔

**Aplicar (loja):**
1. App → **Servidor local** → **Verificar atualização** ✔
2. **Instalar atualização** (loja fechada — reinicia 1–2 min) ✔
3. Recarrega (Ctrl+Shift+R) e confere a **versão instalada** ✔
