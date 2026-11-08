import { chaveDoChat, ehChaveDeTeste, ehChaveDoChat, ehChaveDoDirect, idDaChaveDoChat } from '../../common/conversa-do-robo';
import { NOME_DO_MOTIVO_DA_TRAVA, PARTES_NO_CHAT, TEXTO_MAX, opcoesNoChat, partirParaOChat, temContatoProibido, travaDaPlataforma } from './texto-do-chat';
import {
  FALAS_DO_ATENDENTE_POR_HORA,
  RESPOSTAS_POR_HORA,
  decidir,
  decidirNoChat,
  intencaoDoCliente,
  modoDaLinha,
  pedidoParaOAtendente,
  textoDoPedidoNoChat,
  type PedidoDoRobo,
} from './robo-do-chat';
import { mensagemDoChatParaORobo } from './atendente-no-chat';
import { VERSAO_DO_CHAT, instrucoesDoChat } from '../cardapio/robo-instrucoes';
import { jeitoDoAtendente } from '../cardapio/perfis-do-atendente';
import { blocoDoConhecimento } from '../cardapio/conhecimento-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ATENDENTE VIRTUAL NO CHAT DO iFOOD E DA 99 (F5 do atendente virtual, mig 383) — as regras sem banco: a chave `chat:`, a
// trava da plataforma e o corte em até 3 mensagens de 300 letras, a decisão regras × atendente, o pedido que vai ao robô, a
// mensagem no formato das outras vias e as instruções do chat.

const ID = '7f1c2a9e-3b4d-4e5f-8a6b-1c2d3e4f5a6b';

describe('a chave `chat:` (conversa-do-robo)', () => {
  it('reconhece qualquer forma que começa com chat: (as rotas de telefone recusam todas)', () => {
    for (const v of [`chat:${ID}`, ` CHAT:${ID} `, 'chat:torto', 'chat:']) expect(ehChaveDoChat(v)).toBe(true);
    for (const v of [ID, `ig:${ID}`, `teste:${ID}`, '5521999990000', null, undefined, 42]) expect(ehChaveDoChat(v)).toBe(false);
  });
  it('só chat: + uuid é uma fala que vale; o id volta em minúsculas', () => {
    expect(idDaChaveDoChat(`chat:${ID.toUpperCase()}`)).toBe(ID);
    expect(idDaChaveDoChat(`chat:${ID}`)).toBe(ID);
    for (const v of ['chat:', 'chat:123', `chat:${ID}x`, `teste:${ID}`, ID]) expect(idDaChaveDoChat(v)).toBeNull();
    expect(chaveDoChat(ID)).toBe(`chat:${ID}`);
  });
  it('as três chaves que não são telefone não se confundem', () => {
    expect(ehChaveDoDirect(`chat:${ID}`) || ehChaveDeTeste(`chat:${ID}`)).toBe(false);
    expect(ehChaveDoChat(`ig:123456`) || ehChaveDoChat(`teste:${ID}`)).toBe(false);
  });
});

describe('a trava da plataforma (o que o atendente escreve no chat)', () => {
  it('texto curto: uma parte, numa linha só', () => {
    expect(travaDaPlataforma('Oi, Maria!\n\nSeu pedido   saiu agora.')).toEqual({ ok: true, partes: ['Oi, Maria! Seu pedido saiu agora.'], cortado: false });
  });

  it('texto longo: até 3 partes de até 300 letras, cortadas no fim de uma frase', () => {
    const frase = (n: number) => `Esta é a frase número ${n} da resposta, com algumas palavras a mais para encher.`; // 80 letras
    const texto = Array.from({ length: 9 }, (_, i) => frase(i + 1)).join(' ');
    const { partes, cortado } = partirParaOChat(texto);
    expect(partes.length).toBe(3);
    for (const p of partes) {
      expect(p.length).toBeLessThanOrEqual(TEXTO_MAX);
      expect(p).toMatch(/\.$/); // termina numa frase inteira
      expect(p).not.toMatch(/\n/);
    }
    expect(cortado).toBe(false);
    expect(partes.join(' ')).toBe(texto);
  });

  it('mais que 3 × 300: fica nas 3 partes e avisa que cortou; sem pontuação, corta num espaço', () => {
    const longo = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(' '); // ~1.800 letras, sem ponto
    const { partes, cortado } = partirParaOChat(longo);
    expect(partes).toHaveLength(PARTES_NO_CHAT);
    expect(cortado).toBe(true);
    for (const p of partes) {
      expect(p.length).toBeLessThanOrEqual(TEXTO_MAX);
      expect(p).toMatch(/^palavra\d+( palavra\d+)*$/); // nenhuma palavra cortada ao meio
    }
  });

  it.each([
    ['link', 'Peça de novo pelo https://cardapio.exemplo/c/abc que sai mais rápido.'],
    ['www', 'Veja em www.minhaloja.com.br as promoções.'],
    ['telefone', 'Me liga no (21) 99999-8888 que eu resolvo.'],
    ['WhatsApp', 'Chama a gente no WhatsApp que é mais fácil.'],
    ['zap', 'manda no zap'],
    ['Instagram', 'Segue a gente no Instagram!'],
    ['e-mail', 'Escreve para contato@loja.com.br, por favor.'],
    ['@ do perfil', 'Procura @burgerdapraca lá.'],
  ])('com %s: NADA sai', (_n, t) => {
    expect(travaDaPlataforma(t)).toEqual({ ok: false, motivo: 'contato' });
  });

  it('o contato no fim de um texto longo (que ficaria de fora do corte) também barra o texto inteiro', () => {
    const texto = `${'Uma frase comprida e educada sobre o pedido. '.repeat(25)}Qualquer coisa me chama no 21 98888-7777.`;
    expect(partirParaOChat(texto).cortado).toBe(true); // o telefone ficaria na sobra
    expect(travaDaPlataforma(texto)).toEqual({ ok: false, motivo: 'contato' });
  });

  it('o número do pedido e "em instantes" passam (não são contato)', () => {
    expect(travaDaPlataforma('Seu pedido #4821 sai em instantes.').ok).toBe(true);
  });

  it('vazio (ou só espaços): não sai', () => {
    expect(travaDaPlataforma('  \n ')).toEqual({ ok: false, motivo: 'vazio' });
    expect(NOME_DO_MOTIVO_DA_TRAVA.contato).toContain('a plataforma proíbe');
  });

  it('as opções viram uma lista numerada na mesma linha', () => {
    expect(opcoesNoChat('Posso ajudar em mais algo?', [{ titulo: 'Sim' }, { titulo: 'Não, obrigado', descricao: 'encerrar' }])).toBe(
      'Posso ajudar em mais algo? 1) Sim; 2) Não, obrigado (encerrar). Responda com o número da opção.',
    );
    expect(opcoesNoChat('Só texto\ncom quebra', [])).toBe('Só texto com quebra');
    expect(opcoesNoChat('', [{ titulo: 'A' }])).toBe('1) A. Responda com o número da opção.');
  });
});

const pedido = (o: Partial<PedidoDoRobo> = {}): PedidoDoRobo => ({
  status: 'despachado',
  despachadoEm: '2026-11-08T23:05:00Z', // 20h05 em São Paulo
  modo: 'propria_canal',
  cliente: 'MARIA S.',
  canal: 'ifood',
  ...o,
});

describe('a decisão: robô por regras × atendente virtual', () => {
  const base = { casoAberto: false, respostasNaHora: 0, pedido: pedido(), horaPrevista: '20h32', canal: 'ifood' as const, envia: true };

  it("modo 'regras' (e qualquer valor estranho do banco): EXATAMENTE o robô por regras de hoje", () => {
    expect(modoDaLinha(undefined)).toBe('regras');
    expect(modoDaLinha('Atendente')).toBe('regras');
    expect(modoDaLinha('atendente')).toBe('atendente');
    const casos = [
      { ...base, intencao: intencaoDoCliente('Cadê meu pedido?'), fala: 'Cadê meu pedido?' },
      { ...base, intencao: intencaoDoCliente('Veio frio, um absurdo'), fala: 'Veio frio, um absurdo' },
      { ...base, intencao: intencaoDoCliente('obrigado'), fala: 'obrigado' },
      { ...base, casoAberto: true, intencao: intencaoDoCliente('alô?'), fala: 'alô?' },
      { ...base, envia: false, intencao: intencaoDoCliente('Cadê?'), fala: 'Cadê?' },
      { ...base, respostasNaHora: RESPOSTAS_POR_HORA, intencao: intencaoDoCliente('Cadê?'), fala: 'Cadê?' },
    ];
    for (const c of casos)
      expect(decidirNoChat({ ...c, modo: 'regras', atendentePronto: true, falasDoAtendenteNaHora: 0 })).toEqual(decidir(c));
  });

  it("modo 'atendente': a conversa vai ao atendente — até a reclamação (quem decide chamar é ele)", () => {
    for (const fala of ['Cadê meu pedido?', 'Vocês têm sobremesa?', 'Veio frio, um absurdo'])
      expect(decidirNoChat({ ...base, intencao: intencaoDoCliente(fala), fala, modo: 'atendente', atendentePronto: true, falasDoAtendenteNaHora: 0 })).toEqual({
        acao: 'atendente',
      });
  });

  it("modo 'atendente': caso aberto = quieto; agradecimento = nada (como as regras)", () => {
    const at = { modo: 'atendente' as const, atendentePronto: true, falasDoAtendenteNaHora: 0 };
    expect(decidirNoChat({ ...base, ...at, casoAberto: true, intencao: 'outra', fala: 'alô?' })).toEqual({ acao: 'quieto' });
    expect(decidirNoChat({ ...base, ...at, intencao: 'agradecimento', fala: 'valeu' })).toEqual({ acao: 'nada' });
  });

  it("modo 'atendente' sem quem envie pelo canal, ou sem o atendente pronto: o robô por regras (nunca fica sem nada)", () => {
    const fala = 'Cadê meu pedido?';
    const c = { ...base, intencao: intencaoDoCliente(fala), fala };
    expect(decidirNoChat({ ...c, envia: false, modo: 'atendente', atendentePronto: true, falasDoAtendenteNaHora: 0 })).toEqual(decidir({ ...c, envia: false }));
    expect(decidirNoChat({ ...c, modo: 'atendente', atendentePronto: false, falasDoAtendenteNaHora: 0 })).toEqual(decidir(c));
    expect(decidir(c)).toMatchObject({ acao: 'responder' });
  });

  it(`modo 'atendente': ${FALAS_DO_ATENDENTE_POR_HORA} falas dele na hora → a equipe (com o resumo; chateado = urgente)`, () => {
    const at = { modo: 'atendente' as const, atendentePronto: true };
    expect(decidirNoChat({ ...base, ...at, falasDoAtendenteNaHora: FALAS_DO_ATENDENTE_POR_HORA - 1, intencao: 'outra', fala: 'e aí?' })).toEqual({ acao: 'atendente' });
    const d = decidirNoChat({ ...base, ...at, falasDoAtendenteNaHora: FALAS_DO_ATENDENTE_POR_HORA, intencao: 'outra', fala: 'que absurdo isso' });
    expect(d).toMatchObject({
      acao: 'chamar_equipe',
      urgente: true,
      resumo: { motivo: 'O atendente virtual já respondeu 8 vezes a este pedido na última hora', quer: 'que absurdo isso', humor: 'chateado' },
    });
  });
});

describe('o pedido que vai ao atendente (campo `pedido`)', () => {
  it('entrega da loja, a caminho: a hora que saiu, a previsão e a resposta pronta do robô por regras', () => {
    expect(pedidoParaOAtendente(pedido(), '4821', '20h32')).toEqual({
      numero: '4821',
      status: 'despachado',
      situacao: 'saiu para entrega com o entregador da loja',
      quemEntrega: 'loja',
      saiuAs: '20h05',
      previsao: '20h32',
      respostaPronta: 'Oi, Maria! Seu pedido saiu às 20h05 e chega por volta das 20h32.',
    });
  });
  it('entregador da plataforma: sem previsão da loja; a situação manda acompanhar pelo app', () => {
    const p = pedidoParaOAtendente(pedido({ modo: 'logistica_canal' }), '4821', '20h32');
    expect(p).toMatchObject({ quemEntrega: 'plataforma', previsao: null, situacao: 'saiu com o entregador do iFood (o cliente acompanha pelo app do iFood)' });
    expect(p.respostaPronta).toContain('entregador do iFood');
  });
  it('entregue ou cancelado: sem previsão e sem resposta pronta (o robô por regras não sabe dizer)', () => {
    for (const status of ['concluido', 'cancelado', 'entregue']) {
      const p = pedidoParaOAtendente(pedido({ status }), '1', '20h32');
      expect(p.previsao).toBeNull();
      expect(p.respostaPronta).toBeNull();
    }
    expect(textoDoPedidoNoChat(pedido({ status: 'cancelado' }))).toBe('Situação do pedido: cancelado.');
    expect(textoDoPedidoNoChat(pedido())).toBe('Situação do pedido: saiu para entrega com o entregador da loja (saiu às 20h05).');
  });
});

describe('a mensagem ao robô no formato das outras vias', () => {
  const cardapio = { id: 'c1', token: 'tok-loja', aberto: true, nomePublico: 'Burger da Praça', unidadeId: null, roboSaudacao: 'Olá!', roboAusencia: null, roboPrompt: null, roboMensagens: null };
  it('a chave `chat:` (a da conversa) na instância e no `de`; só texto; sem ficha; o pedido junto — e nenhum telefone', () => {
    const ULTIMA = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
    const m = mensagemDoChatParaORobo({
      tenantId: 't1',
      chaveId: ID,
      mensagemId: ULTIMA,
      canal: 'ifood',
      cliente: 'MARIA S.',
      texto: 'Oi\nCadê meu pedido?',
      em: '2026-11-08T23:10:00Z',
      cardapio,
      pedido: pedidoParaOAtendente(pedido(), '4821', '20h32'),
    });
    expect(m).toMatchObject({
      provedor: 'instagram',
      tenantId: 't1',
      cardapioToken: 'tok-loja',
      phoneNumberId: null,
      instancia: `chat:${ID}`,
      de: `chat:${ID}`,
      nome: 'Maria',
      tipo: 'text',
      texto: 'Oi\nCadê meu pedido?',
      mensagemId: ULTIMA, // a fala que ele responde; a chave é a da conversa (a primeira fala)
      conversa: null,
      plataforma: 'ifood',
      loja: { nome: 'Burger da Praça', aberto: true },
      roboSaudacao: 'Olá!',
      roboMensagens: [],
      pedido: { numero: '4821', previsao: '20h32' },
    });
    const { timestamp, ...semAHora } = m;
    expect(timestamp).toBe(Math.floor(Date.parse('2026-11-08T23:10:00Z') / 1000));
    expect(JSON.stringify(semAHora)).not.toMatch(/\d{10,}/); // nenhum telefone (nem os dígitos do uuid soltos)
  });
});

describe('as instruções do chat do iFood e da 99', () => {
  const texto = (o: any = {}) => instrucoesDoChat({ loja: 'Burger da Praça', plataforma: 'ifood', ...o }, '1').texto;

  it('a versão e o canal próprios; a 99 com o nome dela', () => {
    const r = instrucoesDoChat({ loja: 'X', plataforma: 'ifood' });
    expect(r).toMatchObject({ versao: VERSAO_DO_CHAT, canal: 'chat', plataforma: 'ifood', fluxo: 1 });
    expect(VERSAO_DO_CHAT).toMatch(/\.c\d+$/);
    expect(instrucoesDoChat({ loja: 'X', plataforma: '99food' }, '2')).toMatchObject({ fluxo: 2, plataforma: '99food' });
    expect(instrucoesDoChat({ loja: 'X', plataforma: '99food' }).texto).toContain('no chat da 99');
    expect(texto()).toContain('Você atende os clientes da Burger da Praça no chat do iFood');
  });

  it('as regras do chat: até 300 letras, no máximo 2 mensagens, uma linha, sem áudio', () => {
    const t = texto();
    expect(t).toContain('NO MÁXIMO 300 letras e no máximo 2 mensagens');
    expect(t).toContain('numa linha só');
    expect(t).toContain('não ouve áudio');
  });

  it('o que a plataforma proíbe: telefone, WhatsApp, Instagram, e-mail, link (nem o do cardápio) e "chame no privado"', () => {
    const t = texto();
    for (const p of ['telefone', 'WhatsApp', 'Instagram', 'e-mail', 'link', 'nem o link do cardápio', 'chame no privado', 'a loja pode ser suspensa']) expect(t).toContain(p);
  });

  it('não promete reembolso, cancelamento, cupom nem desconto; o pedido vem no campo pedido', () => {
    const t = texto();
    expect(t).toContain('Não prometa reembolso, cancelamento, troca, cupom, desconto nem compensação');
    expect(t).toContain('O cliente JÁ fez o pedido pelo app do iFood');
    expect(t).toContain('campo pedido');
    expect(t).toContain('respostaPronta');
  });

  it('chama a pessoa direto: reclamação, item faltando, troca, cancelamento, chateado — com o resumo nas três linhas', () => {
    const t = texto();
    expect(t).toContain('faltou item, veio errado, frio ou estragado');
    expect(t).toContain('quer trocar, mudar o endereço, cancelar ou ser reembolsado');
    expect(t).toMatch(/Motivo: .*\n {2}Quer: .*\n {2}Já fiz: /);
    expect(t).toContain('foraDoHorario = true'); // a regra do horário da equipe (F1)
  });

  it('sem montar pedido nem mandar cardápio por link; as ferramentas de pedido e de link não servem', () => {
    const t = texto();
    expect(t).toContain('Aqui não se monta pedido novo nem se manda o cardápio');
    expect(t).toContain('link_personalizado');
    expect(t).toContain('NÃO servem no chat da plataforma');
    expect(t).not.toContain('Mande o link'); // nada do "cardápio primeiro" do WhatsApp
  });

  it('o teste do atendente: diz que não há pedido', () => {
    expect(texto({ teste: true })).toContain('ESTA É UMA CONVERSA DE TESTE DA LOJA: não há pedido nenhum');
    expect(texto()).not.toContain('CONVERSA DE TESTE');
  });

  it('o perfil do canal `chat` (F2) entra logo depois da abertura, sem o tom fixo; "Como hoje" = o texto padrão do chat', () => {
    const padrao = texto();
    expect(texto({ jeito: jeitoDoAtendente({}, 'chat', true) })).toBe(padrao); // sem perfil escolhido: idêntico
    const jeito = jeitoDoAtendente({ chat: { perfil: 'objetivo', jeito: 'assine como Burger' } }, 'chat', true);
    const com = texto({ jeito });
    const partes = com.split('\n\n');
    expect(partes[0]).toBe('Você atende os clientes da Burger da Praça no chat do iFood, pelo pedido que eles fizeram no iFood. Converse como uma pessoa da equipe.');
    expect(partes[1]).toBe(jeito);
    expect(partes.slice(2).join('\n\n')).toBe(padrao.split('\n\n').slice(1).join('\n\n'));
    // fora do horário: o perfil de fora do horário do chat
    const noite = jeitoDoAtendente({ chat: { perfil: 'cordial', foraDoHorario: 'objetivo' } }, 'chat', false);
    expect(noite).toContain('OBJETIVO');
  });

  it('o que a loja ensinou (F4) entra antes das ferramentas; sem itens, o texto padrão do chat', () => {
    const padrao = texto();
    expect(texto({ conhecimento: '' })).toBe(padrao);
    const bloco = blocoDoConhecimento([{ assunto: 'entrega', pergunta: 'Entregam no Centro?', resposta: 'Sim, até as 23h.' }] as any);
    const com = texto({ conhecimento: bloco }).split('\n\n');
    const i = com.indexOf(bloco.split('\n\n')[0]);
    expect(i).toBeGreaterThan(0);
    expect(com[i + bloco.split('\n\n').length]).toMatch(/^COMO DESCOBRIR AS COISAS/);
  });

  it('o texto das instruções passa na trava: nenhum contato de verdade escrito nele', () => {
    // as palavras proibidas aparecem como REGRA ("nunca escreva WhatsApp"), mas nenhum telefone, link ou @ de verdade
    expect(texto()).not.toMatch(/https?:\/\/|www\.|@[a-z0-9_.]{3,}|\d{4}[-.\s]?\d{4}/i);
    expect(temContatoProibido('Já chamei a equipe da loja.')).toBe(false);
  });
});
