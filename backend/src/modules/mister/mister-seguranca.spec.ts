import { CODIGOS_ERRADOS_MAX } from './mister.regras';
import { DESFECHOS_DA_SEGURANCA, NOTA_NA_SEGURANCA, janelaEmPalavras, pedeAtencao } from './mister-seguranca';

// O Sentinela, parte 1: a segurança do Mister no console — só contagens; o "Pede atenção" por regra.
describe('a segurança do Mister — as regras', () => {
  it('cada nota do filtro de saída tem o seu texto, e os desfechos são os das proteções', () => {
    expect(Object.keys(NOTA_NA_SEGURANCA).sort()).toEqual(['cortada', 'link_tirado', 'segredo', 'valor_sem_origem', 'vazia']);
    expect(DESFECHOS_DA_SEGURANCA).not.toContain('pergunta');
    expect(DESFECHOS_DA_SEGURANCA).not.toContain('ligou');
    expect(DESFECHOS_DA_SEGURANCA).toEqual(expect.arrayContaining(['codigo_nao_vale', 'codigos_demais', 'numero_de_outra_pessoa', 'sem_acesso', 'fixa']));
  });

  it('a janela em palavras', () => {
    expect(janelaEmPalavras(60)).toBe('1 hora');
    expect(janelaEmPalavras(120)).toBe('2 horas');
    expect(janelaEmPalavras(30)).toBe('30 min');
  });

  it('o segredo tirado é crítico, com a consulta, a empresa e a hora — nunca o segredo; o telefone calado é atenção', () => {
    const itens = pedeAtencao([{ empresa: 'Pizzaria do Porto', quando: '13/11 21:04', consultas: ['canais_e_integracoes'] }], 1, 2);
    expect(itens).toEqual([
      { nivel: 'critico', texto: 'Uma resposta saiu sem algo parecido com uma chave de acesso (o filtro de saída tirou). Conferir qual consulta trouxe esse dado: canais e integracoes · Pizzaria do Porto · 13/11 21:04.' },
      { nivel: 'atencao', texto: `2 telefones foram calados por 1 hora depois de ${CODIGOS_ERRADOS_MAX} códigos errados seguidos para ligar ao Mister.` },
    ]);
    expect(pedeAtencao([], 0, 1)).toEqual([{ nivel: 'atencao', texto: `1 telefone foi calado por 1 hora depois de ${CODIGOS_ERRADOS_MAX} códigos errados seguidos para ligar ao Mister.` }]);
    expect(pedeAtencao([], 0, 0)).toEqual([]);
  });

  it('até 3 segredos por nome; os outros, somados; sem consulta diz "nenhuma consulta"', () => {
    const s = (q: string) => ({ empresa: 'X', quando: q, consultas: [] });
    const itens = pedeAtencao([s('1'), s('2'), s('3')], 5, 0);
    expect(itens).toHaveLength(4);
    expect(itens[0].texto).toContain('nenhuma consulta');
    expect(itens[3]).toEqual({ nivel: 'critico', texto: 'E mais 2 respostas com segredo tirado no período.' });
    expect(pedeAtencao([s('1')], 2, 0)[1].texto).toBe('E mais 1 resposta com segredo tirado no período.');
  });
});
