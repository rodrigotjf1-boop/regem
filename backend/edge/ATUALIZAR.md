# Regem Edge — publicar e aplicar atualizações · passo a passo

> Este guia cobre **como distribuir uma nova versão do servidor edge** (o backend
> do Regem que roda no PC da loja) e **como a loja aplica** essa atualização.
>
> **Dois mundos diferentes:**
> - **Nuvem** (`api.dmsregem.com` / `app.dmsregem.com`): atualiza **sozinha** a
>   cada `git push` na `main` (EasyPanel auto-deploy). Você **não** usa este guia
>   para a nuvem — só para o **edge**.
> - **Edge** (PC da loja): **não** olha o git. Você **publica** um pacote e **cada
>   loja aplica** (pelo botão do app ou pelo script). É disso que trata este guia.
>
> **Como ler:** cada passo tem **Ação** (o que fazer), **Onde** (o local exato),
> **Como** (comando/clique/valor) e **Confirmação** (o que prova que deu certo).
> Faça na ordem. Se a Confirmação não bater, **pare** e resolva antes de seguir.

> ⚠️ **Versão = número tipo `1.4.0`** (maior.menor.correção). A comparação é
> **numérica por segmento** (`1.4.10` > `1.4.2`). Sempre suba o número a cada
> publicação — se repetir, as lojas acham que já estão atualizadas.

---

## PARTE A — Publicar uma nova versão (na SUA máquina de desenvolvimento)

### Passo 1 — Garantir que o código está pronto e testado

- **Ação:** confirmar que o build passa nos dois projetos antes de empacotar.
- **Onde:** terminal na raiz do repositório (`C:\Regen`).
- **Como:**
  ```bash
  cd backend && npm run build
  cd ../frontend && npm run build
  ```
- **Confirmação:** os dois terminam **sem erro**. (O que já estiver na `main`
  também já subiu para a nuvem — o edge usa o mesmo código.)

### Passo 2 — Gerar o pacote da versão

- **Ação:** compilar, montar o pacote do edge, zipar e calcular o SHA-256.
- **Onde:** PowerShell, dentro da pasta `backend`.
- **Como:** (troque `1.4.0` pela versão nova)
  ```powershell
  cd backend
  .\edge\publicar.ps1 -Versao 1.4.0
  ```
  > Já rodou `npm run build` agora há pouco? Pode acelerar com `-SkipBuild`.
- **Confirmação:** ao final o script **imprime 3 linhas** para você copiar (Passo
  4) e cria o arquivo **`regem-edge-1.4.0.zip`** ao lado da pasta `backend`
  (em `C:\Regen\..`). O zip **não** inclui `node_modules` (o edge roda `npm ci`
  ao aplicar) — por isso é pequeno.

### Passo 3 — Hospedar o `.zip` num endereço HTTPS

- **Ação:** subir o `regem-edge-1.4.0.zip` para um lugar que **as lojas
  consigam baixar** por HTTPS.
- **Onde:** o storage que você usar (ex.: Supabase Storage, um bucket S3/R2,
  ou qualquer hospedagem de arquivos com URL pública HTTPS).
  - **Supabase Storage:** projeto → **Storage** → crie/abra um bucket **público**
    → **Upload file** → selecione o `.zip` → copie o **Public URL**.
- **Como:** faça o upload e **copie a URL final** do arquivo (tem que terminar
  em `.zip`).
- **Confirmação:** cole a URL no navegador (numa aba anônima) — o download do
  `.zip` começa **sem pedir login**.

### Passo 4 — Anunciar a versão para as lojas (3 variáveis na nuvem)

É assim que cada edge **descobre** que há versão nova.

- **Ação:** definir 3 (ou 4) variáveis de ambiente no serviço da API na nuvem.
- **Onde:** **EasyPanel** → projeto Regem → serviço **`regem-api`** → aba
  **Environment**.
- **Como:** crie/atualize estas variáveis:
  ```
  EDGE_LATEST_VERSION = 1.4.0
  EDGE_UPDATE_URL     = https://…/regem-edge-1.4.0.zip
  EDGE_UPDATE_SHA256  = <o SHA-256 que o publicar.ps1 imprimiu no Passo 2>
  EDGE_UPDATE_NOTAS   = O que mudou nesta versão (aparece pro lojista) — opcional
  ```
  Depois clique **Deploy** (reinicia a API com os novos valores).
- **Confirmação:** abra no navegador
  `https://api.dmsregem.com/api/v1/edge/update-check?versao=0` → o JSON mostra
  `"ultima":"1.4.0"`, `"atualizar":true` e a `"url"`/`"sha256"` que você definiu.

> ✅ **Pronto.** A partir daqui, cada loja se atualiza sozinha (verificação) e
> **instala com 1 clique** (Parte B). Você não precisa acessar o PC da loja.

---

## PARTE B — Aplicar a atualização (no PC da loja)

Há **dois caminhos**. O recomendado é o **botão no app**.

### Caminho 1 (recomendado) — pelo app, na tela do Servidor

- **Ação:** verificar e instalar a atualização pela interface.
- **Onde:** no app aberto **no servidor da loja** (`https://localhost:3001` ou
  `https://regem.local:3001`) → menu **Servidor local** (`/servidor`).
  > Só aparece para **presidente/gerente** e **apenas no app do edge**.
- **Como:**
  1. No card **“Atualização do servidor”**, clique **Verificar atualização**.
  2. Se houver versão nova, aparecem a **versão** e as **notas** (o que muda).
  3. Clique **Instalar atualização** e **confirme**.
- **Confirmação:** aparece “Atualização iniciada… aguarde 1–2 minutos e recarregue”.
  Depois de ~2 min, recarregue a página: a **“Versão instalada”** já é a nova.
- **⚠️ Efeito colateral:** os serviços reiniciam por **1–2 minutos** — **KDS, PDV
  e ponto ficam indisponíveis** nesse intervalo. **Faça com a loja fechada** (ou
  em horário de baixo movimento).

> A loja **também é avisada sozinha**: o servidor verifica se há versão nova
> **ao abrir o estabelecimento** — nos **10 primeiros minutos** após o horário de
> abertura e de novo **~30 minutos** depois (usa o horário cadastrado em
> **Delivery → ⚙️ → Horários**; sem horário cadastrado, verifica por volta das
> **04:00**). Ela **avisa**, mas **nunca instala sozinha** — quem instala é você
> pelo botão.

### Caminho 2 (alternativo) — pelo script, direto no PC

Use se o app estiver inacessível ou para instalar remotamente por acesso ao PC.

- **Ação:** rodar o aplicador de atualização manualmente.
- **Onde:** **PowerShell como Administrador**, no PC da loja.
- **Como:**
  ```powershell
  C:\regem-edge\backend\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend"
  ```
  > Precisa reinstalar a **mesma** versão (ex.: para corrigir um serviço)?
  > Acrescente `-Forcar`.
- **Confirmação:** o log termina com **`OK! Atualizado para 1.4.0`**. Os serviços
  `RegemEdgeApi`, `RegemEdgeSync`, `RegemEdgeImpressao` e `RegemEdgeWeb` voltam a
  rodar (veja em **services.msc** ou `Get-Service RegemEdge*`).

---

## O que a atualização faz por baixo (para sua tranquilidade)

O `atualizar.ps1` é **seguro por padrão** — nada é aplicado se algo não bater:

1. **Confere a versão** na nuvem e **baixa o `.zip`**.
2. **Valida o SHA-256** do pacote **antes de tocar em qualquer arquivo** (se não
   bater, aborta — pacote corrompido/adulterado).
3. **Backup**: `pg_dump` do banco local + cópia da pasta `dist` (`dist.bak`).
4. **Para os serviços**, troca `dist / web / database / scripts` e **atualiza os
   scripts do edge** (`edge\*.mjs` e `.ps1`), **registra serviços novos** que
   faltem (ex.: a impressão), roda `npm ci` e as **migrations locais**.
5. Atualiza `APP_VERSION` no `.env.local` e **sobe os serviços**.
6. **Health-check** no `/ping`. Se falhar → **rollback** automático do código
   (`dist.bak`) + reinício. O banco fica com o backup do passo 3.

> **Migrations:** no **edge** rodam **sozinhas** durante a atualização
> (`apply-all-local.mjs`). Na **nuvem**, migrations **não** sobem no deploy —
> aplique o `.sql` novo **à mão no Supabase** (SQL Editor) quando a versão tiver
> uma migration.

---

## Resolução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| App diz “já está na versão mais recente” mas você publicou | `EDGE_LATEST_VERSION` não subiu, ou você não deu **Deploy** no `regem-api` | Reconfirme o Passo 4 (o `update-check` no navegador tem que mostrar a versão nova) |
| “SHA-256 não confere” no log | `EDGE_UPDATE_SHA256` errado, ou o `.zip` no storage é de outra versão | Copie o SHA que o `publicar.ps1` imprimiu para **essa** versão; confira se subiu o `.zip` certo |
| “A nuvem não informou EDGE_UPDATE_URL/SHA256” | Faltou uma das 3 variáveis no `regem-api` | Defina as 3 no EasyPanel e **Deploy** |
| Instalou mas a **impressão automática** não funciona num edge **antigo** | Bootstrap: o `atualizar.ps1` **antigo** não copiava `edge/` | Nesse PC, rode o **instalador completo** uma vez; a partir daí os updates propagam tudo |
| Não achou `pg_dump`/`nssm`/`node` | PATH sem os binários do bundle | O `atualizar.ps1` resolve do bundle (`..\node`, `..\pgsql\bin`, `..\nssm`); confira se a pasta bundle está ao lado de `backend` |
| Serviços não voltaram | Health-check falhou → já fez rollback | Veja o log em `C:\regem-edge\backend\logs\atualizar-*.log`; o código voltou ao anterior |

---

## Checklist rápido (para colar na parede)

**Publicar (você):**
1. `backend`: `npm run build` (back e front) ✔
2. `.\edge\publicar.ps1 -Versao X.Y.Z` → guarda o **SHA** ✔
3. Sobe o `.zip` num HTTPS e copia a **URL** ✔
4. EasyPanel → `regem-api` → Environment: `EDGE_LATEST_VERSION` / `_URL` / `_SHA256` (+ `_NOTAS`) → **Deploy** ✔
5. Abre `…/edge/update-check?versao=0` e confere ✔

**Aplicar (loja):**
1. App → **Servidor local** → **Verificar atualização** ✔
2. **Instalar atualização** (loja fechada — reinicia 1–2 min) ✔
3. Recarrega e confere a **versão instalada** ✔
