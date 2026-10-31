import { textoNaVia } from '../../common/texto-na-via';
import { perfilEfetivo } from '../delivery/cupom-perfis';
import { dadosDaViaDoDelivery } from '../delivery/via-do-delivery';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O TEXTO DO PEDIDO NÃO VIRA COMANDO DA IMPRESSORA (ERR-334). A impressora lê marcas no começo de cada linha
// (`edge/escpos.mjs`): "@GAVETA" sozinho numa linha ABRE A GAVETA DE DINHEIRO, "@QR:…" imprime um QR. Um pedido
// forjado no cardápio público (ou uma observação de canal) com "x" + quebra de linha + "@GAVETA" na referência abria a
// gaveta da loja na hora da impressão.
const linhaDeComando = (conteudo: string) => conteudo.split(/\r?\n/).filter((l) => l.trim() === '@GAVETA' || /^@QR:https?:\/\/mal/.test(l));

describe('texto do pedido na via impressa', () => {
  it('limpa: a quebra vira espaço, sem caractere de controle e sem "@" no começo', () => {
    expect(textoNaVia('Ana\n@GAVETA')).toBe('Ana @GAVETA');
    expect(textoNaVia('@GAVETA')).toBe('GAVETA');
    expect(textoNaVia('@@QR:http://mal.invalid')).toBe('QR:http://mal.invalid');
    expect(textoNaVia('sem\tcebola\u001b')).toBe('sem cebola');
    expect(textoNaVia('Rua A, 10')).toBe('Rua A, 10');
    expect(textoNaVia(null)).toBe('');
  });

  const servico = new ProducaoPedidoService({} as any, {} as any, {} as any);
  const itens = [{ quantidade: 1, descricao: 'Lanche Fictício', precoUnitario: 10, observacao: 'sem cebola\n@GAVETA' }];
  const pedido = {
    canal: 'cardapio',
    displayId: '7',
    numero: 3,
    tipo: 'entrega',
    clienteNome: 'Ana\n@GAVETA',
    clienteTelefone: '(00) 0000-0000',
    enderecoRua: 'Rua Fictícia',
    enderecoNumero: '10',
    enderecoBairro: 'Centro',
    enderecoReferencia: 'portão\n@QR:http://mal.invalid/pix',
    total: '10.00',
    formaPagamento: 'dinheiro',
    pago: false,
  };

  it('via do entregador: nome, referência e observação do item com "@GAVETA"/"@QR:" não viram comando', () => {
    const conteudo = servico.renderCupomPerfil(
      perfilEfetivo('entregador', null),
      dadosDaViaDoDelivery(pedido, itens, { qrData: 'https://exemplo.invalid/e/abc' }),
    );
    expect(linhaDeComando(conteudo)).toEqual([]);
    expect(conteudo).toContain('@QR:https://exemplo.invalid/e/abc'); // o QR do próprio Regem continua
    expect(conteudo).toContain('Ana @GAVETA'); // o texto aparece, como texto
  });

  it('via de produção (cozinha): o nome do cliente e a observação do item também', () => {
    const its = [{ quantidade: 1, descricao: 'Lanche Fictício', observacao: 'bem passado\n@GAVETA', escolhas: [] }];
    const ctx = { origem: 'delivery', canal: 'cardapio', displayId: '7', pedidoNumero: 3, cliente: 'Bia\n@GAVETA', senha: 1, senhaPrefixo: 'D' };
    const conteudo = (servico as any).renderTicket(ctx, its, 57, null) as string;
    expect(linhaDeComando(conteudo)).toEqual([]);
    expect(conteudo).toContain('Bia @GAVETA');
  });
});
