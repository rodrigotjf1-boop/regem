import { OPCOES_DO_PESO } from './nota-do-pedido';
import {
  BOTAO_DO_FORMULARIO,
  NOME_DO_FORMULARIO,
  TELA_DO_FORMULARIO,
  VERSAO_DO_FLOW_JSON,
  lerRespostaDoFormulario,
  montarFormulario,
  pedidoDoToken,
  textoDaResposta,
  textoDepoisDaNota,
  tituloDoFormulario,
  tokenDaNota,
} from './formulario-da-nota';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O FORMULÁRIO DA NOTA NO WHATSAPP OFICIAL (fase A2, mig 456) — as regras sem banco. Os limites são os da doc da Meta
// (Flow JSON › Components, 19/11/2026); a estrutura, a do Playground da Meta (Form + Footer com `complete`).

const PEDIDO = '0b5d4c3e-1f2a-4b6c-8d9e-0a1b2c3d4e5f';
const resposta = (json: unknown) => ({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify(json) } } });

describe('o formulário da nota — regras', () => {
  it('o Flow JSON: uma tela final, os campos no Form, dentro dos limites da Meta, e o "complete" com os três campos', () => {
    const f: any = montarFormulario();
    expect(f.version).toBe(VERSAO_DO_FLOW_JSON);
    expect(f.screens).toHaveLength(1);
    const tela = f.screens[0];
    expect(tela).toMatchObject({ id: TELA_DO_FORMULARIO, terminal: true, success: true, data: { titulo: { type: 'string' } } });
    const form = tela.layout.children[0];
    expect(form.type).toBe('Form');
    const porTipo = (t: string) => form.children.find((c: any) => c.type === t);
    expect(porTipo('TextHeading').text).toBe('${data.titulo}');
    const nota = porTipo('RadioButtonsGroup');
    expect(nota).toMatchObject({ name: 'nota', required: true });
    expect(nota['data-source'].map((o: any) => o.id)).toEqual(['5', '4', '3', '2', '1']);
    const pesou = porTipo('CheckboxGroup');
    expect(pesou['data-source'].map((o: any) => o.id)).toEqual([...OPCOES_DO_PESO]);
    const texto = porTipo('TextArea');
    expect(texto).toMatchObject({ name: 'comentario', 'max-length': 300, required: false });
    const rodape = porTipo('Footer');
    expect(rodape['on-click-action']).toEqual({
      name: 'complete',
      payload: { nota: '${form.nota}', pesou: '${form.pesou}', comentario: '${form.comentario}' },
    });
    // Os limites: rótulo do grupo e títulos das opções até 30; rótulo do TextArea até 20; do Footer até 35; 1 a 20 opções.
    for (const g of [nota, pesou]) {
      expect(g.label.length).toBeLessThanOrEqual(30);
      expect(g['data-source'].length).toBeGreaterThanOrEqual(1);
      expect(g['data-source'].length).toBeLessThanOrEqual(20);
      for (const o of g['data-source']) expect([...o.title].length).toBeLessThanOrEqual(30);
    }
    expect(texto.label.length).toBeLessThanOrEqual(20);
    expect(rodape.label.length).toBeLessThanOrEqual(35);
    // O botão da mensagem: até 30, sem emoji.
    expect(BOTAO_DO_FORMULARIO.length).toBeLessThanOrEqual(30);
    expect(/\p{Extended_Pictographic}/u.test(BOTAO_DO_FORMULARIO)).toBe(false);
    expect(NOME_DO_FORMULARIO).toMatch(/^regem_avaliar_pedido_v\d+$/);
    expect(tituloDoFormulario('2841')).toBe('Como foi o pedido #2841?');
    expect(tituloDoFormulario(null)).toBe('Como foi o pedido?');
  });

  it('o token: o pedido, só no nosso formato', () => {
    expect(pedidoDoToken(tokenDaNota(PEDIDO))).toBe(PEDIDO);
    for (const ruim of ['', 'unused', PEDIDO, 'regem-nota:abc', 'regem-nota:' + PEDIDO + 'x', null, 42]) expect(pedidoDoToken(ruim)).toBeNull();
  });

  it('a resposta (nfm_reply): o token, a nota conferida como na página, e o que não é resposta de formulário', () => {
    const r = lerRespostaDoFormulario(resposta({ flow_token: tokenDaNota(PEDIDO), nota: '5', pesou: ['Tempo de entrega', 'Sabor'], comentario: ' Chegou quentinho! ' }));
    expect(r).toMatchObject({ pedidoId: PEDIDO, nota: { nota: 5, pesou: ['Sabor', 'Tempo de entrega'], comentario: 'Chegou quentinho!' } });
    expect(textoDaResposta(r)).toBe('📋 Avaliação: nota 5 · Sabor, Tempo de entrega · "Chegou quentinho!"');
    // Sem o que pesou e sem comentário (o formulário pode mandar vazio ou nem mandar).
    expect(lerRespostaDoFormulario(resposta({ flow_token: tokenDaNota(PEDIDO), nota: '2', comentario: '' }))?.nota).toEqual({ nota: 2, pesou: [], comentario: null });
    // Uma opção só pode vir como texto.
    expect(lerRespostaDoFormulario(resposta({ flow_token: tokenDaNota(PEDIDO), nota: '4', pesou: 'Preço' }))?.nota?.pesou).toEqual(['Preço']);
    // Campos fora da regra: o pedido vem, a nota não.
    const fora = lerRespostaDoFormulario(resposta({ flow_token: tokenDaNota(PEDIDO), nota: '9' }));
    expect(fora).toMatchObject({ pedidoId: PEDIDO, nota: null });
    expect(textoDaResposta(fora)).toBe('📋 Avaliação enviada');
    // Outro formulário da conta (sem o nosso token) e o JSON quebrado: sem pedido.
    expect(lerRespostaDoFormulario(resposta({ flow_token: 'unused', nota: '5' }))?.pedidoId).toBeNull();
    expect(lerRespostaDoFormulario({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{quebrado' } } })?.pedidoId).toBeNull();
    // Não é resposta de formulário.
    expect(lerRespostaDoFormulario({ type: 'text', text: { body: 'oi' } })).toBeNull();
    expect(lerRespostaDoFormulario({ type: 'interactive', interactive: { type: 'button_reply' } })).toBeNull();
    expect(textoDaResposta(null)).toBe('');
  });

  it('o que o Regem responde: o Google só na nota 5; o caso com o "sinto muito" (a frase da loja fora do horário)', () => {
    const LINK = 'https://g.page/r/CabcDEF123/review';
    expect(textoDepoisDaNota({ nome: 'Marina Souza', nota: 5, caso: false, google: LINK, pedidoNumero: '2841' })).toBe(
      `Obrigado pela nota, Marina! 💛 Ela vai direto para a equipe.\n\nSe puder, conte também no Google — ajuda muito a gente:\n${LINK}`,
    );
    expect(textoDepoisDaNota({ nome: 'Rafael', nota: 4, caso: false, google: null, pedidoNumero: '2809' })).toBe(
      'Obrigado pela nota, Rafael! 💛 Ela vai direto para a equipe — é assim que a gente melhora.',
    );
    expect(textoDepoisDaNota({ nome: 'Carlos', nota: 2, caso: true, google: null, pedidoNumero: '2838' })).toBe(
      'Poxa, Carlos, sinto muito. 😔 Já passei a sua avaliação do pedido #2838 para a equipe. Alguém fala com você aqui em instantes.',
    );
    expect(
      textoDepoisDaNota({ nome: null, nota: 1, caso: true, google: null, pedidoNumero: null, foraDoHorario: 'A equipe responde amanhã a partir das 18h.' }),
    ).toBe('Poxa, sinto muito. 😔 Já passei a sua avaliação para a equipe. A equipe responde amanhã a partir das 18h.');
  });
});
