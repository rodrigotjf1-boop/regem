import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BALAO_MINIMO,
  baloesLigados,
  emBaloes,
  paraOWhatsapp,
  pausaAntesDoBalao,
  semFormatacao,
  separarOpcoesSoltas,
  separarPrint,
  separarReacao,
  urlDoPrint,
  PASSOS_DO_PRINT,
} from './formato-da-resposta';

describe('formato da resposta do robô (17/11/2026)', () => {
  describe('paraOWhatsapp', () => {
    it('o negrito do markdown vira o do WhatsApp (um asterisco de cada lado)', () => {
      expect(paraOWhatsapp('O **X-Bacon** sai por **R$ 32,90**.')).toBe('O *X-Bacon* sai por *R$ 32,90*.');
      expect(paraOWhatsapp('***Atenção***')).toBe('*_Atenção_*');
      expect(paraOWhatsapp('__sem cebola__ e ~~antigo~~')).toBe('_sem cebola_ e ~antigo~');
    });

    it('o que já está no jeito do WhatsApp fica igual', () => {
      const t = '🧾 *Confere o seu pedido:*\n\n*1x X-Bacon* — R$ 32,90\n   📝 _sem cebola_\n💰 *Total: R$ 32,90*';
      expect(paraOWhatsapp(t)).toBe(t);
    });

    it('título vira negrito; lista com hífen ou asterisco vira "•"; a linha divisória sai', () => {
      expect(paraOWhatsapp('## Lanches\n- X-Bacon\n* X-Salada\n+ X-Tudo\n---\nQuer qual?')).toBe(
        '*Lanches*\n• X-Bacon\n• X-Salada\n• X-Tudo\nQuer qual?',
      );
    });

    it('o asterisco do negrito no começo da linha não vira item de lista', () => {
      expect(paraOWhatsapp('*X-Bacon* — R$ 32,90')).toBe('*X-Bacon* — R$ 32,90');
    });

    it('tabela vira lista, com o cabeçalho em negrito', () => {
      const t = '| Produto | Preço |\n|---|---:|\n| X-Bacon | R$ 32,90 |\n| **Trio** | R$ 42,90 |';
      expect(paraOWhatsapp(t)).toBe('*Produto — Preço*\n• X-Bacon — R$ 32,90\n• Trio — R$ 42,90');
    });

    it('link do markdown vira texto e link; o link nunca é mexido (sublinhado e asterisco no endereço)', () => {
      expect(paraOWhatsapp('Veja [o cardápio](https://app.dmsregem.com/c/abc_def__g?x=1**2)')).toBe(
        'Veja o cardápio: https://app.dmsregem.com/c/abc_def__g?x=1**2',
      );
      expect(paraOWhatsapp('[https://a.com/x](https://a.com/x)')).toBe('https://a.com/x');
      expect(paraOWhatsapp('Aqui: https://a.com/__x__/**y** 👇')).toBe('Aqui: https://a.com/__x__/**y** 👇');
    });

    it('sobra de espaço: tira o fim das linhas e junta linhas em branco demais', () => {
      expect(paraOWhatsapp('Oi!   \n\n\n\nTudo bem?  ')).toBe('Oi!\n\nTudo bem?');
      expect(paraOWhatsapp('')).toBe('');
      expect(paraOWhatsapp(null)).toBe('');
    });
  });

  describe('semFormatacao', () => {
    it('tira negrito, itálico e riscado, de markdown e do WhatsApp', () => {
      expect(semFormatacao('O *X-Bacon* sai por **R$ 32,90** _sem cebola_ ~velho~ ***já***')).toBe(
        'O X-Bacon sai por R$ 32,90 sem cebola velho já',
      );
    });

    it('não mexe em sublinhado e asterisco no meio de palavra, conta ou link', () => {
      expect(semFormatacao('o campo nome_do_cliente e 5*3*2')).toBe('o campo nome_do_cliente e 5*3*2');
      expect(semFormatacao('Link: https://a.com/_x_/*y*')).toBe('Link: https://a.com/_x_/*y*');
    });

    it('título e tabela em texto; lista com "•"', () => {
      expect(semFormatacao('# Horários\n| Dia | Hora |\n|--|--|\n| Seg | 18h |\n- Ter')).toBe('Horários\nDia — Hora\n• Seg — 18h\n• Ter');
    });
  });

  describe('separarReacao', () => {
    it('tira a linha e devolve a reação permitida', () => {
      expect(separarReacao('De nada, volte sempre!\nREACAO: ❤️')).toEqual({ texto: 'De nada, volte sempre!', reacao: '❤️' });
      expect(separarReacao('REAÇÃO: 👍')).toEqual({ texto: '', reacao: '👍' });
      expect(separarReacao('reacao:❤')).toEqual({ texto: '', reacao: '❤️' });
    });

    it('emoji fora da lista: a linha sai e não reage', () => {
      expect(separarReacao('Valeu!\nREACAO: 🍆')).toEqual({ texto: 'Valeu!', reacao: null });
      expect(separarReacao('REACAO: obrigado')).toEqual({ texto: '', reacao: null });
    });

    it('vale a primeira que serve; a linha das opções que vem depois continua', () => {
      expect(separarReacao('Oi\nREACAO: 🍆\nREACAO: 🙏\nOPCOES: A | B')).toEqual({ texto: 'Oi\nOPCOES: A | B', reacao: '🙏' });
    });

    it('sem a linha, nada muda (a palavra no meio da frase não conta)', () => {
      expect(separarReacao('A reacao: dele foi boa')).toEqual({ texto: 'A reacao: dele foi boa', reacao: null });
    });
  });

  describe('separarOpcoesSoltas', () => {
    it('a linha das opções no meio do texto vira as opções e sai do texto', () => {
      expect(separarOpcoesSoltas('Quer no trio?\nOPCOES: Sim, no trio | Só o lanche\nREACAO: 👍')).toEqual({
        texto: 'Quer no trio?\nREACAO: 👍',
        opcoes: [{ titulo: 'Sim, no trio' }, { titulo: 'Só o lanche' }],
      });
    });

    it('tira a formatação do título da opção e corta em 10', () => {
      const muitas = Array.from({ length: 12 }, (_, i) => `**Op ${i + 1}**`).join(' | ');
      const r = separarOpcoesSoltas(`Escolha\nOPÇÕES: ${muitas}`);
      expect(r.opcoes).toHaveLength(10);
      expect(r.opcoes[0]).toEqual({ titulo: 'Op 1' });
      expect(r.texto).toBe('Escolha');
    });

    it('sem a linha, nada muda', () => {
      expect(separarOpcoesSoltas('As opções: são duas')).toEqual({ texto: 'As opções: são duas', opcoes: [] });
    });
  });

  describe('balões', () => {
    const longo = (n: number) => 'x'.repeat(n);

    it('nasce desligado; liga com ROBO_BALOES=1', () => {
      expect(baloesLigados({})).toBe(false);
      expect(baloesLigados({ ROBO_BALOES: '0' })).toBe(false);
      expect(baloesLigados({ ROBO_BALOES: '1' })).toBe(true);
      expect(baloesLigados({ ROBO_BALOES: 'true' })).toBe(true);
    });

    it('resposta curta ou sem parágrafo: um balão só', () => {
      expect(emBaloes('Oi!\n\nTudo bem?')).toEqual(['Oi!\n\nTudo bem?']);
      expect(emBaloes(longo(BALAO_MINIMO + 50))).toHaveLength(1);
      expect(emBaloes('')).toEqual([]);
    });

    it('longa com parágrafos: um balão por parágrafo, até 3; o do meio junta o que sobra', () => {
      const p = [`Temos sim! ${longo(120)}`, `🍔 *A* ${longo(120)}`, `🍟 *B* ${longo(120)}`, 'Quer pedir? 👇'];
      expect(emBaloes(p.slice(0, 3).join('\n\n'))).toEqual(p.slice(0, 3));
      expect(emBaloes(p.join('\n\n'))).toEqual([p[0], `${p[1]}\n\n${p[2]}`, p[3]]);
    });

    it('o parágrafo que apresenta a lista (termina em ":") fica junto dela', () => {
      const t = `Temos estas opções:\n\n🍔 *A* ${longo(150)}\n🍟 *B* ${longo(150)}\n\nQuer qual?`;
      expect(emBaloes(t)).toEqual([`Temos estas opções:\n🍔 *A* ${longo(150)}\n🍟 *B* ${longo(150)}`, 'Quer qual?']);
    });

    it('a pausa cresce com o tamanho e fica entre 0,8 s e 2,2 s', () => {
      expect(pausaAntesDoBalao('')).toBe(800);
      expect(pausaAntesDoBalao(longo(50))).toBe(1200);
      expect(pausaAntesDoBalao(longo(1000))).toBe(2200);
    });
  });

  describe('o print de ajuda (D3 — a linha PRINT)', () => {
    it('sai do texto e vira o passo (sem acento, sem formatação, maiúsculas); um por resposta: vale o primeiro que serve', () => {
      expect(separarPrint('É nesta tela (1).\nPRINT: carrinho')).toEqual({ texto: 'É nesta tela (1).', print: 'carrinho' });
      expect(separarPrint('Olha só.\n  print:  *Endereço*  ')).toEqual({ texto: 'Olha só.', print: 'endereco' });
      expect(separarPrint('A.\nPRINT: nada\nPRINT: pagamento\nPRINT: produto')).toEqual({ texto: 'A.', print: 'pagamento' });
      expect(separarPrint('Sem print aqui.')).toEqual({ texto: 'Sem print aqui.', print: null });
    });

    it('os seis passos têm imagem no endereço público do app (frontend/public/ajuda)', () => {
      expect(PASSOS_DO_PRINT).toEqual(['produto', 'adicionais', 'carrinho', 'endereco', 'pagamento', 'acompanhar']);
      expect(urlDoPrint('carrinho', { APP_URL: 'https://app.exemplo.com/' } as any)).toBe('https://app.exemplo.com/ajuda/print-carrinho.png');
      expect(urlDoPrint('produto', { CARDAPIO_PUBLIC_URL: '', APP_URL: '' } as any)).toBe('https://app.dmsregem.com/ajuda/print-produto.png');
      for (const p of PASSOS_DO_PRINT) expect(existsSync(resolve(__dirname, `../../../../frontend/public/ajuda/print-${p}.png`))).toBe(true);
    });
  });
});
