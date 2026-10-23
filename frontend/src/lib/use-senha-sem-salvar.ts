'use client';

import { useEffect, useState } from 'react';
import { camposDaSenhaSemSalvar, navegadorTemMascara, type CamposDaSenha } from './senha-sem-salvar';

/**
 * As propriedades do campo da senha de autorização (ver `senha-sem-salvar.ts`), para espalhar no `<input>`/`<Input>`.
 * O diálogo que pede a senha abre depois de um clique, já no navegador: o campo nasce texto mascarado. Se um dia ele for
 * desenhado no servidor, nasce senha e vira texto logo depois de montar.
 */
export function useSenhaSemSalvar(): CamposDaSenha {
  const [mascara, setMascara] = useState(navegadorTemMascara);
  useEffect(() => setMascara(navegadorTemMascara()), []);
  return camposDaSenhaSemSalvar(mascara);
}
