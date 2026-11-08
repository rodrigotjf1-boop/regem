import { ErroDaMeta } from './instagram-graph';
import {
  LIMITE_DO_ROBO_POR_HORA,
  comentarioSemTexto,
  cursorDe,
  filtroDaLista,
  lerComentarios,
  lerCursor,
  mensagemDoComentarioParaORobo,
  podeComentarios,
  privadaPadrao,
  textoDaEquipe,
  travaDoComentario,
  traduzirErroDaMeta,
  vaiAoRobo,
} from './comentarios';
import { chaveDoComentario, ehChaveDoChat, ehChaveDoComentario, ehChaveDoDirect, ehChaveDeTeste, idDaChaveDoComentario } from '../../common/conversa-do-robo';
import { SEM_RESPOSTA_NO_COMENTARIO, instrucoesDosComentarios } from '../cardapio/robo-instrucoes';
import { jeitoDoAtendente } from '../cardapio/perfis-do-atendente';
import { contaComoReclamacao, grupoDoPlacar } from '../atendimento/numeros';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS COMENTÁRIOS DOS POSTS DO INSTAGRAM (F6, mig 384) — as regras puras, cada uma sozinha.

const CONTA = '17841400000000077';
const aviso = (changes: any[], extra: any = {}) => ({ object: 'instagram', entry: [{ id: CONTA, time: 1_762_650_000, changes, ...extra }] });
const comentario = (v: any = {}) => ({
  field: 'comments',
  value: { id: '17865799348089039', from: { id: '99887766', username: 'joana.souza' }, text: 'Que delícia! Abre domingo?', media: { id: '18012345678901234', media_product_type: 'FEED' }, ...v },
});

describe('comentários — o aviso (lerComentarios)', () => {
  it('lê o comentário de entry[].changes[] (field comments): a conta, o id, o post, quem comentou, o texto e a hora (segundos)', () => {
    expect(lerComentarios(aviso([comentario()]))).toEqual([
      {
        conta: CONTA,
        comentarioId: '17865799348089039',
        paiId: null,
        midiaId: '18012345678901234',
        midiaTipo: 'FEED',
        autorId: '99887766',
        autorUsuario: 'joana.souza',
        texto: 'Que delícia! Abre domingo?',
        em: new Date(1_762_650_000 * 1000),
      },
    ]);
  });

  it('a resposta a um comentário traz o de cima (parent_id); o parent igual ao próprio id não conta', () => {
    expect(lerComentarios(aviso([comentario({ id: '17865799348089040', parent_id: '17865799348089039' })]))[0].paiId).toBe('17865799348089039');
    expect(lerComentarios(aviso([comentario({ parent_id: '17865799348089039' })]))[0].paiId).toBeNull();
  });

  it('live_comments, mensagens e outros campos ficam de fora; sem id, sem texto ou sem o post = descartado', () => {
    expect(lerComentarios(aviso([{ ...comentario(), field: 'live_comments' }]))).toEqual([]);
    expect(lerComentarios(aviso([{ field: 'mentions', value: {} }]))).toEqual([]);
    expect(lerComentarios(aviso([], { messaging: [{ sender: { id: '1' }, message: { mid: 'm', text: 'oi' } }] }))).toEqual([]);
    expect(lerComentarios(aviso([comentario({ id: undefined })]))).toEqual([]);
    expect(lerComentarios(aviso([comentario({ id: 'abc' })]))).toEqual([]);
    expect(lerComentarios(aviso([comentario({ text: '   ' })]))).toEqual([]);
    expect(lerComentarios(aviso([comentario({ media: undefined })]))).toEqual([]);
    expect(lerComentarios({ object: 'page', entry: [{ id: CONTA, changes: [comentario()] }] })).toEqual([]);
    expect(lerComentarios(null)).toEqual([]);
  });

  it('vários comentários e várias contas no mesmo aviso saem um a um; o @ sai sem o @; a hora em ms também vale', () => {
    const r = lerComentarios({
      object: 'instagram',
      entry: [
        { id: CONTA, time: 1_762_650_000_000, changes: [comentario(), comentario({ id: '17865799348089041', from: { id: '5', username: '@ana' } })] },
        { id: '17841400000000078', time: 1_762_650_001, changes: [comentario({ id: '17865799348089042' })] },
      ],
    });
    expect(r.map((x) => [x.conta, x.comentarioId, x.autorUsuario])).toEqual([
      [CONTA, '17865799348089039', 'joana.souza'],
      [CONTA, '17865799348089041', 'ana'],
      ['17841400000000078', '17865799348089042', 'joana.souza'],
    ]);
    expect(r[0].em.getTime()).toBe(1_762_650_000_000);
  });
});

describe('comentários — o que não vai ao robô', () => {
  it('comentarioSemTexto: só emoji, só pontuação ou só marcação de amigos', () => {
    for (const t of ['😍😍😍', '🔥', '!!!', '❤️ 👏', '@joao @maria', '@joao 😂', '   ', ''])
      expect([t, comentarioSemTexto(t)]).toEqual([t, true]);
    for (const t of ['Que delícia', 'abre domingo?', '10/10', '@joao olha isso', 'top 🔥', 'Ñ'])
      expect([t, comentarioSemTexto(t)]).toEqual([t, false]);
  });

  it('vaiAoRobo: ligado, com texto, sem resposta e abaixo do limite de 30 por hora', () => {
    const base = { roboLigado: true, semTexto: false, jaRespondido: false, entreguesNaHora: 0 };
    expect(vaiAoRobo(base)).toBe(true);
    expect(vaiAoRobo({ ...base, entreguesNaHora: LIMITE_DO_ROBO_POR_HORA - 1 })).toBe(true);
    expect(vaiAoRobo({ ...base, entreguesNaHora: LIMITE_DO_ROBO_POR_HORA })).toBe(false);
    expect(vaiAoRobo({ ...base, roboLigado: false })).toBe(false);
    expect(vaiAoRobo({ ...base, semTexto: true })).toBe(false);
    expect(vaiAoRobo({ ...base, jaRespondido: true })).toBe(false);
    expect(LIMITE_DO_ROBO_POR_HORA).toBe(30);
  });

  it('podeComentarios: a permissão dos comentários na lista gravada (vírgula ou espaço); sem ela (conta de antes da F6) = não', () => {
    expect(podeComentarios('instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments')).toBe(true);
    expect(podeComentarios('instagram_business_basic instagram_business_manage_comments')).toBe(true);
    expect(podeComentarios('instagram_business_basic,instagram_business_manage_messages')).toBe(false);
    expect(podeComentarios('instagram_business_manage_comments_extra')).toBe(false);
    expect(podeComentarios(null)).toBe(false);
    expect(podeComentarios('')).toBe(false);
  });
});

describe('comentários — a trava do que o robô publica', () => {
  it('passa: numa linha, até 300 letras, cortado no fim de uma frase', () => {
    expect(travaDoComentario('  Obrigado,\n Joana!  Abrimos domingo das 18h às 23h. ')).toEqual({ ok: true, texto: 'Obrigado, Joana! Abrimos domingo das 18h às 23h.', cortado: false });
    const longo = `${'Abrimos todos os dias das 18h às 23h. '.repeat(9)}E aos domingos também.`;
    const r: any = travaDoComentario(longo);
    expect(r.ok).toBe(true);
    expect(r.cortado).toBe(true);
    expect(Array.from(r.texto).length).toBeLessThanOrEqual(300);
    expect(r.texto.endsWith('.')).toBe(true);
    // preço, hora, data e CEP passam
    expect(travaDoComentario('O X-Bacon sai por R$ 32,90 hoje, 08/11, até as 23h. CEP 22041-001.').ok).toBe(true);
  });

  it('link → não publica (nem o do cardápio)', () => {
    for (const t of ['Veja em https://app.dmsregem.com/c/abc', 'www.burger.com.br', 'acesse burgerdapraca.com', 'chama no wa.me/5521999998888', 'bit.ly/x'])
      expect([t, travaDoComentario(t)]).toEqual([t, { ok: false, motivo: 'link' }]);
  });

  it('telefone, WhatsApp, e-mail ou @ de alguém → não publica', () => {
    for (const t of [
      'Liga pra gente: (21) 99999-8888',
      'Fone 21 3333-4444',
      '21999998888',
      'chama no whats',
      'manda no WhatsApp',
      'chama no zap',
      'escreve para contato@burger.com',
      'fala com @burger.oficial',
    ])
      expect([t, travaDoComentario(t)]).toEqual([t, { ok: false, motivo: 'contato' }]);
  });

  it('"SEM RESPOSTA" (o robô decidiu não responder) e o vazio não publicam', () => {
    expect(travaDoComentario(SEM_RESPOSTA_NO_COMENTARIO)).toEqual({ ok: false, motivo: 'silencio' });
    expect(travaDoComentario(' (sem resposta). ')).toEqual({ ok: false, motivo: 'silencio' });
    expect(travaDoComentario('')).toEqual({ ok: false, motivo: 'vazio' });
    expect(travaDoComentario('Sem resposta não fica: abrimos às 18h!').ok).toBe(true);
  });

  it('o texto da equipe: 1 a 1.000 letras', () => {
    expect(textoDaEquipe('  Oi!  ')).toEqual({ ok: true, texto: 'Oi!' });
    expect(textoDaEquipe('')).toEqual({ ok: false, erro: 'Escreva a resposta.' });
    expect(textoDaEquipe(12)).toEqual({ ok: false, erro: 'Escreva a resposta.' });
    expect(textoDaEquipe('é'.repeat(1000)).ok).toBe(true);
    expect(textoDaEquipe('é'.repeat(1001)).ok).toBe(false);
  });

  it('a privada padrão do robô', () => {
    expect(privadaPadrao('joana.souza')).toBe('Oi, @joana.souza! Vimos o seu comentário e a nossa equipe vai continuar o atendimento por aqui, no Direct.');
    expect(privadaPadrao(null)).toBe('Oi! Vimos o seu comentário e a nossa equipe vai continuar o atendimento por aqui, no Direct.');
  });
});

describe('comentários — a chave cm: (conversa-do-robo)', () => {
  it('cm:<comentário de cima>: o pai quando é resposta, senão o próprio', () => {
    expect(chaveDoComentario({ comentarioId: '17865799348089040', paiId: '17865799348089039' })).toBe('cm:17865799348089039');
    expect(chaveDoComentario({ comentarioId: '17865799348089039', paiId: null })).toBe('cm:17865799348089039');
  });

  it('ehChaveDoComentario pega qualquer forma (para recusar); idDaChaveDoComentario só cm: + dígitos', () => {
    for (const v of ['cm:123456', ' CM:123456', 'cm:', 'cm:abc', 'cm:12-3']) expect([v, ehChaveDoComentario(v)]).toEqual([v, true]);
    for (const v of ['ig:123', 'chat:123', '5521999998888', 123, null]) expect([v, ehChaveDoComentario(v)]).toEqual([v, false]);
    expect(idDaChaveDoComentario('cm:17865799348089039')).toBe('17865799348089039');
    expect(idDaChaveDoComentario(' cm:17865799348089039 ')).toBe('17865799348089039');
    for (const v of ['cm:', 'cm:12', 'cm:abc', 'cm:123 456', 'ig:17865799348089039', null]) expect([v, idDaChaveDoComentario(v)]).toEqual([v, null]);
    // as outras chaves não confundem com a do comentário
    expect([ehChaveDoDirect('cm:1234'), ehChaveDoChat('cm:1234'), ehChaveDeTeste('cm:1234')]).toEqual([false, false, false]);
  });
});

describe('comentários — a mensagem ao robô', () => {
  it('a chave cm: na instância e no de, o comentário que ele responde em mensagemId, sem telefone, sem ficha, com o post', () => {
    const m = mensagemDoComentarioParaORobo({
      tenantId: 't-1',
      comentarioId: '17865799348089040',
      paiId: '17865799348089039',
      autorUsuario: 'joana.souza',
      texto: 'E domingo?',
      em: new Date(1_762_650_000_000),
      midiaTipo: 'REELS',
      legenda: `  Promo   de domingo! ${'x'.repeat(300)}`,
      cardapio: { token: 'tok', aberto: true, nomePublico: 'Burger', roboSaudacao: 'Oi', roboAusencia: null, roboPrompt: null, roboMensagens: null },
    });
    expect(m).toMatchObject({
      provedor: 'instagram',
      tenantId: 't-1',
      cardapioToken: 'tok',
      phoneNumberId: null,
      instancia: 'cm:17865799348089039',
      de: 'cm:17865799348089039',
      nome: 'joana.souza',
      tipo: 'text',
      texto: 'E domingo?',
      mensagemId: '17865799348089040',
      timestamp: 1_762_650_000,
      conversa: null,
      roboMensagens: [],
      loja: { nome: 'Burger', aberto: true },
    });
    expect(m.comentario.midiaTipo).toBe('REELS');
    expect(m.comentario.legenda?.startsWith('Promo de domingo! x')).toBe(true);
    expect(Array.from(m.comentario.legenda ?? '').length).toBe(200);
  });
});

describe('comentários — o erro da Meta e a lista', () => {
  it('o erro da Meta vira código e frase curta (sem o texto da Meta)', () => {
    expect(traduzirErroDaMeta(new ErroDaMeta('a Meta não respondeu (ECONNREFUSED)', 0, null)).code).toBe('META_FORA_DO_AR');
    expect(traduzirErroDaMeta(new ErroDaMeta('Error validating access token', 400, 190)).code).toBe('META_ACESSO_VENCIDO');
    expect(traduzirErroDaMeta(new ErroDaMeta('(#10) permission', 403, 10)).code).toBe('META_SEM_PERMISSAO');
    expect(traduzirErroDaMeta(new ErroDaMeta('limit', 400, 4)).code).toBe('META_LIMITE');
    expect(traduzirErroDaMeta(new ErroDaMeta('Invalid parameter', 400, 100)).code).toBe('META_COMENTARIO_INDISPONIVEL');
    expect(traduzirErroDaMeta(new ErroDaMeta('x', 400, 999)).code).toBe('META_RECUSOU');
    expect(traduzirErroDaMeta(new Error('qualquer'))).toEqual({ code: 'META_FORA_DO_AR', message: 'O Instagram não respondeu agora. Tente de novo em instantes.' });
    expect(JSON.stringify(traduzirErroDaMeta(new ErroDaMeta('token EAAB123 inválido', 400, 999)))).not.toMatch(/EAAB/);
  });

  it('o cursor vai e volta; lixo = começa do início; o filtro desconhecido = sem resposta', () => {
    const c = cursorDe({ comentadoEm: '2026-11-08T10:00:00.000Z', id: '5a1e0e7e-0000-4000-8000-000000000001' });
    expect(lerCursor(c)).toEqual({ em: '2026-11-08T10:00:00.000Z', id: '5a1e0e7e-0000-4000-8000-000000000001' });
    for (const v of ['', 'lixo', Buffer.from('{"e":"x","i":"y"}').toString('base64url'), 12, null]) expect(lerCursor(v)).toBeNull();
    expect(filtroDaLista('respondidos')).toBe('respondidos');
    expect(filtroDaLista('escondidos')).toBe('escondidos');
    expect(filtroDaLista('todos')).toBe('todos');
    expect(filtroDaLista('qualquer')).toBe('sem-resposta');
    expect(filtroDaLista(undefined)).toBe('sem-resposta');
  });
});

describe('comentários — o caso nos Números do atendimento', () => {
  it('o caso instagram_comentario não entra na linha do WhatsApp ("casos") e pode ser reclamação', () => {
    const l: any = { tipo: 'instagram_comentario', canal: 'instagram', criadoEm: new Date().toISOString(), detalhe: {} };
    expect(grupoDoPlacar(l)).toBeNull();
    expect(contaComoReclamacao(l)).toBe(true);
    expect(grupoDoPlacar({ ...l, tipo: 'humano' })).toBe('casos'); // controle
  });
});

describe('comentários — as instruções do robô (instrucoesDosComentarios)', () => {
  it('a versão, o canal, o comentário público, as quatro decisões, o SEM RESPOSTA e as ferramentas que servem', () => {
    const r = instrucoesDosComentarios({ loja: 'Burger da Praça' });
    expect(r).toMatchObject({ versao: '2026-11-09.m1', fluxo: 1, canal: 'comentarios' });
    expect(instrucoesDosComentarios({ loja: 'x' }, '2').fluxo).toBe(2);
    const t = r.texto;
    expect(t.startsWith('Você atende os clientes da Burger da Praça nos comentários dos posts do Instagram da loja.')).toBe(true);
    for (const trecho of [
      'O COMENTÁRIO É PÚBLICO',
      'NO MÁXIMO 300 letras',
      'NUNCA escreva link',
      'NUNCA peça em público telefone',
      'Elogio',
      'Dúvida simples',
      'chamar_atendente',
      'privada.enviada = true',
      `Escreva só ${SEM_RESPOSTA_NO_COMENTARIO}`,
      'paraOCliente (opcional)',
      'foraDoHorario = true',
      'consultar_loja',
      'buscar_no_cardapio',
      'taxa_de_entrega',
      'NÃO funcionam nos comentários',
      'nunca escreva OPCOES',
    ])
      expect([trecho, t.includes(trecho)]).toEqual([trecho, true]);
    // sem os assuntos que não são pedido (F3) e sem link do cardápio
    expect(t).not.toMatch(/ASSUNTOS QUE NÃO SÃO PEDIDO|link_personalizado: o link/);
  });

  it('com o perfil do canal (o jeito logo depois da abertura, sem impor o tom) e o que a loja ensinou antes das ferramentas', () => {
    // o perfil do canal `comentarios` (F2) — o de fora do horário quando a equipe não está
    const jeito = jeitoDoAtendente({ comentarios: { perfil: 'cordial', foraDoHorario: 'objetivo', jeito: 'assine como Burger' } }, 'comentarios', true);
    expect(jeito).toContain('assine como Burger');
    expect(jeitoDoAtendente({ comentarios: { perfil: 'cordial', foraDoHorario: 'objetivo' } }, 'comentarios', false)).not.toBe(
      jeitoDoAtendente({ comentarios: { perfil: 'cordial', foraDoHorario: 'objetivo' } }, 'comentarios', true),
    );
    const conhecimento = 'O QUE A LOJA ENSINOU\n- Pergunta: tem estacionamento?\n  Resposta: sim, na rua de trás.';
    const sem = instrucoesDosComentarios({ loja: 'Burger' }).texto;
    const com = instrucoesDosComentarios({ loja: 'Burger', jeito, conhecimento }).texto;
    expect(com.split('\n\n')[1]).toBe(jeito);
    expect(com.split('\n\n')[0]).not.toContain('simpática, acolhedora e objetiva');
    expect(com.indexOf('O QUE A LOJA ENSINOU')).toBeGreaterThan(com.indexOf('QUANDO CHAMAR UMA PESSOA'));
    expect(com.indexOf('O QUE A LOJA ENSINOU')).toBeLessThan(com.indexOf('COMO DESCOBRIR AS COISAS'));
    expect(sem).not.toContain('O QUE A LOJA ENSINOU');
    expect(sem).toContain('simpática, acolhedora e objetiva');
  });
});
