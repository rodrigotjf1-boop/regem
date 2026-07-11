# Regem Edge — gerar o instalador `.exe` (um clique)

> Você faz isto **uma vez** (ou a cada nova versão), **na sua máquina**. O resultado
> é um único **`RegemEdgeSetup.exe`** que a loja executa: ele faz **tudo local
> sozinho** e só pede 3 dados da nuvem numa tela. Formato: **Ação · Onde · Como · Confirmação**.

---

## Passo 1 — Gerar o pacote do app

- **Ação:** compilar e montar a pasta distribuível.
- **Onde:** terminal na pasta `backend`.
- **Como:**
  ```bash
  npm ci
  npm run build
  node edge/package.mjs
  ```
- **Confirmação:** existe `..\regem-edge-dist` com `dist\main.js` e a pasta `edge`.

## Passo 2 — Baixar os binários portáteis (para não exigir nada pré-instalado)

- **Ação:** juntar Node, PostgreSQL e NSSM portáteis dentro de `edge\bundle\`.
- **Onde:** a pasta `backend\edge\bundle\` (crie-a).
- **Como:** baixe e extraia para estes 3 subdiretórios:
  - `edge\bundle\node\` → **Node.js Windows Binary (.zip x64)** de <https://nodejs.org/en/download> (o conteúdo do zip, com `node.exe` e `npm.cmd` na raiz dessa pasta).
  - `edge\bundle\pgsql\` → **PostgreSQL Binaries (.zip)** da EnterpriseDB (<https://www.enterprisedb.com/download-postgresql-binaries>) — deve conter `bin\initdb.exe` e `bin\postgres.exe`.
  - `edge\bundle\nssm\` → **`nssm.exe`** de <https://nssm.cc/download> (o `nssm.exe` de 64 bits direto nessa pasta).
- **Confirmação:** existem `edge\bundle\node\node.exe`, `edge\bundle\pgsql\bin\initdb.exe` e `edge\bundle\nssm\nssm.exe`.

> **Opcional:** se pular este passo, o instalador ainda funciona, mas **exige** Node/Postgres/NSSM já instalados no PC da loja. Com o bundle, não exige nada.

## Passo 3 — Editar as 2 constantes do instalador

- **Ação:** apontar o instalador para a sua nuvem e embutir a chave pública da licença.
- **Onde:** arquivo `backend\edge\regem-edge.iss`, no topo (`#define`).
- **Como:** ajuste:
  - `MyCloudApi` → a URL da sua API (padrão `https://api.dmsregem.com/api/v1`).
  - `MyLicensePubKey` → cole o **`LICENSE_PUBLIC_KEY_B64`** (o valor **público**, gerado por `node scripts/gen-license-keys.mjs`). **Não** é segredo e é o mesmo para todas as lojas.
- **Confirmação:** as duas linhas não têm mais os textos de exemplo (`COLE_AQUI...`).

## Passo 4 — Compilar no Inno Setup

- **Ação:** transformar tudo isso num único `.exe`.
- **Onde:** o programa **Inno Setup** (baixe em <https://jrsoftware.org/isdl.php> e instale).
- **Como:** abra o `backend\edge\regem-edge.iss` no Inno Setup → menu **Build → Compile** (ou `Ctrl+F9`).
- **Confirmação:** aparece `RegemEdgeSetup.exe` na pasta `Output\` (ao lado do `.iss`). Sem erros em vermelho.

## Passo 5 — Usar na loja (o "um clique")

- **Ação:** instalar o servidor local no PC da loja.
- **Onde:** o PC da loja (leve o `RegemEdgeSetup.exe` por pen drive/rede).
- **Como:** duplo-clique → aceite o **UAC** (Administrador) → na tela **"Dados desta loja"** preencha:
  - **ID da unidade** e **Token do servidor local** (Cadastros → Equipamentos, tipo `servidor_local`);
  - **Token de ativação da licença** (tela `/frota`) — opcional, dá pra ativar depois.
  
  Clique **Instalar** e aguarde (Postgres, banco, certificado, serviços, migrations — tudo automático).
- **Confirmação:** ao final, o log diz `CONCLUIDO` e mostra o endereço `https://<IP>:3001`. Abra `https://localhost:3001/api/v1/ping` → retorna o JSON. A loja aparece **🟢 online** em `/frota`.

---

## O que ainda é manual (e por quê)

- **Confiar o certificado nos OUTROS aparelhos** (KDS/PDV/Ponto): cada aparelho é uma máquina diferente, então o `ca.pem` (em `C:\regem-edge\backend\edge\certs\`) precisa ser importado neles (passo 12 do `INSTALL-WINDOWS`). O instalador só confia **na máquina do servidor**.
- **Os 3 dados da nuvem**: são o que identifica e autoriza a loja — não dá para adivinhar. Todo o resto é automático.

## Atualizações

Depois de instalado, use `edge\publicar.ps1` (na sua máquina) + `edge\atualizar.ps1` (na loja) — veja `INSTALL-WINDOWS.md` › "Atualizar versão".
