import {
  CHAMEI_A_EQUIPE,
  FORA_DO_HORARIO_FIXA,
  RESPOSTAS_POR_HORA,
  decidir,
  fraseForaDoHorarioNoChat,
  intencaoDoCliente,
  respostaDoRobo,
  type PedidoDoRobo,
} from './robo-do-chat';
import { TEXTO_MAX, temContatoProibido } from './texto-do-chat';
import type { SituacaoDaEquipe } from '../atendimento/horario-da-equipe';

// O robô no chat do iFood e da 99 (ponte do chat, Etapa 3) — as regras sem banco: o que ele entende, o que ele responde
// por situação e por quem entrega, e quando chama a equipe.

describe('o robô do chat: a intenção do cliente', () => {
  it.each([
    'Cadê meu pedido?',
    'cade o pedido',
    'Já saiu?',
    'Vai demorar muito?',
    'Ainda não chegou',
    'onde está meu pedido',
    'Qual a previsão?',
    'chega que horas?',
    'tá demorando hein',
  ])('"%s" → onde está', (t) => expect(intencaoDoCliente(t)).toBe('onde_esta'));
  it.each([
    'Pode pedir ele pra subir por favor, é uma criança que vai pegar', // o caso real de 05/11 (#8916): é da equipe
    'Meu lanche veio frio',
    'Cadê meu pedido? Isso é um absurdo', // "cadê" junto de raiva: equipe
    'quero cancelar',
    'veio sem o refrigerante',
    'Boa noite',
    'Pode trocar o endereço?',
  ])('"%s" → outra (é da equipe)', (t) => expect(intencaoDoCliente(t)).toBe('outra'));
  it.each(['Obrigada!', 'ok', '👍'])('"%s" → agradecimento', (t) => expect(intencaoDoCliente(t)).toBe('agradecimento'));
});

describe('o robô do chat: a resposta pelo dado do pedido', () => {
  const base: PedidoDoRobo = { status: 'despachado', despachadoEm: '2026-11-05T23:05:00Z', modo: 'propria_canal', cliente: 'MARIA SILVA', canal: 'ifood' };
  it('saiu (entrega da loja): a hora da saída e a previsão; sem previsão, "já está a caminho"', () => {
    expect(respostaDoRobo(base, '20h32')).toBe('Oi, Maria! Seu pedido saiu às 20h05 e chega por volta das 20h32.');
    expect(respostaDoRobo(base, null)).toBe('Oi, Maria! Seu pedido saiu às 20h05 e já está a caminho.');
  });
  it('saiu com o entregador da plataforma: acompanhar pelo app (o Regem não sabe onde ele está)', () => {
    expect(respostaDoRobo({ ...base, modo: 'logistica_canal' }, null)).toBe('Oi, Maria! Seu pedido já saiu com o entregador do iFood. Dá para acompanhar pelo app do iFood.');
    expect(respostaDoRobo({ ...base, modo: 'logistica_canal', canal: '99food' }, null)).toContain('entregador da 99');
  });
  it('em preparo, pronto e retirada', () => {
    expect(respostaDoRobo({ ...base, status: 'confirmado' }, '20h40')).toBe('Oi, Maria! Seu pedido está sendo preparado e sai em breve. Chega por volta das 20h40.');
    expect(respostaDoRobo({ ...base, status: 'pronto' }, null)).toBe('Oi, Maria! Seu pedido está pronto e sai em instantes.');
    expect(respostaDoRobo({ ...base, status: 'pronto', modo: 'logistica_canal' }, null)).toBe('Oi, Maria! Seu pedido está pronto, esperando o entregador do iFood.');
    expect(respostaDoRobo({ ...base, status: 'pronto', modo: 'retirada' }, null)).toBe('Oi, Maria! Seu pedido está pronto: já pode retirar na loja.');
    expect(respostaDoRobo({ ...base, status: 'novo', modo: 'retirada' }, '20h40')).toBe('Oi, Maria! Seu pedido está sendo preparado e logo fica pronto para retirar.');
  });
  it('entregue, concluído, cancelado ou situação desconhecida: ele não sabe dizer (vai para a equipe)', () => {
    for (const status of ['entregue', 'concluido', 'cancelado', 'qualquer']) expect(respostaDoRobo({ ...base, status }, '20h32')).toBeNull();
    expect(respostaDoRobo({ ...base, status: 'despachado', modo: 'retirada' }, null)).toBeNull();
  });
  it('o nome do pedido é a parte que varia: com link ou comprido demais, o robô não manda (a equipe atende)', () => {
    expect(respostaDoRobo({ ...base, cliente: 'www.minhaloja.com.br Silva' }, null)).toBeNull();
    expect(respostaDoRobo({ ...base, cliente: 'A'.repeat(320) }, null)).toBeNull();
    expect(
      decidir({ intencao: 'onde_esta', casoAberto: false, respostasNaHora: 0, pedido: { ...base, cliente: 'insta @lojinha_oficial' }, horaPrevista: null, fala: 'Cadê?', canal: 'ifood' }),
    ).toMatchObject({ acao: 'chamar_equipe' });
  });

  it('sem nome, "Oi!"; toda frase passa na trava da plataforma e cabe no chat', () => {
    expect(respostaDoRobo({ ...base, cliente: null }, null)).toBe('Oi! Seu pedido saiu às 20h05 e já está a caminho.');
    const todas = [CHAMEI_A_EQUIPE];
    for (const status of ['novo', 'confirmado', 'pronto', 'despachado'])
      for (const modo of ['propria_canal', 'logistica_canal', 'retirada'] as const)
        for (const canal of ['ifood', '99food'] as const) {
          const t = respostaDoRobo({ ...base, status, modo, canal, cliente: 'Maria' }, '23h59');
          if (t) todas.push(t);
        }
    expect(todas.length).toBeGreaterThan(10);
    for (const t of todas) {
      expect(temContatoProibido(t)).toBe(false);
      expect(t.length).toBeLessThanOrEqual(TEXTO_MAX);
    }
  });
});

describe('o robô do chat: a decisão', () => {
  const pedido: PedidoDoRobo = { status: 'despachado', despachadoEm: '2026-11-05T23:05:00Z', modo: 'propria_canal', cliente: 'Maria', canal: 'ifood' };
  const base = { intencao: 'onde_esta' as const, casoAberto: false, respostasNaHora: 0, pedido, horaPrevista: null, fala: 'Cadê meu pedido?', canal: 'ifood' as const };
  it('responde o "cadê" com o pedido; quieto com o caso aberto; nada no agradecimento', () => {
    expect(decidir(base)).toEqual({ acao: 'responder', texto: 'Oi, Maria! Seu pedido saiu às 20h05 e já está a caminho.' });
    expect(decidir({ ...base, casoAberto: true })).toEqual({ acao: 'quieto' });
    expect(decidir({ ...base, intencao: 'agradecimento', fala: 'Obrigada!' })).toEqual({ acao: 'nada' });
  });
  it(`a ${RESPOSTAS_POR_HORA + 1}ª pergunta na hora, sem pedido ligado, ou o que ele não sabe: chama a equipe com o resumo`, () => {
    const repetida = decidir({ ...base, respostasNaHora: RESPOSTAS_POR_HORA });
    expect(repetida).toMatchObject({ acao: 'chamar_equipe', urgente: false, resumo: { motivo: 'Perguntou de novo pelo pedido (o robô já respondeu)', quer: 'Cadê meu pedido?' } });
    expect(decidir({ ...base, pedido: null })).toMatchObject({ acao: 'chamar_equipe', resumo: { motivo: 'Perguntou pelo pedido (o robô não tem como dizer)' } });
    expect(decidir({ ...base, pedido: { ...pedido, status: 'entregue' }, fala: 'Ainda não chegou' })).toMatchObject({ acao: 'chamar_equipe' });
  });
  it('ninguém envia pelo canal: o robô não responde (chama a equipe sem dizer que avisou); quieto e agradecimento seguem', () => {
    expect(decidir({ ...base, envia: false })).toEqual({
      acao: 'chamar_equipe',
      urgente: false,
      resumo: { motivo: 'Perguntou pelo pedido', quer: 'Cadê meu pedido?', jaFez: 'Não respondeu: nenhum PC da ponte envia pelo chat do iFood agora', humor: null },
    });
    expect(decidir({ ...base, canal: '99food', envia: false, intencao: 'outra', fala: 'Veio frio, um absurdo' })).toMatchObject({
      urgente: true,
      resumo: { motivo: 'Mensagem no chat da 99', jaFez: 'Não respondeu: nenhum PC da ponte envia pelo chat da 99 agora' },
    });
    expect(decidir({ ...base, envia: false, casoAberto: true })).toEqual({ acao: 'quieto' });
    expect(decidir({ ...base, envia: false, intencao: 'agradecimento', fala: 'Obrigada!' })).toEqual({ acao: 'nada' });
    expect(decidir({ ...base, envia: true })).toMatchObject({ acao: 'responder' });
  });
  it('reclamação com raiva: chama a equipe URGENTE, humor chateado', () => {
    expect(decidir({ ...base, intencao: 'outra', fala: 'Veio tudo frio, um absurdo' })).toEqual({
      acao: 'chamar_equipe',
      urgente: true,
      resumo: {
        motivo: 'Mensagem no chat do iFood', // "cliente chateado" vem do humor (a tela junta)
        quer: 'Veio tudo frio, um absurdo',
        jaFez: 'Avisou o cliente no chat que chamou a equipe da loja',
        humor: 'chateado',
      },
    });
  });
});

// Mig 379: fora do horário da equipe, o "Já chamei a equipe" vira a frase de quando a equipe volta — pela trava da
// plataforma (nada de telefone, WhatsApp, Instagram ou link) e em até 300 letras.
describe('o robô do chat: a frase de fora do horário da equipe', () => {
  const equipe = (textoFora: string | null): SituacaoDaEquipe => ({
    modo: 'loja',
    atendendo: false,
    voltaEm: new Date('2026-11-09T20:30:00Z'),
    voltaTexto: 'hoje às 17:30',
    frase: null,
    textoFora,
  });
  const recado = { ate: '2026-11-09T20:30:00.000Z' };
  const agora = new Date('2026-11-09T05:00:00Z');
  beforeAll(() => jest.useFakeTimers({ now: agora }));
  afterAll(() => jest.useRealTimers());

  it('a frase da loja com a volta pelo `ate` do recado', () => {
    expect(fraseForaDoHorarioNoChat(equipe('Voltamos {volta}, já anotei aqui.'), recado)).toBe('Voltamos hoje às 17:30, já anotei aqui.');
  });
  it('sem a da loja, a padrão; e ela passa na trava', () => {
    const t = fraseForaDoHorarioNoChat(equipe(null), recado);
    expect(t).toBe('Nossa equipe volta hoje às 17:30. Já deixei o seu recado aqui e respondemos assim que começarmos.');
    expect(temContatoProibido(t)).toBe(false);
    expect(t.length).toBeLessThanOrEqual(TEXTO_MAX);
  });
  it('a da loja com contato ou comprida demais (com a volta) não sai: vai a padrão', () => {
    expect(fraseForaDoHorarioNoChat(equipe('Fala com a gente no WhatsApp: {volta}'), recado)).toContain('Nossa equipe volta hoje às 17:30');
    expect(fraseForaDoHorarioNoChat(equipe(`${'x'.repeat(290)} {volta}`), recado)).toContain('Nossa equipe volta hoje às 17:30');
  });
  it('a frase fixa (a última saída) também passa na trava; sem recado nem equipe, a padrão sem hora', () => {
    expect(temContatoProibido(FORA_DO_HORARIO_FIXA)).toBe(false);
    expect(fraseForaDoHorarioNoChat(undefined, null)).toBe('Nossa equipe volta em breve. Já deixei o seu recado aqui e respondemos assim que começarmos.');
    expect(fraseForaDoHorarioNoChat(undefined, null)).not.toBe(CHAMEI_A_EQUIPE);
  });
});
