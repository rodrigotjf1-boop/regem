# Atualizar o servidor edge — passo a passo (onde · como · valor)

Cada passo diz **Onde** (o local exato), **Como** (o que fazer), **Valor** (o que
digitar/colar) e **Confirma** (o que prova que deu certo). A lógica está em `ATUALIZAR.md`.

---

## PARTE A — PUBLICAR a versão (na SUA máquina, 1 vez por versão)

### Passo A1 — Atualizar o código e conferir o build
- **Onde:** um terminal (PowerShell ou Git Bash) na raiz do projeto, `C:\Regen`.
- **Como:** rode os comandos abaixo, um bloco de cada vez.
- **Valor:**
  ```bash
  git pull origin main
  cd backend && npm run build
  cd ../frontend && npm run build
  ```
- **Confirma:** os dois builds terminam **sem erro** (`nest build` e `✓ Compiled successfully`).

### Passo A2 — Gerar o pacote da versão
- **Onde:** **PowerShell**, dentro da pasta `C:\Regen\backend`.
- **Como:** rode o `publicar.ps1` com a versão nova (sempre **maior** que a atual).
- **Valor:** (troque `1.4.0` pela versão que você está publicando)
  ```powershell
  cd C:\Regen\backend
  .\edge\publicar.ps1 -Versao 1.4.0
  ```
- **Confirma:** criou o arquivo `C:\Regen\..\regem-edge-1.4.0.zip` e imprimiu o **SHA-256** no fim. **Copie o SHA** (você usa no Passo A4).

### Passo A3 — Criar o bucket público (só na 1ª vez)
- **Onde:** **Supabase** → seu projeto Regem → menu lateral **Storage** → botão **New bucket**.
- **Como:** dê o nome, ligue o toggle de público e crie.
- **Valor:**
  ```
  Name: edge-updates
  Public bucket: LIGADO
  ```
  Depois clique **Create bucket**.
- **Confirma:** o bucket `edge-updates` aparece na lista de Storage com etiqueta **Public**.

### Passo A4 — Subir o .zip e copiar a URL
- **Onde:** **Supabase** → **Storage** → bucket **`edge-updates`** → botão **Upload file**.
- **Como:** selecione o `.zip` gerado no Passo A2; depois clique no arquivo enviado e use **Copy URL**.
- **Valor:** o arquivo `regem-edge-1.4.0.zip`. A URL final tem este formato:
  ```
  https://<REF-DO-PROJETO>.supabase.co/storage/v1/object/public/edge-updates/regem-edge-1.4.0.zip
  ```
- **Confirma:** cole a URL numa **aba anônima** do navegador — o download começa **sem pedir login**.

### Passo A5 — Anunciar a versão às lojas (variáveis na nuvem)
- **Onde:** **EasyPanel** → projeto Regem → serviço **`regem-api`** → aba **Environment**.
- **Como:** crie/edite as variáveis abaixo e depois clique **Deploy**.
- **Valor:**
  ```
  EDGE_LATEST_VERSION = 1.4.0
  EDGE_UPDATE_URL     = <a URL copiada no Passo A4>
  EDGE_UPDATE_SHA256  = <o SHA copiado no Passo A2>   (minúsculo, sem espaços)
  EDGE_UPDATE_NOTAS   = O que mudou nesta versão      (opcional)
  ```
- **Confirma:** abra no navegador
  `https://api.dmsregem.com/api/v1/edge/update-check?versao=0`
  → o JSON mostra `"ultima":"1.4.0"` e `"atualizar":true`.
- **⚠️ Efeito colateral:** o **Deploy** reinicia a API da nuvem por alguns segundos (as sessões dos usuários não caem).

> Nas **próximas versões**, pule o Passo A3 (o bucket já existe): só A1 → A2 → A4 → A5.

---

## PARTE B — APLICAR na loja

### Caminho 1 (recomendado) — pelo app

#### Passo B1 — Abrir a tela do servidor
- **Onde:** navegador **no PC do servidor da loja**.
- **Como:** acesse o app e vá no menu lateral **Servidor local**.
- **Valor:**
  ```
  https://localhost:3001        (no próprio PC do servidor)
  https://regem.local:3001      (de outro aparelho da mesma rede)
  ```
- **Confirma:** aparece o card **"Atualização do servidor"** (só para presidente/gerente).

#### Passo B2 — Verificar e instalar
- **Onde:** no card **"Atualização do servidor"**.
- **Como:** clique **Verificar atualização**; aparecendo a versão nova, clique **Instalar atualização** e confirme.
- **Valor:** (nada a digitar — são botões)
- **Confirma:** aparece "Atualização iniciada…"; após ~2 min, recarregue (**Ctrl+Shift+R**) e a **"Versão instalada"** já é a nova.
- **⚠️ Efeito colateral:** reinicia os serviços por **1–2 min** (KDS/PDV/ponto ficam fora). **Faça com a loja fechada.**

### Caminho 2 (alternativa) — pelo script no PC

#### Passo B3 — Rodar o aplicador
- **Onde:** **Windows PowerShell como Administrador**, no PC da loja. *(Menu Iniciar → digite "PowerShell" → botão direito → **Executar como administrador**.)*
- **Como:** rode o `atualizar.ps1` apontando para a pasta do edge.
- **Valor:**
  ```powershell
  C:\regem-edge\backend\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend"
  ```
- **Confirma:** o log termina com `OK! Atualizado para 1.4.0`. Cheque os serviços:
  ```powershell
  Get-Service RegemEdge*
  ```
  → `RegemEdgeApi`, `RegemEdgeSync`, `RegemEdgeImpressao`, `RegemEdgeWeb` = **Running**.
