# Migração da sessão: JWT em localStorage → cookie httpOnly

> Objetivo: tirar o token do `localStorage` (legível por JS → roubável por XSS) e
> guardá-lo num **cookie httpOnly** na NUVEM. O **edge** (LAN/HTTP) e as integrações
> continuam no **Bearer**. Feito em 2 fases para não arriscar lockout.

## Por que 2 fases
O front hoje faz duas coisas com o token do `localStorage`, ambas síncronas:
1. **Decodifica** o JWT no cliente para os gates de UI (`getCategoria`, `getPermissoes`, `getUnidadeFixa`, `getNome`, `getFuncaoNome`) — centralizado em `lib/api.ts`.
2. **Presença = "estou logado?"**: **53 telas** fazem `if (!getToken()) router.replace('/entrar')`.
3. O **socket.io** manda o JWT no handshake (`lib/rt.ts`: `auth:{ jwt: getToken() }`).

No modo cookie o JS **não** tem o token → (1) precisa vir de `/auth/me`, (2) a presença precisa considerar o cookie, (3) o socket precisa autenticar pelo cookie. Trocar isso tudo de uma vez, sem poder testar o cookie cross-subdomínio localmente, arriscaria travar todos os logins. Por isso a Fase A é aditiva e verificável, e a Fase B é o cutover.

## Fase A — ENTREGUE (aditiva, sem mudança de comportamento)
Backend:
- `auth/cookie-sessao.ts`: grava/lê/limpa o cookie `regem_sess` (httpOnly, `SameSite=Lax`, `Secure` em prod, `Domain` via `COOKIE_DOMAIN`, 12h = TTL do JWT).
- `auth.controller.ts`: `login`/`register` **também** setam o cookie (via `@Res passthrough`); novos `POST /auth/logout` (apaga o cookie) e `GET /auth/me` (identidade `cat/nome/func/perm/uni/perfil`).
- `jwt-auth.guard.ts`: aceita **Bearer OU cookie** (header tem prioridade); enriquece `req.user` com `nome/func/perfil` (só-exibição).
- `main.ts`: CORS com `credentials: true` na lista fixa da nuvem (o edge `*` não pode ter credenciais).

Frontend (`lib/api.ts`):
- `req()` manda `credentials:'include'` na nuvem (estabelece/envia o cookie) e `same-origin` no edge.
- `estabelecerSessao()` (costura única de login) — na Fase A só faz `setToken` (Bearer segue conduzindo).
- `sair()` chama `POST /auth/logout` (apaga o cookie) + limpa local. Shell usa `sair()`.
- `lerPayload()` lê do JWT (se houver) OU do `/auth/me` guardado (`regem_me`) — pronto para a Fase B; hoje sempre há token, então nada muda.

**Efeito:** nenhum comportamento muda (o Bearer conduz a sessão); o cookie fica **estabelecido e verificável** em produção.

### Verificar em produção (após o deploy)
1. Faça login em `https://app.dmsregem.com`.
2. DevTools → Application → Cookies → `https://api.dmsregem.com`: deve existir `regem_sess` com **HttpOnly ✔, Secure ✔, SameSite=Lax**.
3. Confirme que o app funciona normal (o Bearer ainda conduz).
4. Se o cookie **não** aparecer: conferir `CORS_ORIGIN` (lista fixa, sem `*`) e, se `app.` e `api.` precisarem compartilhar, setar `COOKIE_DOMAIN=.dmsregem.com` no `regem-api`. Sem o cookie, a Fase B não deve ser ligada.

## Fase B — ENTREGUE (cutover cookie-only, AUTO-PROTEGIDO)

Ligado por padrão na nuvem, mas **só entra em cookie-only quando o cookie comprovadamente funciona** — senão cai no Bearer (sem lockout). O que foi feito:
1. **`getJwt()` (token real) separado de `getToken()` (presença):**
   - `getJwt()`: JWT real ou null → `lerPayload` (decode), Bearer do `req()`/`uploadFile`/`pontoEspelhoPdfUrl`, e `rt.ts`.
   - `getToken()` = `getJwt() ?? (lerMe() ? 'cookie' : null)` → os **53 gates `if (!getToken())` ficam intactos** (valem nos dois modos).
2. **`estabelecerSessao` (nuvem):** sonda `GET /auth/me` sem Bearer; se 200 → `clearToken()` (token só no cookie) + `guardarMe(me)`; se falhar → `setToken` (Bearer, auto-protegido).
3. **Socket (`rt.ts` + `RealtimeGateway`):** cliente manda `withCredentials:true` (nuvem) e `jwt` só se houver; o gateway lê **`auth.jwt` OU o cookie `regem_sess`** do handshake, e o CORS do WS ganhou `credentials:true` na lista fixa.
4. **Migração suave:** sessões antigas (localStorage) seguem no Bearer até o próximo login; novas viram cookie-only. Sem logout em massa.

**Validar em produção:** após o deploy, um login novo na nuvem deve deixar de gravar o JWT no `localStorage` (DevTools → Application → Local Storage: sem `regen_token`; só `regem_me`) e o app + **KDS/realtime** seguem funcionando (socket pelo cookie). Se algo falhar, o próprio login cai no Bearer; rollback = reverter o front (backend aceita os dois).

## Notas
- **CSRF:** `SameSite=Lax` barra POST cross-site; `app.→api.` é same-site (mesmo `dmsregem.com`) → o cookie vai nos XHR. Sem necessidade de token CSRF adicional no MVP.
- **Edge:** nada muda (Bearer/localStorage); `credentials` fica `same-origin`.
- **Distribuição** (`regem_dist_token`) e **Terminal/PIN** são realms à parte — seguem no Bearer.
