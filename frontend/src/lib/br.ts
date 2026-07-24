// Máscaras e validação de documentos/contatos brasileiros (Fase 6).
// Espelha os validadores do backend (`common/validadores-br.ts`) — a regra vale
// nos dois lados: o front avisa cedo, o servidor é quem garante.

const dig = (v: string) => String(v ?? '').replace(/\D/g, '');

export const mascaraCnpj = (v: string) =>
  dig(v)
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');

export const mascaraCpf = (v: string) =>
  dig(v)
    .slice(0, 11)
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');

// 10 dígitos = fixo (0000-0000); 11 = celular (90000-0000).
export const mascaraTelefone = (v: string) => {
  const d = dig(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
};

export const mascaraCep = (v: string) => dig(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

export function cnpjValido(v: string): boolean {
  const c = dig(v);
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let pos = base.length - 7;
    for (const ch of base) {
      soma += Number(ch) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  return c.slice(12) === `${d1}${dv(c.slice(0, 12) + String(d1))}`;
}

export function cpfValido(v: string): boolean {
  const c = dig(v);
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (qtd: number) => {
    let soma = 0;
    for (let i = 0; i < qtd; i++) soma += Number(c[i]) * (qtd + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return Number(c[9]) === dv(9) && Number(c[10]) === dv(10);
}

export function telefoneValido(v: string): boolean {
  const t = dig(v);
  if (!/^\d{10,11}$/.test(t)) return false;
  if (Number(t.slice(0, 2)) < 11) return false;
  return !(t.length === 11 && t[2] !== '9');
}

export const cepValido = (v: string) => /^\d{8}$/.test(dig(v));
export const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());

// Máscara + validação + mensagem por tipo de campo. Usado pelo EntityForm.
export const CAMPOS_BR = {
  cnpj: { mascara: mascaraCnpj, valido: cnpjValido, erro: 'CNPJ inválido (confira os números).', modo: 'numeric' },
  cpf: { mascara: mascaraCpf, valido: cpfValido, erro: 'CPF inválido (confira os números).', modo: 'numeric' },
  telefone: { mascara: mascaraTelefone, valido: telefoneValido, erro: 'Telefone inválido. Use DDD + número.', modo: 'tel' },
  cep: { mascara: mascaraCep, valido: cepValido, erro: 'CEP inválido (8 dígitos).', modo: 'numeric' },
  email: { mascara: (v: string) => v.trim(), valido: emailValido, erro: 'E-mail inválido.', modo: 'email' },
} as const;

export type CampoBr = keyof typeof CAMPOS_BR;
