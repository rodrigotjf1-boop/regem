# Regem Edge — Appliance de loja, distribuição por revenda e segurança

> Consolida as decisões (2026-07-10) para transformar o **servidor edge já existente**
> (`backend/edge/sync-daemon.mjs` + módulo `sync`, ver [[arquitetura-edge]]) num
> **appliance instalável e revendável**, 100% offline na loja, com controle central.
> Regras de sempre ([[seguranca-continua]]): RBAC no servidor, tenant forçado,
> nada de baixa/estorno sem `ref_*`, segredos fora do código.

## 1. Segurança (transversal — vem embutida em tudo)

**Banco local (Postgres na loja):**
- **Um edge = um tenant** → o banco local só tem os dados **daquela loja** (sem vazamento entre lojas, mesmo com acesso físico ao PC).
- Postgres **bind em localhost/LAN**, nunca exposto à internet; senha **gerada** na instalação (não fixa/no código); backups **cifrados** (restore pela nuvem).
- **Controle não é confiável no local:** dados de controle (preços, fichas, entitlements, RBAC) **descem da nuvem** e **a nuvem vence** no conflito → edição local maliciosa é **sobrescrita no próximo pull**.

**Licença anti-burla (o ponto crítico da revenda):**
- A licença **não é uma flag no banco** (seria trivial de editar). É um **lease assinado pela nuvem** (JWT **assimétrico**: nuvem assina com a **chave privada**; o edge só tem a **chave pública** de verificação → **não consegue forjar** licença).
- Lease com **validade curta** (ex.: 30 dias), **renovado a cada sync**. Vencido → edge entra em **somente-leitura/bloqueado** após o grace.
- **Binding token→device:** o token de ativação prende na **1ª ativação** a um fingerprint do equipamento → **não dá pra clonar** a mesma licença em N instalações (a nuvem recusa reuso).
- **Revogação:** revenda/nós suspende na nuvem → próximo sync marca `suspenso` → bloqueia após grace. Loja **genuinamente offline** não é brickada no meio do turno (grace), mas também **não roda pra sempre** revogada.

**Sync seguro (já implementado, manter/endurecer):**
- Endpoints `/sync/*` com **token de dispositivo `servidor_local`**, **tenant forçado**, **whitelist de tabela+coluna**, **idempotência** e **redação de segredos** no pull.
- Adicionar: **rate-limit** por device, **assinatura do lease** no pull, e **log de auditoria** de cada suspensão/reativação.

## 2. Descoberta na LAN + HTTPS — 100% offline, SEM subdomínio

*(Subdomínio público foi descartado: dependeria de internet p/ DNS/cert, contra o offline-first.)*

- **Descoberta = mDNS no edge** (processo Node anuncia `regem.local` + serviço `_regem._tcp`); o **SO do equipamento cliente** resolve (Windows/macOS/iOS nativos). Fallback: **QR/IP** no setup + **IP fixo/reserva DHCP**. Tudo local, sem internet.
- **HTTPS = cert local do edge:** mini-CA própria do edge, cert cobrindo `regem.local` **e o IP** (SAN), validade longa. O **instalador confia esse cert** no Windows de cada equipamento provisionado → `https://regem.local:3001` com cadeado válido, **Service Worker e câmera funcionando na LAN, sem internet**.

## 3. Clientes: formato e carga

Servir os clientes da loja é **carga ínfima** (dezenas de req/s + WebSockets) — HTTP vs HTTPS não pesa. A escolha é por **contexto seguro** (SW offline + câmera), e como o cert local já é confiado, **HTTPS em todos sai de graça**:

| Cliente | Formato | Motivo |
|---|---|---|
| **KDS** | PWA + cert local | tempo real + SW (tela não apaga num blip de WiFi); sem câmera |
| **PDV / Garçom** | PWA + cert local | **fila offline (IndexedDB)** = não perde venda |
| **Ponto (kiosk)** | PWA + cert local *(ou app empacotado)* | **câmera** obriga HTTPS; app nativo só se quiser lockdown de quiosque |
| **App do Colaborador** | **Nuvem** | é móvel/fora da loja — não é cliente do edge |

## 4. App do Colaborador (modelo definido)

- **É cliente da NUVEM**, não do edge.
- **Ao entrar na rede da loja:** sincroniza/atualiza (o edge já subiu as mudanças operacionais pra nuvem via Sync; a nuvem reflete e o app puxa o estado fresco).
- **Fora da rede:** recebe **atualizações pontuais pertinentes ao seu perfil** (escala, tarefas, avisos, RBAC) — as que nasceram na loja e **subiram pelo Sync (LAN→nuvem)** e as que nascem na nuvem (controle). Ou seja, o Sync é a ponte: o que muda na loja chega ao app pela nuvem.

## 5. Instalador / distribuição por revenda

**Appliance Windows** (`.exe` via Inno Setup/NSIS):
- **Bundla:** Node runtime + backend (build) + **Postgres portátil embutido** + daemon de sync.
- **Auto-start:** backend + daemon + Postgres como **serviços do Windows** (NSSM/node-windows) — sobem no boot, **sem terminal**.
- **Postgres embutido** (binários portáteis, pasta de dados local). *Fallback:* instalação silenciosa do Postgres oficial (`--mode unattended`) OU passo a passo no doc.
- **Provisionamento por token:** o instalador pede o **token de ativação** (emitido por nós/revenda) → cria DB, aplica migrations (`apply-all-local.mjs`), grava o device token, gera/confia o cert local, sobe os serviços, faz o 1º sync.
- **Controle/revenda:** portal (na Visão C&O) emite/suspende tokens, vê instalações por revenda e status (ativo/suspenso/offline há X dias).
- **Auto-update:** o daemon checa um canal de release e atualiza o edge sozinho (ou sob comando) — revenda não visita a loja a cada versão.

## 6. Pendências remodeladas (prioridade)

**🔴 Foco atual — Edge como produto revendável**
1. **E-A · mDNS + `/ping` + cert local** (mini-CA no edge; passo do instalador que confia o cert). *(testável sem hardware)*
2. **E-B · Licença por lease assinado + provisionamento por token** (nuvem emite/assina/revoga; edge verifica com chave pública; binding device; grace offline). *(testável na nuvem)*
3. **E-C · Empacotamento**: serviços NSSM + Postgres portátil + instalador Inno Setup. *(código/scripts; validação num Windows real)*
4. **E-D · Portal de revenda** (emitir/suspender tokens, ver instalações) na Visão C&O.
5. **E-E · Fila offline (IndexedDB) + SW** nos PWAs (KDS/PDV/Garçom).
6. **E-F · Auto-update do edge** + backup/restore pela nuvem + QR de setup.

**🟡 Produto (fora do edge, já pedidos)**
7. **Hub de Relatórios** (financeiro, pedidos, operações de caixa, mais vendidos/ranking, faturamento por operador/tipo, histórico de turnos).
8. **Integrações marketplaces**: Open Delivery/Cardápio Web (PR #119, aguardando credenciais) → iFood (homologação) → Anota/99Food/GoTotem (parceria).
9. **Enforcement dos módulos ativáveis** (KDS/Ponto/App honrarem o on/off, além do bot).
10. **Pagamento online real** (plugar gateway) · **NFC-e/cupom fiscal**.

**🟢 Refinos**
11. PIN na tela de login · preview do template por ramo · snapshots de estoque p/ CMV preciso.

**⏸️ Externas/premium**
12. Fiscal de entrada DF-e (hub fiscal) · tiers premium (gamificação, dashboard analítico, IA, multiunidade).

## 7. Ordem para começar

**Fase E-A → E-B primeiro** (dá pra codar e testar sem PC de loja):
1. mDNS advertiser no edge + rota pública `/ping` (identifica o edge na LAN).
2. Mini-CA + cert local no edge (gera na 1ª subida; expõe o CA p/ o instalador confiar).
3. Emissão/verificação do **lease assinado** (nuvem assina; edge verifica) + endpoint de provisionamento por token + binding device + grace.

Depois **E-C** (empacotamento — precisa de um Windows real pra validar) e **E-D** (portal revenda).
