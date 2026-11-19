import { NOMES_DA_NOTA, NotaConferida, OPCOES_DO_PESO, conferirNota } from './nota-do-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O FORMULÁRIO DA NOTA NO WHATSAPP OFICIAL (fase A2 do protótipo `mockups/regem-avaliacao-pedido.html`, caso 2 do celular —
// mig 456). Um WhatsApp Flow SEM servidor próprio ("endpoint"): uma tela, a nota (obrigatória), o que pesou e o comentário;
// o "Enviar avaliação" fecha o formulário e a resposta volta pelo webhook como `interactive.nfm_reply`. Quem cria e publica
// na conta da loja é a DMS (a rotina `whatsapp/formulario-da-nota.processor.ts`). Formulário publicado não se edita: mudar
// o texto é subir a VERSÃO abaixo (um formulário novo, com outro nome).
//
// Limites pela doc da Meta (Flow JSON › Components, conferida em 19/11/2026): rótulo do RadioButtonsGroup e do
// CheckboxGroup até 30 letras, de 1 a 20 opções com título até 30; rótulo do TextArea até 20 e o `max-length`; rótulo do
// Footer até 35; texto do botão (`flow_cta`) até 30, sem emoji.

/** A versão do NOSSO formulário (mudou o JSON → sobe aqui → a rotina publica um novo na conta de cada loja). */
export const VERSAO_DO_FORMULARIO = 1;
/** A versão do Flow JSON da Meta: a que o Playground da própria Meta gerava em 19/11/2026. */
export const VERSAO_DO_FLOW_JSON = '7.3';
/** O nome do formulário na conta da loja (único por versão: a rotina reconhece o que ela mesma criou). */
export const NOME_DO_FORMULARIO = `regem_avaliar_pedido_v${VERSAO_DO_FORMULARIO}`;
export const TELA_DO_FORMULARIO = 'AVALIAR';
/** O botão da mensagem (até 30, sem emoji). */
export const BOTAO_DO_FORMULARIO = 'Avaliar pedido';
/** O convite depois do "Tudo certo 👍" (o obrigado de sempre + o pedido da nota — caso 1 do protótipo). */
export const TEXTO_DO_CONVITE = 'Que bom! 😊 Obrigado pela preferência. Quer dar uma nota para o pedido? Leva 10 segundos.';

/** As notas, da 5 para a 1, como o formulário mostra (título até 30). */
export const OPCOES_DA_NOTA = [5, 4, 3, 2, 1].map((n) => ({ id: String(n), title: `${'★'.repeat(n)} ${NOMES_DA_NOTA[n]}` }));

/** O título da tela ("Como foi o pedido #2841?"), mandado nos dados do envio (`data.titulo`). */
export function tituloDoFormulario(pedidoNumero: string | null): string {
  return pedidoNumero ? `Como foi o pedido #${pedidoNumero}?` : 'Como foi o pedido?';
}

/**
 * O Flow JSON do formulário. A tela recebe o título pronto nos dados do envio (`data.titulo` — "Como foi o pedido #2841?").
 * A estrutura é a que o Playground da Meta gera (19/11/2026): os campos e o botão dentro de um `Form`, o `complete` com
 * `${form.campo}`. O "Enviar avaliação" fecha o formulário e devolve os três campos.
 */
export function montarFormulario(): Record<string, unknown> {
  return {
    version: VERSAO_DO_FLOW_JSON,
    screens: [
      {
        id: TELA_DO_FORMULARIO,
        title: 'Avaliar pedido',
        terminal: true,
        success: true,
        data: {
          titulo: { type: 'string', __example__: 'Como foi o pedido #2841?' },
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'Form',
              name: 'form',
              children: [
                { type: 'TextHeading', text: '${data.titulo}' },
                { type: 'RadioButtonsGroup', name: 'nota', label: 'Sua nota', required: true, 'data-source': OPCOES_DA_NOTA },
                {
                  type: 'CheckboxGroup',
                  name: 'pesou',
                  label: 'O que mais pesou? (opcional)',
                  required: false,
                  'data-source': OPCOES_DO_PESO.map((p) => ({ id: p, title: p })),
                },
                { type: 'TextArea', name: 'comentario', label: 'Quer contar mais?', required: false, 'max-length': 300 },
                {
                  type: 'Footer',
                  label: 'Enviar avaliação',
                  'on-click-action': {
                    name: 'complete',
                    payload: { nota: '${form.nota}', pesou: '${form.pesou}', comentario: '${form.comentario}' },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXO_DO_TOKEN = 'regem-nota:';

/** O `flow_token` do envio: o pedido. A resposta só vale da conversa do cliente do pedido, na loja do pedido (quem lê confere). */
export function tokenDaNota(pedidoId: string): string {
  return `${PREFIXO_DO_TOKEN}${pedidoId}`;
}

/** O pedido do `flow_token` (só o nosso formato), ou null. */
export function pedidoDoToken(token: unknown): string | null {
  const t = String(token ?? '');
  if (!t.startsWith(PREFIXO_DO_TOKEN)) return null;
  const id = t.slice(PREFIXO_DO_TOKEN.length);
  return UUID.test(id) ? id : null;
}

export type RespostaDoFormulario = { pedidoId: string | null; nota: NotaConferida | null; bruto: Record<string, unknown> };

/**
 * A resposta do formulário no webhook (`interactive.nfm_reply`): o `response_json` (texto JSON) com os campos do `complete`
 * e o `flow_token`. Null = não é resposta de formulário. `pedidoId` null = não é o nosso formulário (outro Flow da conta)
 * ou veio sem o token; `nota` null = os campos não valem (a mesma conferência da página).
 */
export function lerRespostaDoFormulario(m: any): RespostaDoFormulario | null {
  if (m?.type !== 'interactive' || m?.interactive?.type !== 'nfm_reply') return null;
  let bruto: Record<string, unknown> = {};
  try {
    const r = JSON.parse(String(m?.interactive?.nfm_reply?.response_json ?? '{}'));
    if (r && typeof r === 'object' && !Array.isArray(r)) bruto = r;
  } catch {
    /* sem campos */
  }
  const pedidoId = pedidoDoToken(bruto.flow_token);
  let nota: NotaConferida | null = null;
  try {
    const pesou = Array.isArray(bruto.pesou) ? bruto.pesou : typeof bruto.pesou === 'string' && bruto.pesou ? [bruto.pesou] : [];
    const comentario = typeof bruto.comentario === 'string' ? bruto.comentario : null;
    nota = conferirNota({ nota: Number(bruto.nota), pesou, comentario });
  } catch {
    nota = null;
  }
  return { pedidoId, nota, bruto };
}

/** O que a caixa de conversas mostra da resposta ("📋 Avaliação: nota 5 · Sabor · "Chegou quentinho!""). */
export function textoDaResposta(r: RespostaDoFormulario | null): string {
  if (!r) return '';
  if (!r.nota) return '📋 Avaliação enviada';
  const partes = [`📋 Avaliação: nota ${r.nota.nota}`];
  if (r.nota.pesou.length) partes.push(r.nota.pesou.join(', '));
  if (r.nota.comentario) partes.push(`"${r.nota.comentario}"`);
  return partes.join(' · ');
}

/**
 * O que o Regem responde no WhatsApp depois da nota (casos 3, 3b e 4 do protótipo): a nota 5 com o link do Google (só
 * ela — decisão do dono), as do meio com o obrigado, a que abriu caso com o "sinto muito" (fora do horário da equipe, a
 * frase da loja no lugar do "em instantes").
 */
export function textoDepoisDaNota(o: {
  nome: string | null;
  nota: number;
  caso: boolean;
  google: string | null;
  pedidoNumero: string | null;
  foraDoHorario?: string | null;
}): string {
  const primeiro = String(o.nome ?? '').trim().split(/\s+/)[0] || '';
  const vocativo = primeiro ? `, ${primeiro}` : '';
  if (o.caso) {
    const pedido = o.pedidoNumero ? ` do pedido #${o.pedidoNumero}` : '';
    const quando = o.foraDoHorario ? ` ${o.foraDoHorario}` : ' Alguém fala com você aqui em instantes.';
    return `Poxa${vocativo}, sinto muito. 😔 Já passei a sua avaliação${pedido} para a equipe.${quando}`;
  }
  if (o.google)
    return `Obrigado pela nota${vocativo}! 💛 Ela vai direto para a equipe.\n\nSe puder, conte também no Google — ajuda muito a gente:\n${o.google}`;
  return `Obrigado pela nota${vocativo}! 💛 Ela vai direto para a equipe — é assim que a gente melhora.`;
}

/** A resposta quando a nota não pode ser gravada (já avaliou, encerrou, desligado). */
export const TEXTO_JA_AVALIOU = 'Você já avaliou este pedido. Obrigado! 💛';
export const TEXTO_ENCERROU = 'A avaliação deste pedido encerrou, mas a equipe agradece! Se precisar de algo, é só escrever aqui.';
