# Regem Edge — Appliance de loja, distribuição por revenda e segurança

> Consolida as decisões (2026-07-10) para transformar o **servidor edge já existente**
> (`backend/edge/sync-daemon.mjs` + módulo `sync`, ver [[arquitetura-edge]]) num
> **appliance instalável e revendável**, 100% offline na loja, com controle central.
> Regras de sempre ([[seguranca-continua]]): RBAC no servidor, tenant forçado,
> nada de baixa/estorno sem `ref_*`, segredos fora do código.

## 0.5. Modelo de distribuição por ramo (decidido 2026-07-11)

- **1 instalador ÚNICO** (mesma base de código multi-ramo). O **ramo + plano +
  módulos** vêm no **token de ativação**; o provisionamento aplica e o wizard
  configura a loja. NÃO fazer instaladores por ramo.
- **Ramo e módulos = ENTITLEMENTS PAGOS**, carregados no **lease assinado**.
  Adicionar ramo/módulo = **upgrade** (muda na nuvem → desce no lease). Unifica
  licença + enforcement de módulos + cobrança + ramo.
- **A REVENDA define o ramo/plano no ato da venda** (emite o token na tela
  Revenda & frota → `/frota`).
- **Lançamento: SÓ food service** agora (único ramo maduro); os outros ficam
  "em breve" e entram como upgrade.
- Efeito no "trocar ramo" de hoje: deixa de ser toggle livre → vira
  **entitlement** (loja só usa o ramo contratado); o wizard vira o assistente de
  config do ramo já ativado.

## 0.6. Status de implementação (2026-07-11)

- **E-A** (mDNS `regem.local` + `/ping`): ✅ na main. HTTPS local via cert do
  edge (`EDGE_TLS_CERT/KEY` em `main.ts`) + `edge/gen-cert.mjs`: ✅ (validar num PC).
- **E-B** (lease assinado Ed25519 + entitlements + provisionamento por token +
  binding de device + grace + anti-rollback): ✅ backend (`modules/licenca`),
  migration 082. Chaves: `LICENSE_PRIVATE_KEY_B64`/`LICENSE_PUBLIC_KEY_B64`/`LICENSE_KID`.
- **E-C** (heartbeat + painel de frota + emitir token/suspender/reativar/rebind):
  ✅ backend + tela `/frota` (presidente); daemon envia heartbeat + busca lease.
- **E-D** (pipeline de update assinado/blue-green/backup-antes-de-migrar) e
  **E-E** (empacotamento Windows + Postgres embutido + NSSM): pendentes (precisam
  de um PC de loja para validar).

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

## 5.5. Revisão multi-especialista — acréscimos (controle de revenda + atualizações)

**🛡️ Segurança**
- **Rotação de chaves com `kid`:** o lease e os pacotes de update carregam um **key id**; o edge aceita **N chaves públicas** → se a privada vazar, rotaciona sem visitar loja.
- **Anti-rollback de relógio:** o edge guarda o **último "server time" visto**; recusa se o relógio local voltar (impede esticar lease offline mexendo na data). + **NTP** no appliance.
- **Segredos em repouso cifrados** (device token, chaves) via **DPAPI do Windows** (não em texto puro).
- **Pinning** do certificado da nuvem no daemon (anti-MITM no sync) + **auditoria** de toda suspensão/reativação/rebind.

**🚀 Atualizações (o ponto que mais facilita a revenda)**
- **Pacotes de update ASSINADOS** (mesma confiança assimétrica da licença) → edge só instala update verificado.
- **Canais** (stable/beta) + **rollout escalonado** (canary em poucas lojas antes de liberar geral) + **pin de versão** por loja/revenda.
- **Update blue-green + rollback:** instala a nova versão ao lado, troca, **mantém a anterior**; se o health-check pós-update falhar, **volta sozinho**.
- **Migração segura no banco local:** antes de migrar, **backup automático**; aplica idempotente; **health-check**; falhou → **restaura**. (Migrar o Postgres da loja sem rede de segurança = risco de perda de dados.)
- **Janela de atualização** configurável (não atualizar no pico) + **skew de versão tolerante** no sync (edge numa versão anterior à nuvem não quebra).

**📡 Telemetria de frota (torna o suporte da revenda viável)**
- Cada edge manda **heartbeat** pra nuvem: **versão, status da licença, último sync, disco, nº de clientes, erros**.
- **Portal da revenda** vira um **painel de frota**: lojas online/offline (há quanto tempo), versão de cada uma, updates que falharam, licenças a vencer. **Logs remotos opt-in** para diagnosticar sem ir à loja.

**🎛️ Ações remotas (assinadas) no portal**
- Suspender/reativar, **forçar sync**, **forçar update**, **reemitir/rebind** (troca de PC), reiniciar serviços, puxar logs. Toda ação **assinada** (a nuvem manda comando; o edge verifica a assinatura → não vira porta de ataque).

**🧰 Suporte de campo**
- **Recuperação zero-touch:** PC morreu → restaura backup da nuvem + **rebind do token** → novo PC no ar rápido.
- **Instalação offline com ativação diferida:** instalador roda sem internet (tudo embutido) e **ativa depois** por código/quando a rede voltar.
- **Página `/status` local** no edge: sync, licença, impressoras, clientes conectados, disco — para o técnico conferir na loja.
- Instalador **abre a porta 3001 só na LAN** no Firewall do Windows (nunca expõe à internet); **rotação de logs** + `vacuum` do Postgres agendados.

**💳 Entitlements na própria licença (unifica licença + módulos + monetização)**
- O **lease carrega o pacote de entitlements** (quais módulos a loja pagou: KDS, Ponto, cashback, fidelidade, integrações…). O edge **aplica localmente** → resolve de uma vez a **licença**, o **enforcement dos módulos ativáveis** (hoje só o bot respeita) e a **cobrança por plano**. Inadimplência/plano muda na nuvem → desce no lease. **Modo trial** = lease de validade curta para demonstração.

## 6. Pendências remodeladas (prioridade)

**🔴 Foco atual — Edge como produto revendável**
1. **E-A · mDNS + `/ping` + cert local** (mini-CA no edge; passo do instalador que confia o cert). *(testável sem hardware)*
2. **E-B · Licença por lease assinado + entitlements + provisionamento por token** (nuvem assina com `kid`; edge verifica com chave pública; binding device; grace offline; **anti-rollback de relógio**; o lease **carrega os módulos pagos** → aplica licença + enforcement de módulos). *(testável na nuvem)*
3. **E-C · Telemetria de frota + portal de revenda** (heartbeat: versão/status/último sync/disco; painel de lojas; emitir/suspender/rebind; **ações remotas assinadas**; logs opt-in). *(testável na nuvem)*
4. **E-D · Pipeline de update seguro**: pacotes **assinados**, canais stable/beta, **rollout escalonado**, **blue-green + rollback**, **backup-antes-de-migrar + health-check** no Postgres local, janela de atualização. *(código; validação num Windows real)*
5. **E-E · Empacotamento**: serviços NSSM + **Postgres portátil embutido** + instalador Inno Setup + Firewall LAN-only + segredos via DPAPI + instalação offline c/ ativação diferida. *(scripts; validação num Windows real)*
6. **E-F · Fila offline (IndexedDB) + SW** nos PWAs (KDS/PDV/Garçom) + página `/status` local.
7. **E-G · Recuperação zero-touch** (backup/restore pela nuvem + rebind) + QR de setup + rotação de logs/vacuum.

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

**E-A → E-B → E-C primeiro** (tudo codável/testável sem PC de loja):
1. **E-A**: mDNS advertiser no edge + rota `/ping`; mini-CA + cert local (gera na 1ª subida; expõe o CA p/ o instalador confiar).
2. **E-B**: emissão/verificação do **lease assinado com `kid` + entitlements**, provisionamento por token, binding device, grace + anti-rollback de relógio.
3. **E-C**: heartbeat do edge → **painel de frota** no portal de revenda + ações remotas assinadas.

Depois **E-D/E-E** (update pipeline + empacotamento — precisam de um Windows real pra validar) e **E-F/E-G**.
