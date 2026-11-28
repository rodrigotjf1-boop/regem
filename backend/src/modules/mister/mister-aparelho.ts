// Versão 6, M6b, peça A1.0 (mig 484; `docs/plano-mister.md`): o hash do aparelho que a Meta manda quando o recurso
// "Identity change check" está ligado no número. Aqui só se LÊ: nenhuma regra de bloqueio nasce antes de a A1.0 medir o
// que muda o hash.

/** O tamanho e as letras de um hash aceitável: o que vier fora disso não é gravado. */
const HASH_VALIDO = /^[A-Za-z0-9+/=_-]{1,200}$/;

const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/**
 * O hash do aparelho de quem mandou a mensagem, em `contacts[].identity_key_hash`. Vale SÓ o contato com o `wa_id` de quem
 * mandou (ERR-648, rodada 7, MIS-A-12: antes, um contato único com outro `wa_id` também valia). Nenhum igual: `null`.
 */
export function hashDoRemetente(contatos: unknown, de: unknown): string | null {
  if (!Array.isArray(contatos) || !contatos.length) return null;
  const remetente = digitos(de);
  const dele = remetente ? contatos.find((c) => digitos((c as any)?.wa_id) === remetente) : null;
  const hash = (dele as any)?.identity_key_hash;
  if (typeof hash !== 'string') return null;
  const limpo = hash.trim();
  return HASH_VALIDO.test(limpo) ? limpo : null;
}

/**
 * As duas formas do corpo que a doc oficial da Meta mostra para o mesmo ajuste: a página "Phone Numbers" usa
 * `enable_identity_key_check` e a referência de `/settings` usa `enabled`. Tenta na ordem; só passa à seguinte quando a
 * Meta recusa o corpo (HTTP 400).
 */
export const corposDaConferencia = (ligado: boolean): Array<{ user_identity_change: Record<string, boolean> }> => [
  { user_identity_change: { enable_identity_key_check: ligado } },
  { user_identity_change: { enabled: ligado } },
];
