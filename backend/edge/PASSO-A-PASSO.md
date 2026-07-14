# Atualizar o servidor edge — passo a passo

Só os passos. A explicação da lógica está em `ATUALIZAR.md`.

---

## A) PUBLICAR a versão (na SUA máquina, uma vez por versão)

1. Atualize o código e confira o build:
   ```bash
   git pull origin main
   cd backend && npm run build
   cd ../frontend && npm run build
   ```
   Confirma: os dois terminam sem erro.

2. Gere o pacote (troque `1.4.0` pela versão nova, sempre maior que a atual):
   ```powershell
   cd backend
   .\edge\publicar.ps1 -Versao 1.4.0
   ```
   Confirma: criou `regem-edge-1.4.0.zip` (ao lado de `backend`) e imprimiu o **SHA-256**. Copie o SHA.

3. Hospede o `.zip` num HTTPS público (Supabase Storage):
   1. Supabase → seu projeto → **Storage** → **New bucket**.
   2. Name: `edge-updates` · ligue **Public bucket** → **Create bucket**. *(só na 1ª vez)*
   3. Abra `edge-updates` → **Upload file** → selecione `regem-edge-1.4.0.zip`.
   4. Clique no arquivo → **Copy URL**.
   Confirma: cole a URL numa aba anônima — o download começa sem pedir login.

4. Anuncie a versão às lojas — EasyPanel → serviço **`regem-api`** → aba **Environment**:
   ```
   EDGE_LATEST_VERSION = 1.4.0
   EDGE_UPDATE_URL     = <a URL do .zip copiada no passo 3>
   EDGE_UPDATE_SHA256  = <o SHA copiado no passo 2>
   EDGE_UPDATE_NOTAS   = O que mudou (opcional)
   ```
   Depois clique **Deploy**.
   Confirma: abra `https://api.dmsregem.com/api/v1/edge/update-check?versao=0` → mostra `"ultima":"1.4.0"` e `"atualizar":true`.

Pronto — as lojas já enxergam a versão nova.

---

## B) APLICAR na loja

### Pelo app (recomendado)
1. Abra o app no servidor da loja (`https://localhost:3001`) → menu **Servidor local**.
2. Card "Atualização do servidor" → **Verificar atualização**.
3. Aparecendo a versão nova → **Instalar atualização** → confirme.
4. Aguarde 1–2 min e recarregue (Ctrl+Shift+R).
   Confirma: a "Versão instalada" já é a nova.
   ⚠️ Reinicia os serviços por 1–2 min (KDS/PDV/ponto fora) — faça com a loja fechada.

### Pelo script (alternativa)
1. Abra o **PowerShell como Administrador** no PC da loja.
2. Rode:
   ```powershell
   C:\regem-edge\backend\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend"
   ```
3. Confirma: termina com `OK! Atualizado para 1.4.0`. Cheque os serviços:
   ```powershell
   Get-Service RegemEdge*
   ```
   → todos **Running**.
