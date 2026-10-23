// Senha de AUTORIZAÇÃO sem o "Salvar senha?" do navegador. É a senha do gestor que libera, na hora, cancelar ou reabrir
// um pedido e despachar sem todas as estações — a senha de LOGIN do presidente ou do gerente, digitada no PC
// compartilhado da loja. O Edge oferecia guardá-la a cada liberação (pedido do dono, 22/10/2026), e guardada ela ficaria
// no perfil do caixa para quem viesse depois.
//
// O navegador só oferece guardar campo `type="password"`; `autocomplete="new-password"` impede PREENCHER, não guardar
// (ERR-252). Aqui o campo é TEXTO com a máscara de pontos do próprio navegador (`-webkit-text-security`, que o Edge, o
// Chrome e o Safari têm), pela regra `input[data-senha-sem-salvar]` de `globals.css`. Navegador sem a máscara fica com o
// campo de senha comum: a senha nunca aparece na tela. Regra conferida em `npm run check:senhas`.

export type CamposDaSenha = {
  type: 'text' | 'password';
  autoComplete: string;
  autoCorrect: 'off';
  autoCapitalize: 'off';
  spellCheck: false;
  'data-senha-sem-salvar'?: '';
};

/** As propriedades do campo da senha de autorização: texto mascarado quando o navegador tem a máscara. */
export function camposDaSenhaSemSalvar(temMascara: boolean): CamposDaSenha {
  const base = { autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false } as const;
  return temMascara
    ? { type: 'text', autoComplete: 'off', ...base, 'data-senha-sem-salvar': '' }
    : { type: 'password', autoComplete: 'new-password', ...base };
}

/** O navegador desenha a máscara de pontos num campo de texto? (fora do navegador, não) */
export function navegadorTemMascara(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc');
}
