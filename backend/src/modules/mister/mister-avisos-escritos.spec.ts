import {
  AVISO_ESCRITO_MAX,
  OUTROS_ABERTOS_MAX,
  conferirAvisoEscrito,
  contextoDoAviso,
  deveEscrever,
  grupoEscritoDoTipo,
  instrucoesDoAvisoEscrito,
} from './mister-avisos-escritos';
import { TIPOS_DE_AVISO } from './mister-avisos.regras';
import { GRUPOS_DE_AVISO_ESCRITO } from './mister-conversa-config.service';

// Os avisos escritos pelo Mister (versão 4, M4c): quais grupos, quando, o que vai à IA e a conferência do texto.

const AGORA = new Date('2026-11-18T23:15:00Z');
const haMin = (m: number) => new Date(AGORA.getTime() - m * 60_000);
const PEDIDO = { tipo: 'pedido_parado', titulo: 'Loja Centro · #284 · iFood 4821 aceito há 25 min e ainda não ficou pronto', detalhe: 'Confira na cozinha se ele está sendo feito.', abertoEm: haMin(25) };

describe('mister — os avisos escritos: os grupos e quando', () => {
  it('os quatro grupos do ajuste cobrem "Na loja", "Servidor da loja", "Fiscal" e "O próprio Mister"; dinheiro e ponto ficam fixos', () => {
    const porGrupo = new Map<string, Set<string>>();
    for (const t of TIPOS_DE_AVISO) {
      const g = grupoEscritoDoTipo(t.tipo);
      if (!porGrupo.has(t.grupo)) porGrupo.set(t.grupo, new Set());
      porGrupo.get(t.grupo)!.add(String(g));
    }
    expect(Object.fromEntries([...porGrupo].map(([k, v]) => [k, [...v]]))).toEqual({
      // H2b: o "Feriado chegando" fica no texto fixo (o protótipo: "Sem IA").
      'Na loja': ['loja', 'null'],
      'Servidor da loja': ['servidor'],
      Fiscal: ['fiscal'],
      'O próprio Mister': ['mister'],
      'Documentos e dinheiro': ['null'],
      'Pessoas e ponto': ['null'],
    });
    // Os grupos que o ajuste aceita são exatamente os que têm aviso escrito.
    expect([...new Set(TIPOS_DE_AVISO.map((t) => grupoEscritoDoTipo(t.tipo)).filter(Boolean))].sort()).toEqual([...GRUPOS_DE_AVISO_ESCRITO].sort());
    expect(grupoEscritoDoTipo('nao_existe')).toBeNull();
    expect(grupoEscritoDoTipo('feriado_chegando')).toBeNull();
    expect(grupoEscritoDoTipo('pedido_atrasado')).toBe('loja');
  });

  it('só ao abrir e ao escalar, e só com o grupo ligado (nasce desligado)', () => {
    expect(deveEscrever('pedido_parado', 'abriu', [])).toBe(false);
    expect(deveEscrever('pedido_parado', 'abriu', ['loja'])).toBe(true);
    expect(deveEscrever('pedido_parado', 'escalou', ['loja'])).toBe(true);
    expect(deveEscrever('pedido_parado', 'lembrou', ['loja'])).toBe(false);
    expect(deveEscrever('pedido_parado', 'resolveu', ['loja'])).toBe(false);
    expect(deveEscrever('certificado', 'abriu', ['loja'])).toBe(false);
    expect(deveEscrever('certificado', 'abriu', ['fiscal'])).toBe(true);
    expect(deveEscrever('boleto_vencendo', 'abriu', ['loja', 'servidor', 'fiscal', 'mister'])).toBe(false);
  });
});

describe('mister — os avisos escritos: o contexto e as instruções', () => {
  it('só os fatos: o título, o detalhe, há quanto tempo, o tempo da loja e até 5 outros abertos', () => {
    const outros = Array.from({ length: 7 }, (_, i) => ({ titulo: `Loja Centro · impressora ${i} parada`, abertoEm: haMin(3 + i) }));
    const ctx = contextoDoAviso(PEDIDO, 'abriu', AGORA, 20, outros);
    expect(ctx).toMatchObject({ assunto: 'Pedido parado', fase: 'abriu', minutosAberto: 25, parametro: 20, detalhe: PEDIDO.detalhe });
    expect(ctx.outrosAbertos).toHaveLength(OUTROS_ABERTOS_MAX);
    expect(ctx.outrosAbertos[0]).toEqual({ titulo: 'Loja Centro · impressora 0 parada', minutosAberto: 3 });
    // Nada de id, telefone ou empresa no que vai à IA.
    expect(Object.keys(ctx).sort()).toEqual(['assunto', 'detalhe', 'fase', 'minutosAberto', 'outrosAbertos', 'parametro', 'tipo', 'titulo']);
    // A volta lê o aviso do banco: a data vem como texto, e a conta é a mesma.
    expect(contextoDoAviso({ ...PEDIDO, abertoEm: haMin(25).toISOString() }, 'abriu', AGORA, null, [{ titulo: 'x', abertoEm: haMin(3).toISOString() }])).toMatchObject({ minutosAberto: 25, outrosAbertos: [{ minutosAberto: 3 }] });
  });

  it('as instruções proíbem número inventado e link, e levam o jeito da empresa só quando há', () => {
    const sem = instrucoesDoAvisoEscrito([]);
    expect(sem).toContain('Nenhum número que não esteja lá');
    expect(sem).toContain('Sem link');
    expect(sem).not.toContain('O JEITO DESTA EMPRESA');
    expect(instrucoesDoAvisoEscrito(['- Jeito de falar: OBJETIVO'])).toContain('O JEITO DESTA EMPRESA (só o tom; as regras acima continuam valendo):\n- Jeito de falar: OBJETIVO');
  });
});

describe('mister — os avisos escritos: a conferência do texto', () => {
  const ctx = contextoDoAviso(PEDIDO, 'abriu', AGORA, 20, []);

  it('passa o texto com os fatos do aviso (o pedido, a loja, os minutos, o tempo da loja), no formato do WhatsApp', () => {
    const t = '**Loja Centro**: o *#284 · iFood 4821* está há 25 min na cozinha — passou dos 20 min da loja. É o único aberto agora. Confira na cozinha se ele está sendo feito. 🍔';
    expect(conferirAvisoEscrito(t, ctx)).toEqual({ texto: t.replace('**Loja Centro**', '*Loja Centro*') });
  });

  it('recusa com o motivo: vazio, longo, link, número que o aviso não trouxe, o pedido ou a loja trocados', () => {
    expect(conferirAvisoEscrito('   ', ctx)).toEqual({ motivo: 'vazio' });
    expect(conferirAvisoEscrito(`Loja Centro #284 ${'a'.repeat(AVISO_ESCRITO_MAX)}`, ctx)).toEqual({ motivo: 'longo' });
    expect(conferirAvisoEscrito('Loja Centro: #284 parado. Veja em https://app.dmsregem.com/delivery', ctx)).toEqual({ motivo: 'link' });
    expect(conferirAvisoEscrito('Loja Centro: o #284 está há 25 min; os outros 3 pedidos estão no prazo.', ctx)).toEqual({ motivo: 'numero' });
    expect(conferirAvisoEscrito('Loja Centro: o #284 está há 25 min, um prejuízo de R$ 45,90.', ctx)).toEqual({ motivo: 'numero' });
    expect(conferirAvisoEscrito('Loja Centro: um pedido do iFood está há 25 min na cozinha.', ctx)).toEqual({ motivo: 'pedido' });
    expect(conferirAvisoEscrito('O #284 · iFood 4821 está há 25 min na cozinha.', ctx)).toEqual({ motivo: 'loja' });
  });

  it('o número escrito de outro jeito ("4.821", "25min") é o mesmo número; a loja sem acento e sem caixa também vale', () => {
    expect(conferirAvisoEscrito('loja centro: o #284 (iFood 4.821) está há 25min.', ctx)).toMatchObject({ texto: expect.any(String) });
    const acento = contextoDoAviso({ ...PEDIDO, titulo: 'Loja Méier · #12 sem aceite há 9 min' }, 'abriu', AGORA, null, []);
    expect(conferirAvisoEscrito('Na loja meier, o #12 está sem aceite há 9 min.', acento)).toMatchObject({ texto: expect.any(String) });
  });

  it('a nota fiscal: o "nº" do título fica no texto', () => {
    const nota = contextoDoAviso({ tipo: 'nota_sem_resposta', titulo: 'Loja Centro · nota fiscal nº 1234 (série 1) sem resposta da SEFAZ', detalhe: null, abertoEm: haMin(40) }, 'escalou', AGORA, null, []);
    expect(conferirAvisoEscrito('⏰ Loja Centro: a nota fiscal nº 1234 (série 1) continua sem resposta da SEFAZ há 40 min.', nota)).toMatchObject({ texto: expect.any(String) });
    expect(conferirAvisoEscrito('⏰ Loja Centro: a nota 1234 continua sem resposta há 40 min.', nota)).toEqual({ motivo: 'pedido' });
  });
});
