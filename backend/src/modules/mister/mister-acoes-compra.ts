// O PEDIDO DE COMPRA ENVIADO PELA CONVERSA (versão 9, etapa 6 do pedido do dono de 24/11: "pedido de compra: marcar enviado ao
// fornecedor"). O MESMO "Marcar como enviado" de Estoque › Pedidos (`ComprasService.marcarEnviado`): quem diz que enviou é a
// pessoa — o Regem só registra quando e por onde (o WhatsApp ou o e-mail, os dois canais da tela). Aqui só a conferência; sem banco.

export type CanalDoEnvio = 'whatsapp' | 'email';
export type ParametrosDoEnvio = { acao: 'pedido_enviado'; pedido: string; canal: CanalDoEnvio };
/** P1 de "Pedidos e recebimento" (mig 504): a validade do item recebido com "não sei", informada pela conversa. */
export type ParametrosDaValidade = { acao: 'informar_validade'; insumo: string; pedido: string | null; validade: string | null; semValidade: boolean };

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const NOME_DO_CANAL: Record<CanalDoEnvio, string> = { whatsapp: 'WhatsApp', email: 'e-mail' };

/** "zap", "WhatsApp", "wpp" → whatsapp; "e-mail", "email" → email. */
export function lerCanalDoEnvio(v: unknown): CanalDoEnvio | null {
  const t = semAcento(texto(v));
  if (/whats|zap|wpp|wa\b/.test(t)) return 'whatsapp';
  if (/e-?mail|correio/.test(t)) return 'email';
  return null;
}

export function conferirEnvio(en: Record<string, unknown>): { parametros: ParametrosDoEnvio; resumo: string } | { erro: string } {
  const pedido = texto(en.pedidoDeCompra).slice(0, 120);
  if (pedido.length < 2) return { erro: 'Diga qual pedido de compra (o nome dele ou o fornecedor).' };
  const canal = lerCanalDoEnvio(en.canalDoEnvio);
  if (!canal) return { erro: 'Diga por onde o pedido foi mandado ao fornecedor: WhatsApp ou e-mail (os dois da tela).' };
  return { parametros: { acao: 'pedido_enviado', pedido, canal }, resumo: `Marcar o pedido "${pedido}" como enviado ao fornecedor pelo ${NOME_DO_CANAL[canal]}.` };
}

export function resumoDoEnvio(nomeDoPedido: string, canal: CanalDoEnvio, antes: { enviadoEm: string | null; canal: string | null }): string {
  const de = antes.enviadoEm ? ` Ele já estava marcado como enviado pelo ${NOME_DO_CANAL[antes.canal as CanalDoEnvio] ?? antes.canal} em ${antes.enviadoEm}: fica a marca nova.` : '';
  return `Marcar o pedido "${nomeDoPedido}" como enviado ao fornecedor pelo ${NOME_DO_CANAL[canal]}.${de} Quem diz que enviou é você: o Regem só registra quando e por onde.`;
}

const diaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** A validade informada: o insumo, e a data OU "sem validade" (um dos dois). O pedido só quando há dois do mesmo insumo. */
export function conferirValidadeInformada(en: Record<string, unknown>): { parametros: ParametrosDaValidade; resumo: string } | { erro: string } {
  const insumo = texto(en.insumoDaValidade).slice(0, 100);
  if (insumo.length < 2) return { erro: 'Diga de qual item é a validade (o nome do produto).' };
  const pedido = texto(en.pedidoDaValidade).slice(0, 120) || null;
  const semValidade = en.semValidadeInformada === true;
  const v = texto(en.validadeInformada);
  const validade = v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) ? v : null;
  if (v && !validade) return { erro: 'A validade vai no formato AAAA-MM-DD.' };
  if (validade && semValidade) return { erro: 'Ou a validade tem data, ou é "sem validade" — não os dois.' };
  if (!validade && !semValidade) return { erro: 'Diga a data da validade (ex.: "vence 02/12"), ou que o item não tem validade.' };
  return {
    parametros: { acao: 'informar_validade', insumo, pedido, validade, semValidade },
    resumo: `Informar a validade de "${insumo}": ${semValidade ? 'sem validade' : `vence em ${diaBr(validade as string)}`}.`,
  };
}

export function resumoDaValidade(nome: string, pedido: string, recebido: string | null, x: ParametrosDaValidade): string {
  return (
    `Informar a validade de "${nome}" (pedido "${pedido}"${recebido ? `, recebido em ${recebido}` : ''}): ${x.semValidade ? 'sem validade' : `vence em ${diaBr(x.validade as string)}`}. ` +
    'O item e o lote saem da validade pendente.'
  );
}
