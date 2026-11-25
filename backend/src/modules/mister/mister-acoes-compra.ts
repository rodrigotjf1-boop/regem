// O PEDIDO DE COMPRA ENVIADO PELA CONVERSA (versão 9, etapa 6 do pedido do dono de 24/11: "pedido de compra: marcar enviado ao
// fornecedor"). O MESMO "Marcar como enviado" de Estoque › Pedidos (`ComprasService.marcarEnviado`): quem diz que enviou é a
// pessoa — o Regem só registra quando e por onde (o WhatsApp ou o e-mail, os dois canais da tela). Aqui só a conferência; sem banco.

export type CanalDoEnvio = 'whatsapp' | 'email';
export type ParametrosDoEnvio = { acao: 'pedido_enviado'; pedido: string; canal: CanalDoEnvio };

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
