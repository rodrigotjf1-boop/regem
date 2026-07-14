# Regem Edge — instalar num PC de loja (Windows) · passo a passo detalhado

> O servidor edge **é o próprio backend do Regem** rodando **no PC da loja**, com
> um **Postgres local** e o **daemon de sync**. É um **instalador à parte** (o app
> da nuvem continua no EasyPanel). **Um PC = uma loja.**
>
> **Como ler este guia:** cada passo tem **Ação** (o que fazer), **Onde** (o local
> exato), **Como** (o comando/clique/valor) e **Confirmação** (o que prova que deu
> certo). Faça na ordem, sem pular. Se a Confirmação não bater, **pare** e resolva
> antes de seguir.

> ⚠️ Antes de começar: você vai precisar de **2 informações da nuvem** (peça a
> quem administra o Regem): o **token do equipamento `servidor_local`** (passo 6)
> e a **chave pública da licença** `LICENSE_PUBLIC_KEY_B64` (passo 6). Sem elas, o
> sync e a licença não funcionam.

> 🌐 **Conexão de internet — só no setup:** a instalação **precisa de internet**
> por 2 motivos: (1) **baixar as dependências** (`npm ci`) e (2) **ativar a licença**
> na nuvem (login do C&O). **Depois de instalado, o servidor roda 100% offline** —
> a loja opera sem internet e sincroniza com a nuvem quando a conexão volta.
> A **ativação** exige internet **uma vez** (é inevitável — valida o direito de uso).
> *(Opção futura: embutir as dependências no pacote para dispensar o `npm ci`; aí só a ativação fica online.)*

---

## PARTE A — Na SUA máquina (a de desenvolvimento)

### Passo 1 — Gerar o pacote do edge

- **Ação:** compilar o backend e montar a pasta que vai para a loja.
- **Onde:** um terminal (PowerShell ou Git Bash), dentro da pasta `backend` do projeto.
- **Como:** rode, um comando por vez:
  ```bash
  cd backend
  npm ci
  npm run build
  node edge/package.mjs
  ```
- **Confirmação:** apareceu a mensagem `Pronto: ...\regem-edge-dist` e existe uma pasta **`regem-edge-dist`** ao lado da pasta `backend`.

### Passo 2 — Levar o pacote para o PC da loja

- **Ação:** copiar a pasta gerada para o computador da loja.
- **Onde:** a pasta `regem-edge-dist` (criada no passo 1).
- **Como:** copie por pen drive, rede ou nuvem para o PC da loja, dentro de **`C:\regem-edge\backend`** (crie a pasta `C:\regem-edge` e cole o conteúdo de `regem-edge-dist` dentro de `backend`).
- **Confirmação:** no PC da loja existe **`C:\regem-edge\backend\dist\main.js`** e a pasta **`C:\regem-edge\backend\edge`**.

---

## PARTE B — No PC da LOJA

### Passo 3 — Instalar os pré-requisitos

- **Ação:** instalar os 4 programas de base.
- **Onde:** navegador do PC da loja, nos sites oficiais.
- **Como:** baixe e instale, nesta ordem:
  1. **Node.js 20+ (LTS)** — https://nodejs.org (aceite as opções padrão).
  2. **PostgreSQL 15+** — https://www.postgresql.org/download/windows/. **Anote a senha** que você definir para o usuário `postgres` e **mantenha a porta 5432**.
  3. **NSSM** — https://nssm.cc/download. Extraia e coloque o `nssm.exe` numa pasta do **PATH** (ex.: `C:\Windows\System32`).
  4. **OpenSSL** — já vem com o **Git for Windows** (https://git-scm.com/download/win). Instale o Git e o OpenSSL estará disponível.
- **Confirmação:** abra o **PowerShell** e rode `node -v`, `nssm version` e `openssl version`. Cada um deve responder com a versão (sem "não reconhecido").

### Passo 4 — Instalar as dependências e criar o banco

- **Ação:** baixar as bibliotecas do backend e criar o banco de dados local.
- **Onde:** PowerShell, na pasta `C:\regem-edge\backend`.
- **Como:**
  ```powershell
  cd C:\regem-edge\backend
  npm ci --omit=dev
  node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:'postgresql://postgres:SUA_SENHA@localhost:5432/postgres'});await c.connect();await c.query('create database regem_local').catch(()=>{});await c.end()})()"
  ```
  Troque **`SUA_SENHA`** pela senha do Postgres definida no passo 3.
- **Confirmação:** o `npm ci` termina sem erro (aparece `added N packages`) e o comando do banco não gera erro (retorna ao prompt em silêncio = banco criado).

### Passo 5 — Preencher a configuração (`.env.local`)

- **Ação:** criar o arquivo de configuração com os valores da loja.
- **Onde:** a pasta `C:\regem-edge\backend`. Existe lá um modelo em `edge\.env.local.example`.
- **Como:** copie o modelo e edite:
  ```powershell
  Copy-Item edge\.env.local.example .env.local
  notepad .env.local
  ```
  No Bloco de Notas, preencha (deixe o resto como está):
  - `DATABASE_URL` e `EDGE_DATABASE_URL` → troque `SENHA` pela senha do Postgres.
  - `JWT_SECRET` → um texto forte com **16+ caracteres**.
  - `EDGE_UNIDADE_ID` → o id da unidade (loja) — peça a quem administra a nuvem.
  - `SYNC_TOKEN` → o **token do equipamento `servidor_local`** (passo 6).
  - `LICENSE_PUBLIC_KEY_B64` → a **chave pública da licença** (passo 6).
  - Salve e feche.
- **Confirmação:** existe o arquivo **`C:\regem-edge\backend\.env.local`** e, ao abri-lo, `DATABASE_URL` aponta para **`localhost:5432/regem_local`** (não para a nuvem!).

### Passo 6 — Pegar o token e a chave pública (na nuvem)

- **Ação:** obter as 2 credenciais que faltam.
- **Onde:** no **Regem da nuvem** (app.dmsregem.com), logado como presidente/gerente.
- **Como:**
  - **Token do servidor local:** menu **Cadastros → Equipamentos → Novo equipamento**, tipo **`servidor_local`**. Ao salvar, o **token aparece uma vez** — copie e cole no `SYNC_TOKEN` do `.env.local`.
  - **Chave pública da licença:** peça a quem gerou as chaves (`node scripts/gen-license-keys.mjs`) o valor **`LICENSE_PUBLIC_KEY_B64`** e cole no `.env.local`.
- **Confirmação:** o `.env.local` agora tem `SYNC_TOKEN=...` e `LICENSE_PUBLIC_KEY_B64=...` preenchidos (não vazios).

### Passo 7 — Aplicar as migrations no banco local

- **Ação:** criar as tabelas do sistema no banco `regem_local`.
- **Onde:** PowerShell, em `C:\regem-edge\backend`.
- **Como:**
  ```powershell
  node scripts\apply-all-local.mjs
  ```
- **Confirmação:** aparece uma lista de migrations aplicadas e termina **sem erro** (nenhuma linha em vermelho de falha).

### Passo 8 — Gerar o certificado local (HTTPS na rede)

- **Ação:** criar o certificado que deixa o `https://` funcionar na rede da loja (necessário para **câmera do ponto** e **modo offline**).
- **Onde:** PowerShell, em `C:\regem-edge\backend`. Antes, descubra o IP do PC.
- **Como:**
  1. Descubra o IP: rode `ipconfig` e anote o **Endereço IPv4** (ex.: `192.168.1.2`).
  2. Gere o certificado com esse IP:
     ```powershell
     node edge\gen-cert.mjs 192.168.1.2
     ```
- **Confirmação:** existe a pasta **`edge\certs`** com os arquivos **`ca.pem`**, **`server.crt`** e **`server.key`**. (O `.env.local` já aponta `EDGE_TLS_CERT`/`EDGE_TLS_KEY` para eles.)

> **Dica importante:** reserve esse IP no **roteador** (reserva DHCP por MAC) para ele **não mudar** quando reiniciar. Se o IP mudar, os clientes deixam de achar o servidor.

### Passo 9 — Subir como serviços do Windows (ligam sozinhos)

- **Ação:** registrar o backend e o sync como serviços que iniciam no boot, sem terminal aberto.
- **Onde:** um **PowerShell aberto como Administrador** (clique direito → *Executar como administrador*), em `C:\regem-edge\backend`.
- **Como:**
  ```powershell
  cd C:\regem-edge\backend
  .\edge\instalar-servicos.ps1 -Raiz "C:\regem-edge\backend"
  ```
- **Confirmação:** aparece `Pronto. Serviços RegemEdgeApi + RegemEdgeSync ativos`. Em **Serviços do Windows** (`services.msc`) os dois aparecem como **Em execução** e **Automático**.

### Passo 10 — Testar o servidor

- **Ação:** confirmar que o servidor está respondendo.
- **Onde:** o navegador do próprio PC da loja.
- **Como:** abra **`https://localhost:3001/api/v1/ping`**.
- **Confirmação:** aparece um texto como `{"regem":true,"edge":true,...}`. Se o navegador reclamar do certificado em `localhost`, é normal — o que importa é vir o JSON.

### Passo 11 — Ativar a licença da loja

- **Ação:** vincular a licença a este equipamento.
- **Onde:** primeiro na nuvem (tela **`/frota`**), depois no PowerShell do PC da loja.
- **Como:**
  1. Na nuvem, tela **Revenda & frota** (`/frota`, como presidente): **Emitir token** para a loja (informe o `tenantId`, ramo *food service*, plano e módulos). **Copie o token** (aparece uma vez).
  2. No PC da loja, ative:
     ```powershell
     curl.exe -X POST https://localhost:3001/api/v1/provisionamento/ativar -H "content-type: application/json" -d "{\"token\":\"COLE_O_TOKEN\",\"fingerprint\":\"pc-loja-01\"}"
     ```
- **Confirmação:** a resposta traz um `lease` (texto longo) e, minutos depois, a loja aparece **🟢 online** no painel **`/frota`** da nuvem.

### Passo 12 — Confiar o certificado nos aparelhos clientes

- **Ação:** fazer cada aparelho (KDS/PDV/Ponto) confiar no certificado do servidor.
- **Onde:** em **cada** equipamento cliente (Windows), no gerenciador de certificados.
- **Como:**
  1. Copie o arquivo **`edge\certs\ca.pem`** para o aparelho.
  2. Abra **`certlm.msc`** → *Autoridades de Certificação Raiz Confiáveis* → *Certificados* → clique direito → *Todas as tarefas → Importar* → selecione o `ca.pem`.
- **Confirmação:** o certificado "Regem Edge CA" aparece na lista de raízes confiáveis.

### Passo 13 — Apontar os aparelhos para o servidor

- **Ação:** abrir o Regem nos aparelhos apontando para o servidor local.
- **Onde:** o navegador de cada aparelho, **na mesma rede WiFi/cabo** do servidor.
- **Como:** abra **`https://regem.local:3001`** (se o aparelho resolver mDNS) ou **`https://192.168.1.2:3001`** (o IP do passo 8).
- **Confirmação:** a tela abre **com cadeado** (sem aviso de segurança) e, em `/api/v1/ping`, retorna o JSON. A câmera do Ponto e o modo offline passam a funcionar.

---

## Manutenção do dia a dia

- **Ver logs:** abra `C:\regem-edge\backend\logs\` (arquivos `RegemEdgeApi.log` / `RegemEdgeSync.log`).
- **Parar/iniciar:** PowerShell (Admin) → `nssm stop RegemEdgeApi` / `nssm start RegemEdgeApi`.
- **Atualizar versão (automatizado — Fase E-D):**
  1. **Na sua máquina:** publique a versão com `.\edge\publicar.ps1 -Versao 1.4.0` — ele empacota, calcula o **SHA-256** e imprime as 3 variáveis (`EDGE_LATEST_VERSION` / `EDGE_UPDATE_URL` / `EDGE_UPDATE_SHA256`) para colar no `regem-api` (suba o `.zip` para um HTTPS que a loja acesse).
  2. **O edge da loja avisa sozinho** (o daemon loga `⬆️ atualização disponível` em até 1h e grava em `sync_state`).
  3. **Automático (Fase E-D · G-7):** o instalador cria a tarefa agendada **`RegemEdgeUpdate`** (roda todo dia às **04:00** como SYSTEM). Ela executa o `atualizar.ps1`, que **confere o SHA-256**, faz **backup do banco (pg_dump) e do código**, para os serviços, troca os arquivos, roda as migrations, sobe de novo e faz **health-check no /ping**; se algo falhar, faz **rollback do código** sozinho. Se não houver versão nova, sai em silêncio.
  4. **Manual (quando quiser aplicar na hora):** como Admin, `.\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend"` (o mesmo que a tarefa roda).

## Atalho: instalador de um clique (opcional)

Existe um instalador **Inno Setup** (`edge\regem-edge.iss`) que empacota tudo isso
num assistente `.exe`. Ele ainda precisa ser **compilado e validado num Windows
real** — enquanto isso, use este guia manual, que faz exatamente os mesmos passos.
