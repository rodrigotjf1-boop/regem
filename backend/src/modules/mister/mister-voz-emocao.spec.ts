import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ErroMcp } from '../../dms/integracao-dms';
import { MOTIVO_ARGUMENTO_RECUSADO, recusouArgumento } from '../graph/graph.regras';
import { CONVERSA_PADRAO, conferirConversa } from './mister-conversa-config.service';
import { EstiloDaVoz, TONS_DE_QUEM_FALA, TonsNaMemoria, TomDeQuemFala, chaveDaFala, estiloDaVoz, oQueOGraphOuviu, tomDoLote } from './mister-midia.regras';
import { MisterMidiaService } from './mister-midia.service';

// A voz com emoção (versão 7, V7d; decisões V7-4, V7-5 e V7-6): a regra pura do estilo, o tom só em memória e o caminho com o
// DMS Graph antigo (0.11.1, que recusa os argumentos novos): o áudio nunca deixa de sair por causa da emoção.

const SEM_RISADA = (tom: EstiloDaVoz['tom']): EstiloDaVoz => ({ tom, risada: false });

describe('o estilo da voz: é o código quem decide', () => {
  const BOA = 'Bateu sim! R$ 7.980, a melhor sexta do mês. E o smash duplo saiu 58 vezes só no pico.';

  it('cada tom na sua voz, numa resposta sem tema nenhum', () => {
    expect(estiloDaVoz('animado', BOA)).toEqual({ tom: 'animado', risada: true });
    expect(estiloDaVoz('brincando', BOA)).toEqual({ tom: 'animado', risada: true });
    expect(estiloDaVoz('apressado', BOA)).toEqual(SEM_RISADA('direto'));
    expect(estiloDaVoz('irritado', BOA)).toEqual(SEM_RISADA('calmo'));
    expect(estiloDaVoz('preocupado', BOA)).toEqual(SEM_RISADA('calmo'));
    expect(estiloDaVoz('neutro', BOA)).toEqual(SEM_RISADA('neutro'));
  });

  it('sem tom (a repetição pela mesma chave, o processo reiniciado): vale neutro', () => {
    expect(estiloDaVoz(null, BOA)).toEqual(SEM_RISADA('neutro'));
    expect(estiloDaVoz(undefined, BOA)).toEqual(SEM_RISADA('neutro'));
    expect(estiloDaVoz('outro' as TomDeQuemFala, BOA)).toEqual(SEM_RISADA('neutro'));
  });

  it.each([
    'Hoje deu prejuízo de R$ 300.',
    'O desperdício lançado soma R$ 1.280,00.',
    'A loja vendeu menos que ontem.',
    'Vendemos bem menos nesta semana.',
    'A venda caiu 12% na terça.',
    'O faturamento diminuiu.',
    'As vendas estão fracas.',
    'Houve uma queda no almoço.',
    'Perdeu 16 kg de carne.',
    'A dívida com o fornecedor é de R$ 2.000.',
    'Ficou abaixo da meta.',
    'O caixa está no vermelho.',
    'Menos pedidos que na sexta passada.',
  ])('perda ou queda: sério, qualquer que seja o tom, e nunca ri (%s)', (frase) => {
    for (const tom of TONS_DE_QUEM_FALA) expect(estiloDaVoz(tom, frase)).toEqual(SEM_RISADA('serio'));
  });

  it.each([
    'O cliente reclamou do lanche frio.',
    'Vi a reclamação do pedido #27.',
    'O pedido #31 foi cancelado.',
    'Dois pedidos atrasados na chapa.',
    'Deu erro na impressora.',
    'A maquininha falhou de novo.',
    'Tivemos um problema no delivery.',
    'O iFood ficou fora do ar.',
  ])('assunto ruim com a pessoa rindo: não acompanha, não ri (%s)', (frase) => {
    expect(estiloDaVoz('animado', frase)).toEqual(SEM_RISADA('neutro'));
    expect(estiloDaVoz('brincando', frase)).toEqual(SEM_RISADA('neutro'));
  });

  it.each([
    'O cliente elogiou o smash!',
    'A clientela adorou a promoção.',
    'O funcionário do mês bateu a meta!',
    'A equipe mandou muito bem hoje.',
    'O entregador fez 30 corridas.',
    'O garçom vendeu 40 sobremesas.',
  ])('frase boa que fala de gente: fica animado, mas sem risada (%s)', (frase) => {
    expect(estiloDaVoz('animado', frase)).toEqual({ tom: 'animado', risada: false });
    expect(estiloDaVoz('brincando', frase)).toEqual({ tom: 'animado', risada: false });
  });

  it('o assunto vem também da PERGUNTA: rir de um cliente não vira risada, mesmo que a resposta não diga a palavra', () => {
    const resposta = 'Vale responder hoje. Quer que eu escreva?';
    expect(estiloDaVoz('brincando', resposta)).toEqual({ tom: 'animado', risada: true });
    expect(estiloDaVoz('brincando', resposta, '⟦áudio⟧ Kkkk, olha o cliente reclamando que o lanche veio frio!')).toEqual(SEM_RISADA('neutro'));
    expect(estiloDaVoz('animado', resposta, '⟦áudio⟧ O cliente da mesa 4 é uma figura!')).toEqual({ tom: 'animado', risada: false });
    expect(estiloDaVoz('animado', resposta, '⟦áudio⟧ O freezer parou. Perdi muita coisa?')).toEqual(SEM_RISADA('serio'));
  });

  it('os casos do protótipo', () => {
    expect(estiloDaVoz('animado', BOA, 'Mister, que sexta foi essa, rapaz! Bateu recorde?')).toEqual({ tom: 'animado', risada: true });
    expect(estiloDaVoz('apressado', 'R$ 1.240,00, aberto desde as 11:02.', 'Rápido, quanto tem no caixa do balcão?')).toEqual(SEM_RISADA('direto'));
    expect(estiloDaVoz('irritado', 'Entendi. Agora são dois: o #31 com 34 minutos e o #33 com 28, os dois na chapa. Quer que eu avise os clientes?', 'De novo pedido atrasado, que saco, ninguém resolve nada!')).toEqual(SEM_RISADA('calmo'));
    expect(estiloDaVoz('preocupado', 'Sinto muito. O desperdício lançado hoje soma R$ 1.280,00, 16 kg de carne.', 'O freezer parou de noite. Perdi muita coisa?')).toEqual(SEM_RISADA('serio'));
    expect(estiloDaVoz('brincando', 'Aí vou querer aviso prévio! Hoje tem blend para 64 smash. Quer que eu te avise se baixar de 20?', 'Se o smash acabar de novo eu te demito, hein!')).toEqual({ tom: 'animado', risada: true });
    expect(estiloDaVoz('animado', 'Vi a reclamação do pedido #27: ele saiu 18 minutos depois de pronto. Vale responder hoje.', 'Kkkk, olha o cliente reclamando que o lanche veio frio!')).toEqual(SEM_RISADA('neutro'));
  });

  it('palavra parecida não dispara o tema, e acento e maiúscula não escondem', () => {
    for (const frase of ['Quero ver o ferro de solda', 'Há duas semanas atrás vendeu bem', 'Pode me dar uma dúvida?', 'O perdão foi aceito', 'O caixa bateu certinho']) {
      expect(estiloDaVoz('animado', frase)).toEqual({ tom: 'animado', risada: true });
    }
    for (const frase of ['PREJUÍZO de R$ 10', 'prejuizo de R$ 10', 'Prejuízos no mês']) expect(estiloDaVoz('animado', frase).tom).toBe('serio');
    expect(estiloDaVoz('animado', 'RECLAMAÇÃO no balcão').risada).toBe(false);
    expect(estiloDaVoz('animado', 'O CLIENTE voltou').risada).toBe(false);
  });

  it('várias mensagens juntas: vale a última, e a alegria só se todas estavam alegres', () => {
    expect(tomDoLote([])).toBeNull();
    expect(tomDoLote(['animado'])).toBe('animado');
    expect(tomDoLote(['animado', 'brincando'])).toBe('brincando');
    expect(tomDoLote(['irritado', 'animado'])).toBe('neutro');
    expect(tomDoLote(['animado', 'irritado'])).toBe('irritado');
    expect(tomDoLote(['neutro', 'apressado'])).toBe('apressado');
  });
});

describe('o tom só na memória (V7-5)', () => {
  const T = '11111111-1111-1111-1111-111111111111';

  it('serve uma vez: tirar apaga; outra empresa não enxerga', () => {
    const m = new TonsNaMemoria();
    m.guardar(T, 'wamid.1', 'animado');
    expect(m.tirar('22222222-2222-2222-2222-222222222222', ['wamid.1'])).toEqual([]);
    expect(m.tirar(T, ['wamid.1', null, 'wamid.nao'])).toEqual(['animado']);
    expect(m.tirar(T, ['wamid.1'])).toEqual([]);
    expect(m.tamanho).toBe(0);
  });

  it('vence sozinho, e a memória tem teto (sai o mais antigo)', () => {
    let agora = 1_000;
    const m = new TonsNaMemoria(100, 3, () => agora);
    m.guardar(T, 'a', 'animado');
    agora = 1_101;
    expect(m.tirar(T, ['a'])).toEqual([]);
    agora = 2_000;
    for (const w of ['b', 'c', 'd', 'e']) m.guardar(T, w, 'neutro');
    expect(m.tamanho).toBe(3);
    expect(m.tirar(T, ['b'])).toEqual([]);
    expect(m.tirar(T, ['c', 'd', 'e'])).toEqual(['neutro', 'neutro', 'neutro']);
    agora = 3_000;
    m.guardar(T, 'f', 'neutro');
    agora = 3_101;
    m.guardar(T, 'g', 'neutro');
    expect(m.tamanho).toBe(1);
  });

  it('o tom do Graph só entra se for da lista', () => {
    const base = { tipoArquivo: 'audio', transcricao: 'Oi', inaudivel: false };
    expect(oQueOGraphOuviu(base)).toEqual({ transcricao: 'Oi', inaudivel: false });
    expect(oQueOGraphOuviu({ ...base, tom: 'animado' })).toEqual({ transcricao: 'Oi', inaudivel: false, tom: 'animado' });
    expect(oQueOGraphOuviu({ ...base, tom: 'furioso' })).toEqual({ transcricao: 'Oi', inaudivel: false });
    expect(oQueOGraphOuviu({ ...base, tom: 1 })).toEqual({ transcricao: 'Oi', inaudivel: false });
  });

  it('a chave da fala: sem estilo, a de sempre; com estilo, outra para cada estilo', () => {
    const texto = 'Ontem a loja vendeu bem.';
    const hoje = `regem-falar-${createHash('sha256').update(`${T}\n${texto}`).digest('hex').slice(0, 48)}`;
    expect(chaveDaFala(T, texto)).toBe(hoje);
    expect(chaveDaFala(T, texto, null)).toBe(hoje);
    const estilos: EstiloDaVoz[] = [{ tom: 'animado', risada: true }, { tom: 'animado', risada: false }, { tom: 'calmo', risada: false }];
    const chaves = estilos.map((e) => chaveDaFala(T, texto, e));
    expect(new Set([hoje, ...chaves]).size).toBe(4);
    for (const c of chaves) expect(c).toMatch(/^regem-falar-[0-9a-f]{48}$/);
  });

  it('o ajuste nasce desligado e só aceita booleano (V15)', () => {
    expect(CONVERSA_PADRAO.vozComEmocao).toBe(false);
    expect(conferirConversa({ vozComEmocao: true })).toEqual({ vozComEmocao: true });
    expect(conferirConversa({ vozComEmocao: false })).toEqual({ vozComEmocao: false });
    for (const v of ['true', 1, null, {}]) expect(conferirConversa({ vozComEmocao: v })).toHaveProperty('erro');
  });

  it('a recusa de argumento se reconhece pelo código, nunca pela frase', () => {
    const recusa = (codigo: string) => new ErroMcp({ tipo: 'ferramenta', ferramenta: 'falar', status: 200, frase: 'Argumento desconhecido: estilo.', dados: { situacao: 'recusado', codigo } });
    expect(recusouArgumento(recusa('parametro-invalido'))).toBe(true);
    expect(recusouArgumento(recusa('erro-interno'))).toBe(false);
    expect(recusouArgumento(new ErroMcp({ tipo: 'indisponivel', ferramenta: 'falar', problema: 'parametro-invalido' }))).toBe(false);
    expect(recusouArgumento(new Error('parametro-invalido'))).toBe(false);
  });
});

describe('o serviço: o Graph antigo nunca impede o áudio', () => {
  const T = '11111111-1111-1111-1111-111111111111';
  const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40, 5)]);
  const TEXTO = 'Bateu sim! R$ 7.980, a melhor sexta do mês.';
  const QUEM = { telefone: '5521999990000', tenantId: T, colaboradorId: 'c', unidadeId: null, nivel: 'presidente', nome: 'Ana' } as any;
  const MIDIA = { tipo: 'audio', id: 'm1', mime: 'audio/ogg; codecs=opus', legenda: null } as any;
  const antes = process.env.MISTER_MIDIA;

  type Chamada = { texto: string; chave: string; prazoMs: number; estilo?: unknown; args: number };

  function montar(o: { falar?: (c: Chamada, aoFalhar: (m: string) => void) => Promise<Buffer | null> | Buffer | null; ouvir?: (ops: any, aoFalhar: (m: string) => void) => unknown; ajustes?: any } = {}) {
    const falas: Chamada[] = [];
    const leituras: any[] = [];
    const enviados: Buffer[] = [];
    const avisos: string[] = [];
    const numero = {
      enviarAudio: async (_t: string, b: Buffer) => void enviados.push(b),
      enviar: async () => undefined,
      baixarMidia: async () => ({ buffer: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40)]), mime: 'audio/ogg' }),
    };
    const graph = {
      ligacaoParaFoto: async () => ({ id: 'l', segredo: 's' }),
      async falar(...a: any[]) {
        const c: Chamada = { texto: a[2], chave: a[3], prazoMs: a[4], estilo: a[6], args: a.length };
        falas.push(c);
        const r = o.falar ? await o.falar(c, a[5]) : OGG;
        return r;
      },
      async analisar(_t: string, _l: unknown, foto: any, prazoMs: number, traduzir: (d: unknown) => unknown, opcoes: any) {
        leituras.push({ foto, prazoMs, opcoes });
        const dados = o.ouvir ? o.ouvir(opcoes, opcoes.aoFalhar) : { tipoArquivo: 'audio', transcricao: 'Que sexta, rapaz!', inaudivel: false, ...(opcoes.extras?.lerTom ? { tom: 'animado' } : {}) };
        return dados ? traduzir(dados) : null;
      },
    };
    const conversa = { daEmpresa: async () => o.ajustes ?? { responderAudio: true, vozComEmocao: true } };
    const s = new MisterMidiaService(numero as any, {} as any, undefined, graph as any, conversa as any);
    jest.spyOn((s as any).logger as Logger, 'warn').mockImplementation((m: any) => void avisos.push(String(m)));
    jest.spyOn((s as any).logger as Logger, 'log').mockImplementation((m: any) => void avisos.push(String(m)));
    return { s, falas, leituras, enviados, avisos };
  }
  /** Como o Graph 0.11.1: recusa `estilo` antes de reservar. */
  const grafoAntigoNaFala = (c: Chamada, aoFalhar: (m: string) => void) => {
    if (c.estilo) {
      aoFalhar(MOTIVO_ARGUMENTO_RECUSADO);
      return null;
    }
    return OGG;
  };

  beforeEach(() => {
    process.env.MISTER_MIDIA = '1';
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.MISTER_MIDIA;
    else process.env.MISTER_MIDIA = antes;
  });

  it('sem `emocao` (o ajuste desligado): a chamada é a de hoje, sem o argumento e com a chave de sempre', async () => {
    const { s, falas, enviados } = montar();
    expect(await s.responderEmAudio(T, QUEM.telefone, TEXTO)).toBe('enviado');
    expect(falas).toHaveLength(1);
    expect(falas[0]).toMatchObject({ texto: TEXTO, chave: chaveDaFala(T, TEXTO), prazoMs: 20_000, args: 6 });
    expect(falas[0].estilo).toBeUndefined();
    expect(enviados).toHaveLength(1);
  });

  it('com o tom em memória: o estilo vai ao Graph, com a chave do estilo, e o tom é gasto', async () => {
    const { s, falas } = montar();
    s.tons.guardar(T, 'wamid.1', 'animado');
    expect(await s.responderEmAudio(T, QUEM.telefone, TEXTO, { wamids: ['wamid.1'], pergunta: '⟦áudio⟧ Que sexta!' })).toBe('enviado');
    const estilo = { tom: 'animado', risada: true };
    expect(falas).toEqual([expect.objectContaining({ texto: TEXTO, chave: chaveDaFala(T, TEXTO, estilo as EstiloDaVoz), estilo, args: 7 })]);
    expect(s.tons.tamanho).toBe(0);
    // A mesma resposta de novo, sem tom guardado: neutro.
    await s.responderEmAudio(T, QUEM.telefone, TEXTO, { wamids: ['wamid.1'], pergunta: '⟦áudio⟧ Que sexta!' });
    expect(falas[1].estilo).toEqual({ tom: 'neutro', risada: false });
  });

  it('o Graph antigo recusa o `estilo`: repete SEM ele, com a chave de sempre, e o áudio sai na voz de hoje', async () => {
    const { s, falas, enviados } = montar({ falar: grafoAntigoNaFala });
    s.tons.guardar(T, 'wamid.1', 'animado');
    expect(await s.responderEmAudio(T, QUEM.telefone, TEXTO, { wamids: ['wamid.1'], pergunta: 'x' })).toBe('enviado');
    expect(falas).toHaveLength(2);
    expect(falas[0].estilo).toEqual({ tom: 'animado', risada: true });
    expect(falas[1].estilo).toBeUndefined();
    expect(falas[1].args).toBe(6);
    expect(falas[1].chave).toBe(chaveDaFala(T, TEXTO));
    expect(enviados).toEqual([OGG]);
  });

  it('V106: a segunda tentativa usa só o que sobrou do prazo TOTAL', async () => {
    const { s, falas } = montar({
      falar: async (c, aoFalhar) => {
        if (!c.estilo) return OGG;
        await new Promise((r) => setTimeout(r, 120));
        aoFalhar(MOTIVO_ARGUMENTO_RECUSADO);
        return null;
      },
    });
    s.prazoDaVozMs = 2_000;
    expect(await s.responderEmAudio(T, QUEM.telefone, TEXTO, { wamids: [], pergunta: 'x' })).toBe('enviado');
    expect(falas[0].prazoMs).toBe(2_000);
    expect(falas[1].prazoMs).toBeLessThanOrEqual(1_885);
    expect(falas[1].prazoMs).toBeGreaterThan(1_000);
  });

  it.each(['demora', 'franquia-esgotada', 'voz-desligada', 'fora-do-formato', 'recusada:erro-interno'])('outra falha (%s) não repete: o Graph novo já tentou a voz de hoje', async (motivo) => {
    const { s, falas, enviados } = montar({
      falar: (_c, aoFalhar) => {
        aoFalhar(motivo);
        return null;
      },
    });
    expect(await s.responderEmAudio(T, QUEM.telefone, TEXTO, { wamids: [], pergunta: 'x' })).toBe(motivo);
    expect(falas).toHaveLength(1);
    expect(enviados).toEqual([]);
  });

  it('ouvir com o ajuste ligado pede o tom, guarda só em memória e a pergunta vai sem ele', async () => {
    const { s, leituras, avisos } = montar();
    const r: any = await s.olhar(QUEM, MIDIA, 'wamid.9');
    expect(leituras).toHaveLength(1);
    expect(leituras[0].opcoes.extras).toEqual({ lerTom: true });
    expect(r.pergunta).toBe('⟦áudio⟧ Que sexta, rapaz!');
    expect(JSON.stringify(r)).not.toContain('animado');
    expect(s.tons.tirar(T, ['wamid.9'])).toEqual(['animado']);
    expect(avisos.join(' ')).not.toContain('animado');
  });

  it.each([
    [{ responderAudio: false, vozComEmocao: true }],
    [{ responderAudio: true, vozComEmocao: false }],
    [{ responderAudio: false, vozComEmocao: false }],
  ])('sem os dois ajustes ligados (%j), o pedido é o de hoje e nada fica em memória', async (ajustes) => {
    const { s, leituras } = montar({ ajustes });
    await s.olhar(QUEM, MIDIA, 'wamid.10');
    expect(leituras).toHaveLength(1);
    expect(leituras[0].opcoes.extras).toBeUndefined();
    expect(s.tons.tamanho).toBe(0);
  });

  it('a leitura dos ajustes falha: ouve como hoje', async () => {
    const { s, leituras } = montar();
    (s as any).conversaConfig = { daEmpresa: async () => { throw new Error('banco fora'); } };
    const r: any = await s.olhar(QUEM, MIDIA, 'wamid.11');
    expect(r.pergunta).toBe('⟦áudio⟧ Que sexta, rapaz!');
    expect(leituras[0].opcoes.extras).toBeUndefined();
  });

  it('o Graph antigo recusa o `lerTom`: repete sem ele, a transcrição segue e fica sem tom', async () => {
    const { s, leituras } = montar({
      ouvir: (opcoes, aoFalhar) => {
        if (opcoes.extras) {
          aoFalhar(MOTIVO_ARGUMENTO_RECUSADO);
          return null;
        }
        return { tipoArquivo: 'audio', transcricao: 'Que sexta, rapaz!', inaudivel: false };
      },
    });
    const r: any = await s.olhar(QUEM, MIDIA, 'wamid.12');
    expect(r.pergunta).toBe('⟦áudio⟧ Que sexta, rapaz!');
    expect(leituras).toHaveLength(2);
    expect(leituras[1].opcoes.extras).toBeUndefined();
    expect(leituras[1].prazoMs).toBeLessThanOrEqual(leituras[0].prazoMs);
    expect(s.tons.tamanho).toBe(0);
  });

  it('a repetição pela mesma chave volta sem tom: nada fica em memória, e a resposta sai neutra', async () => {
    const { s, falas } = montar({ ouvir: () => ({ tipoArquivo: 'audio', transcricao: 'Que sexta, rapaz!', inaudivel: false }) });
    await s.olhar(QUEM, MIDIA, 'wamid.13');
    expect(s.tons.tamanho).toBe(0);
    await s.responderEmAudio(T, QUEM.telefone, TEXTO, { wamids: ['wamid.13'], pergunta: 'x' });
    expect(falas[0].estilo).toEqual({ tom: 'neutro', risada: false });
  });
});
