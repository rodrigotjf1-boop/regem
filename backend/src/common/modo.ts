// "Este processo é o SERVIDOR LOCAL da loja?" — UM lugar para a pergunta.
//
// O instalador grava `EDGE_MODE=true` (instalar-tudo.ps1). Duas proteções comparavam com '1'
// (`process.env.EDGE_MODE === '1'`) e NUNCA disparavam na loja: o código seguia para tabelas que
// só existem na nuvem (reproduzido set/2026 — ver o registro interno de erros). Use isto em código
// novo; `true`/`TRUE`/` true ` e `1` valem (o `1` por compatibilidade com quem já configurou assim).
export function ehServidorLocal(): boolean {
  const v = String(process.env.EDGE_MODE ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}
