import { memoriaDoAcesso } from './mister-agente.service';
import { semLinksNoTexto } from './mister-agente.regras';
import { podeAprender } from './mister-aprendizado';
import { textoDaImagemComNumerosAMais } from './mister-imagem-numeros';
import { falaDaPessoa, perguntaComFoto } from './mister-midia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Rodada 7 de segurança, bloco E (ERR-656): o que a IA recebe e o que sai — as regras puras. O caminho com o Postgres (memória da
// empresa, relatório automático, a regra proposta e ligada na mesma vez, o cadastro pela nota e pela lista) está em
// `mister-pg.teste-spec.ts`.

describe('Rodada 7, bloco E (ERR-656)', () => {
  const trocas = [{ pergunta: 'quanto vendi ontem?', resposta: 'Ontem: R$ 4.321,45 em 87 pedidos.', hora: '10:00', consultas: ['vendas_do_periodo'] }];

  it('MIS-E-07: a memória segue o acesso de agora — sem valores, o R$ oculto; com o PIN pendente, nada', () => {
    expect(memoriaDoAcesso(trocas, { verValores: true })).toEqual(trocas);
    const sem = memoriaDoAcesso(trocas, { verValores: false });
    expect(sem[0].resposta).not.toMatch(/R\$\s*\d/);
    expect(sem[0].resposta).toContain('87 pedidos');
    expect(memoriaDoAcesso(trocas, { verValores: true, pinPendente: true })).toEqual([]);
  });

  it('MIS-E-09: da pergunta com foto, só a legenda vale como fala da pessoa (o número lido da foto, não)', () => {
    const p = perguntaComFoto({ resumo: 'cupom do mercado', descricao: 'TOTAL R$ 71,00', tipo: 'cupom' } as any, 'confere este', 'ia');
    expect(falaDaPessoa(p)).toBe('confere este');
    expect(falaDaPessoa(perguntaComFoto({ resumo: 'x', descricao: 'R$ 99,00', tipo: 'outro' } as any, '', 'ia'))).toBe('');
    expect(falaDaPessoa('faz um cartaz com R$ 29,90')).toBe('faz um cartaz com R$ 29,90');
  });

  it('MIS-E-11: o link escrito num nome de cadastro sai do cartão; o resto fica', () => {
    const cartao = semLinksNoTexto('Pausar o produto "Combo www.golpe.co" em todos os canais.');
    expect(cartao).not.toMatch(/golpe|www\./);
    expect(cartao).toContain('em todos os canais');
    expect(semLinksNoTexto('Veja [aqui](https://golpe.co/x) o pedido')).toBe('Veja aqui o pedido');
    expect(semLinksNoTexto('Mudar o preço de "X-Bacon" para R$ 39,90.')).toBe('Mudar o preço de "X-Bacon" para R$ 39,90.');
  });

  it('MIS-E-06: a ação sobre uma pessoa (ponto, escala, entregador) não vira exemplo; o resto, como antes', () => {
    for (const p of ['incluir_marcacao', 'desconsiderar_marcacao', 'trocar_turno', 'folga_na_escala', 'pagar_entregador']) expect([p, podeAprender(p)]).toEqual([p, false]);
    expect(podeAprender('pausar_canal')).toBe(true);
    expect(podeAprender('fazer_no_regem')).toBe(true);
  });

  it('MIS-E-13: a imagem que trouxe valor não pedido sai com o aviso', () => {
    expect(textoDaImagemComNumerosAMais(['R$ 19,90'])).toContain('R$ 19,90');
    expect(textoDaImagemComNumerosAMais(['R$ 19,90'])).toContain('confira antes de mandar adiante');
  });
});
