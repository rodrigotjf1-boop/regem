import { ESPERA_PARA_JUNTAR_PADRAO_MS, TETO_PARA_JUNTAR_MS, esperaDaVez, esperaParaJuntar, juntarFalas, type ParaOAtendente } from './ponte-chat.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// JUNTAR AS FALAS SEGUIDAS DO CLIENTE NO CHAT (10/11/2026, pedido 1948): a espera (env, padrão, teto, jest) e a junção
// (textos em linhas, a fala respondida = a última, todas as marcas). O caminho inteiro, com o Postgres, está em
// `atendente-no-chat-pg.spec.ts`.

const item = (id: string, texto: string, extra: any = {}): ParaOAtendente => ({
  msgId: id,
  falas: [{ id, texto } as any],
  mensagem: { instancia: 'chat:primeira', de: 'chat:primeira', tipo: 'text', texto, mensagemId: id, timestamp: 1, ...extra },
});

describe('a espera para juntar as falas do chat', () => {
  it('sem a env: 10 s fora do jest; 0 no jest (cada lote vai na hora)', () => {
    expect(esperaParaJuntar({ NODE_ENV: 'production' } as any)).toBe(ESPERA_PARA_JUNTAR_PADRAO_MS);
    expect(ESPERA_PARA_JUNTAR_PADRAO_MS).toBe(10_000);
    expect(esperaParaJuntar({ NODE_ENV: 'test' } as any)).toBe(0);
    expect(esperaParaJuntar({ NODE_ENV: 'production', ROBO_JUNTAR_CHAT_MS: '  ' } as any)).toBe(ESPERA_PARA_JUNTAR_PADRAO_MS);
  });

  it('com a env: o valor; 0 desliga; acima do teto, o teto (30 s); inválida ou negativa, o padrão', () => {
    expect(esperaParaJuntar({ NODE_ENV: 'test', ROBO_JUNTAR_CHAT_MS: '400' } as any)).toBe(400);
    expect(esperaParaJuntar({ ROBO_JUNTAR_CHAT_MS: '0' } as any)).toBe(0);
    expect(esperaParaJuntar({ ROBO_JUNTAR_CHAT_MS: '999999' } as any)).toBe(TETO_PARA_JUNTAR_MS);
    expect(TETO_PARA_JUNTAR_MS).toBe(30_000);
    expect(esperaParaJuntar({ ROBO_JUNTAR_CHAT_MS: 'abc' } as any)).toBe(ESPERA_PARA_JUNTAR_PADRAO_MS);
    expect(esperaParaJuntar({ ROBO_JUNTAR_CHAT_MS: '-5' } as any)).toBe(ESPERA_PARA_JUNTAR_PADRAO_MS);
  });
});

describe('quanto esperar a cada fala nova', () => {
  it('a espera inteira enquanto cabe no teto; perto do teto, só o que falta; passado, zero (quem digita sem parar não espera para sempre)', () => {
    expect(esperaDaVez(10_000, 0, 0)).toBe(10_000);
    expect(esperaDaVez(10_000, 0, 15_000)).toBe(10_000);
    expect(esperaDaVez(10_000, 0, 25_000)).toBe(5_000);
    expect(esperaDaVez(10_000, 0, 31_000)).toBe(0);
  });
});

describe('a junção das falas da mesma conversa', () => {
  it('uma só: vai como veio (sem os campos da junção)', () => {
    const a = item('a', 'Oi');
    expect(juntarFalas([a])).toBe(a);
  });

  it('várias: os textos em linhas (sem vazios), a última responde, os campos dela mandam, todas as marcas e falas', () => {
    const j = juntarFalas([item('a', 'Oi'), item('b', '  meu pedido  '), item('c', ''), item('d', 'veio sem o refri', { timestamp: 9, pedido: { numero: '1948' } })]);
    expect(j.msgId).toBe('d');
    expect(j.ids).toEqual(['a', 'b', 'c', 'd']);
    expect(j.falas.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(j.mensagem).toEqual({
      instancia: 'chat:primeira',
      de: 'chat:primeira',
      tipo: 'text',
      texto: 'Oi\nmeu pedido\nveio sem o refri',
      mensagemId: 'd',
      timestamp: 9,
      pedido: { numero: '1948' },
      mensagensJuntadas: 4,
      mensagemIds: ['a', 'b', 'c', 'd'],
    });
  });

  it('um grupo que já era juntado entra com as marcas dele', () => {
    const ja = juntarFalas([item('a', 'Oi'), item('b', 'tudo bem?')]);
    const j = juntarFalas([ja, item('c', 'cadê meu pedido?')]);
    expect(j.ids).toEqual(['a', 'b', 'c']);
    expect(j.mensagem.texto).toBe('Oi\ntudo bem?\ncadê meu pedido?');
  });
});
