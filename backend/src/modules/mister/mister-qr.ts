// A CONEXÃO POR QR CODE DO NÚMERO DO MISTER (Q2 e Q3; mig 437; protótipo `mockups/regem-mister-qr.html`, aprovado em
// 15/11/2026). Puro: sem banco, sem rede. A porta do provedor (o envio e a entrada pelo Evolution) é a Q1 (mig 436).

import type { SituacaoDoQr } from './mister-numero.service';

/** A versão do texto do aceite: mudou o texto, muda a versão, e o aceite antigo deixa de valer para gerar o QR. */
export const VERSAO_DO_ACEITE = 'v1';

/** O texto do aceite do risco, como o console mostra (decisão 2 do protótipo). */
export const TEXTO_DO_ACEITE = [
  'O WhatsApp não autoriza conexões fora da API oficial. O número pode ser bloqueado sem aviso, sobretudo se mandar mensagem para quem não falou com ele. O Mister só fala com quem ligou o próprio telefone (com o código de 10 minutos), o que reduz esse risco, mas não o elimina.',
  'Use um número só para o Mister, num celular que fique na distribuição, ligado e com internet.',
].join('\n');

/** A instância do Mister no Evolution da distribuição: separada das instâncias das lojas (que levam o nome da loja). */
export const nomeDaInstancia = (sufixo: string) => `regem-mister-${String(sufixo).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;

/** O número do celular conectado, a partir do dono da instância (`5521...@s.whatsapp.net` ou `5521...:12@s.whatsapp.net`). */
export function numeroDoDono(dono: unknown): string | null {
  const d = String(dono ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/**
 * O que o aviso de conexão do Evolution (`CONNECTION_UPDATE`) diz da conexão: aberta = conectado; fechada pelo motivo do
 * WhatsApp — 401 (o celular saiu da conta) e 403 (o WhatsApp bloqueou o número, sem volta por aqui) — ou outro (a
 * conexão caiu). "Conectando" não muda nada. Os códigos são os do Baileys (`DisconnectReason`); conferir com o 1º caso real.
 */
export function situacaoPelaConexao(estado: unknown, motivo: unknown): { situacao: SituacaoDoQr; motivo: string | null } | null {
  const e = String(estado ?? '').toLowerCase();
  if (e === 'open') return { situacao: 'conectado', motivo: null };
  if (e !== 'close') return null;
  const codigo = Number(motivo);
  if (codigo === 403) return { situacao: 'bloqueado', motivo: 'O WhatsApp bloqueou este número. Ele não volta por aqui: só pelo pedido de revisão no próprio aplicativo.' };
  if (codigo === 401) return { situacao: 'caiu', motivo: 'O celular saiu da conta (desconectado no aparelho).' };
  return { situacao: 'caiu', motivo: 'A conexão caiu (o celular sem internet por muito tempo ou o servidor do Evolution reiniciou).' };
}

/** Q3: o aviso do número novo, para cada pessoa ligada, pelo número novo (no ritmo do envio). */
export function textoDoNumeroNovo(nome: unknown): string {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0];
  return `${primeiro ? `Oi, ${primeiro}! ` : ''}Este é o novo número do Mister, do Regem. Salve este contato: os avisos, os resumos e as suas perguntas passam a ser por aqui. O número antigo não responde mais.`;
}
