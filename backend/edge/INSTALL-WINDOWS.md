# Regem Edge — instalar num PC de loja (Windows)

O **servidor edge é o próprio backend do Regem** rodando **localmente** com um
**Postgres local** + o **daemon de sync**. Este guia instala o appliance num PC
de teste. Arquitetura: `docs/arquitetura-edge.md` e `docs/edge-distribuicao-revenda.md`.

> **É um instalador à parte** (o app da nuvem fica no EasyPanel). Mesma base de
> código, configuração local. Um edge = **uma loja**.

---

## 0. Gerar o pacote (na sua máquina de dev)

```bash
cd backend
npm ci
npm run build
node edge/package.mjs        # cria ../regem-edge-dist/
```

Copie a pasta **`regem-edge-dist/`** para o PC da loja (ex.: `C:\regem-edge\backend`).

---

## 1. Pré-requisitos no PC da loja

1. **Node 20+** — https://nodejs.org (LTS).
2. **PostgreSQL 15+** — https://www.postgresql.org/download/windows/ (instalador EDB).
   - Anote a senha do usuário `postgres` e mantenha a porta **5432**.
   - *(Alternativa "embutida": usar os binários portáteis do Postgres — fica para o instalador `.exe` final.)*
3. **NSSM** — https://nssm.cc/download (coloque `nssm.exe` no PATH).
4. **OpenSSL** — já vem no Git for Windows (`C:\Program Files\Git\usr\bin`), ou instale à parte (para gerar o cert local).

---

## 2. Preparar o banco local

```powershell
cd C:\regem-edge\backend
npm ci --omit=dev

# cria o banco (uma vez)
node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:'postgresql://postgres:SENHA@localhost:5432/postgres'});await c.connect();await c.query('create database regem_local').catch(()=>{});await c.end()})()"
```

---

## 3. Configurar o `.env.local`

Copie `edge\.env.local.example` para `backend\.env.local` e preencha:
- `DATABASE_URL` / `EDGE_DATABASE_URL` → sua senha do Postgres.
- `JWT_SECRET` → um segredo forte.
- `EDGE_MODE=true`, `EDGE_UNIDADE_ID` → id da unidade (loja).
- `SYNC_TOKEN` → token do equipamento **`servidor_local`** (cadastre em **Cadastros → Equipamentos** na nuvem e cole aqui).
- `LICENSE_PUBLIC_KEY_B64` → a **chave pública** da nuvem (para validar o lease offline).

Aplique as migrations no banco local:
```powershell
node scripts\apply-all-local.mjs
```

---

## 4. Cert local (HTTPS na LAN, sem internet)

Descubra o IP do PC (`ipconfig` → IPv4, ex.: `192.168.1.2`) e gere o cert:
```powershell
node edge\gen-cert.mjs 192.168.1.2
```
Saída em `edge\certs\` (`ca.pem`, `server.crt`, `server.key`).
- **Confie o `ca.pem`** em cada equipamento cliente (KDS/PDV/Ponto): `certlm.msc` → *Autoridades de Certificação Raiz Confiáveis* → Importar.
- Aponte `EDGE_TLS_CERT`/`EDGE_TLS_KEY` no `.env.local` para `server.crt`/`server.key`.

> **Dica de IP fixo:** reserve o IP do PC no roteador (reserva DHCP) para não mudar.

---

## 5. Subir como serviços do Windows (auto-start)

PowerShell **como Administrador**:
```powershell
cd C:\regem-edge\backend
.\edge\instalar-servicos.ps1 -Raiz "C:\regem-edge\backend"
```
Registra **RegemEdgeApi** (backend) + **RegemEdgeSync** (daemon), libera a porta **3001 só na LAN** e sobe tudo no boot.

Verifique:
```
https://localhost:3001/api/v1/ping   →  { "regem": true, "edge": true, ... }
```

---

## 6. Apontar os clientes (KDS/PDV/Ponto)

Nos aparelhos da **mesma rede**, abra:
- `https://regem.local:3001` (se o SO resolver mDNS — Windows/iOS), ou
- `https://192.168.1.2:3001` (IP fixo).

O `/api/v1/ping` confirma que acharam o servidor. Câmera (Ponto) e Service Worker
funcionam por causa do **cert local confiado** (passo 4).

---

## 7. Ativar a licença (revenda)

1. Na nuvem, tela **`/frota`** (presidente): **Emitir token** para a loja (tenantId, ramo=food service, plano, módulos).
2. No PC da loja, ative:
```powershell
curl -X POST https://localhost:3001/api/v1/provisionamento/ativar -H "content-type: application/json" -d "{\"token\":\"SEU_TOKEN\",\"fingerprint\":\"pc-da-loja-01\"}"
```
O `fingerprint` prende a licença a este equipamento (anti-clonagem). O daemon
passa a renovar o **lease** e mandar **heartbeat** (aparece no painel `/frota`).

---

## Serviço / manutenção
- Logs: `C:\regem-edge\backend\logs\`.
- Parar/iniciar: `nssm stop RegemEdgeApi` / `nssm start RegemEdgeApi`.
- Atualizar: substitua `dist\` (novo build) + rode `node scripts\apply-all-local.mjs` + reinicie os serviços. *(A automação disso é a Fase E-D — update assinado/blue-green.)*

## Ainda pendente (Fase E-E final)
Instalador **`.exe` de um clique** (Inno Setup) com **Postgres portátil embutido**
e os serviços já registrados — empacota tudo acima num assistente. Este guia
manual/scriptado já permite **testar num hardware real** agora.
