import { registerDecorator, ValidationOptions } from 'class-validator';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Validadores de documentos e contatos brasileiros (Fase 6).
// Antes, "CNPJ" aceitava qualquer texto na maioria dos cadastros — só o cadastro
// da empresa conferia os dígitos. Aqui centralizamos para usar em qualquer DTO.
// Todos aceitam com ou sem máscara: guardamos e comparamos só os dígitos.

const digitos = (v: any) => String(v ?? '').replace(/\D/g, '');

// CNPJ: 14 dígitos, não todos iguais, com os 2 dígitos verificadores corretos.
export function cnpjValido(bruto: any): boolean {
  const c = digitos(bruto);
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
  const d2 = dv(c.slice(0, 12) + String(d1));
  return c.slice(12) === `${d1}${d2}`;
}

// CPF: 11 dígitos, não todos iguais, com os 2 dígitos verificadores corretos.
export function cpfValido(bruto: any): boolean {
  const c = digitos(bruto);
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (qtd: number) => {
    let soma = 0;
    for (let i = 0; i < qtd; i++) soma += Number(c[i]) * (qtd + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return Number(c[9]) === dv(9) && Number(c[10]) === dv(10);
}

// Telefone BR: 10 (fixo) ou 11 (celular) dígitos. DDD de 11 a 99; celular com 9.
export function telefoneValido(bruto: any): boolean {
  const t = digitos(bruto);
  if (!/^\d{10,11}$/.test(t)) return false;
  if (Number(t.slice(0, 2)) < 11) return false; // não existe DDD abaixo de 11
  if (t.length === 11 && t[2] !== '9') return false; // celular sempre começa com 9
  return true;
}

// CEP: 8 dígitos (00000-000). Não valida se existe — isso é a busca do endereço.
export function cepValido(bruto: any): boolean {
  return /^\d{8}$/.test(digitos(bruto));
}

// Fábrica dos decorators. Campo vazio passa: quem exige preenchimento é o
// @IsNotEmpty/obrigatoriedade do próprio DTO, não o formato.
function criar(nome: string, fn: (v: any) => boolean, msg: string) {
  return (opcoes?: ValidationOptions) => (alvo: any, prop: string) =>
    registerDecorator({
      name: nome,
      target: alvo.constructor,
      propertyName: prop,
      options: { message: msg, ...opcoes },
      validator: { validate: (v: any) => v === undefined || v === null || v === '' || fn(v) },
    });
}

export const IsCnpj = criar('isCnpj', cnpjValido, 'CNPJ inválido (confira os números).');
export const IsCpf = criar('isCpf', cpfValido, 'CPF inválido (confira os números).');
export const IsTelefoneBr = criar(
  'isTelefoneBr',
  telefoneValido,
  'Telefone inválido. Use DDD + número (ex.: 11 91234-5678).',
);
export const IsCep = criar('isCep', cepValido, 'CEP inválido (8 dígitos, ex.: 01310-100).');
