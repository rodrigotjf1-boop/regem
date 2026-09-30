import { telefoneValido } from './validadores-br';

/**
 * Telefone BRASILEIRO em E.164 (`+5521999998888`) — ou `null` quando não dá para ter certeza.
 *
 * A base mistura formatos: o cardápio grava como veio (só dígitos, às vezes com o 55), a
 * importação tira o 55, marketplace nem tem número real. Aqui: só os dígitos; `0055…` e
 * `55…` (12–13 dígitos) perdem o código do país; `00` seguido de outro país → `null`; o 0 de
 * longa distância cai; o que sobra tem de ser DDD + número válidos (`telefoneValido`: DDD ≥ 11 e
 * celular de 11 dígitos começando por 9). NÃO inventa o nono dígito: a base tem as duas formas
 * (LIC-068) e um número de 10 dígitos sai como veio — ligar a pessoa errada é pior do que não ligar.
 */
export function telefoneE164(bruto: unknown): string | null {
  if (bruto === null || bruto === undefined) return null;
  let d = String(bruto).replace(/\D/g, '');
  if (!d || d.length > 15) return null;
  if (d.startsWith('00')) {
    if (!d.startsWith('0055')) return null; // discagem internacional para fora do Brasil
    d = d.slice(4);
  } else if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  } else if (d.startsWith('0')) {
    d = d.slice(1); // 0 de longa distância antes do DDD
  }
  return telefoneValido(d) ? `+55${d}` : null;
}
