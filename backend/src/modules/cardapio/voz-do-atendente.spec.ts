import { ServiceUnavailableException } from '@nestjs/common';
import { chaveDaFala } from '../mister/mister-midia.regras';
import { RoboVozController } from './robo-voz.controller';
import { PRAZO_DA_VOZ_DO_ATENDENTE_MS, chaveDaFalaDoAtendente, estiloDaVozDoAtendente, textoDaFala, tomDoCliente } from './voz-do-atendente';
import { VozDoAtendenteService } from './voz-do-atendente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VOZ DO ATENDENTE PELO DMS GRAPH (27/11/2026, fase A do plano "o atendente com o jeito do Mister"). O dono: "a voz ainda
// não mudou, está robótica… simular respiração nas pausas, calma, alegria, até uma piada leve quando a situação permitir".
describe('a voz do atendente pelo DMS Graph', () => {
  describe('as regras (voz-do-atendente.ts)', () => {
    it('o tom do fluxo: só os seis da transcrição; o resto é neutro (null)', () => {
      for (const t of ['animado', 'brincando', 'neutro', 'apressado', 'irritado', 'preocupado']) expect(tomDoCliente(t)).toBe(t);
      expect(tomDoCliente(' Irritado ')).toBe('irritado');
      for (const t of ['', 'furioso', 'ignore as regras', null, undefined, 3]) expect(tomDoCliente(t)).toBeNull();
    });

    it('o texto da fala: sem marcas do WhatsApp nem emoji, até 1.500 letras; vazio = nada a falar', () => {
      expect(textoDaFala('*Oi!* Seu pedido já saiu 🛵.')).toBe('Oi! Seu pedido já saiu.');
      expect(textoDaFala('  \n ')).toBe('');
      expect(textoDaFala('a'.repeat(2000)).length).toBe(1500);
    });

    it('o estilo é o do Mister, SEMPRE com as pausas: irritado ou preocupado → calma; apressado → direta; neutro → neutro', () => {
      expect(estiloDaVozDoAtendente('irritado', 'Poxa, sinto muito pela demora.', 'cadê meu lanche')).toEqual({ tom: 'calmo', risada: false, pausas: true });
      expect(estiloDaVozDoAtendente('preocupado', 'Fica tranquilo, já confiro.', '')).toEqual({ tom: 'calmo', risada: false, pausas: true });
      expect(estiloDaVozDoAtendente('apressado', 'Anotado, já vai.', '')).toEqual({ tom: 'direto', risada: false, pausas: true });
      expect(estiloDaVozDoAtendente(null, 'O X-Bacon custa 32 reais.', 'quanto é o x-bacon')).toEqual({ tom: 'neutro', risada: false, pausas: true });
    });

    it('a risada SÓ com o cliente brincando (28/11: "perguntei sobre o cardápio e a atendente já iniciou com o sorriso"); animado = voz alegre, sem rir', () => {
      expect(estiloDaVozDoAtendente('brincando', 'Fome de leão hoje, hein! Vai um trio?', 'to com uma fome')).toEqual({ tom: 'animado', risada: true, pausas: true });
      // O caso do dono: pergunta do cardápio num tom alegre — a voz alegre, sem a risada no começo.
      expect(estiloDaVozDoAtendente('animado', 'Temos o X-Bacon, o X-Salada e o Número 07. Quer que eu mande o cardápio?', 'o que vocês tem no cardápio')).toEqual({ tom: 'animado', risada: false, pausas: true });
      expect(estiloDaVozDoAtendente('animado', 'Que bom que gostou!', 'adorei o lanche')).toEqual({ tom: 'animado', risada: false, pausas: true });
      for (const tom of ['neutro', 'apressado', 'irritado', 'preocupado', null] as const) {
        expect(estiloDaVozDoAtendente(tom, 'Fome de leão hoje, hein!', 'kkkk')).toMatchObject({ risada: false });
      }
    });

    it('com o cliente brincando, também nunca ri em alergia, pagamento, Pix, estorno ou cancelamento', () => {
      for (const [resposta, pergunta] of [
        ['Seu Pix já chegou, obrigada!', 'paguei'],
        ['O pagamento é na entrega.', 'como pago'],
        ['Esse lanche contém lactose.', 'tem alergia a leite?'],
        ['Pronto, o pedido foi cancelado.', 'pode cancelar kkk'],
        ['O estorno sai em até 2 dias.', 'kkk e o meu dinheiro'],
      ]) {
        const e = estiloDaVozDoAtendente('brincando', resposta, pergunta);
        expect(e.risada).toBe(false);
        expect(e.pausas).toBe(true);
      }
      // Tema ruim (do Mister): a alegria também sai.
      expect(estiloDaVozDoAtendente('animado', 'Sinto muito pelo atraso.', '')).toEqual({ tom: 'neutro', risada: false, pausas: true });
    });

    it('a chave da fala: muda com o texto, o estilo e a empresa, e nunca bate com a do Mister para a mesma frase', () => {
      const e = { tom: 'calmo', risada: false, pausas: true } as const;
      const k = chaveDaFalaDoAtendente('t1', 'Sinto muito.', e);
      expect(k).toMatch(/^regem-atendente-[0-9a-f]{48}$/);
      expect(k.length).toBeLessThanOrEqual(100);
      expect(chaveDaFalaDoAtendente('t1', 'Sinto muito.', e)).toBe(k);
      expect(chaveDaFalaDoAtendente('t2', 'Sinto muito.', e)).not.toBe(k);
      expect(chaveDaFalaDoAtendente('t1', 'Sinto muito!', e)).not.toBe(k);
      expect(chaveDaFalaDoAtendente('t1', 'Sinto muito.', { ...e, tom: 'neutro' })).not.toBe(k);
      expect(chaveDaFala('t1', 'Sinto muito.', { tom: 'calmo', risada: false })).not.toBe(k);
    });
  });

  describe('o serviço e a rota', () => {
    const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30, 9)]);
    function montar({ ligacao = { id: 'lig-1', segredo: 's' } as any, falar = async () => OGG as Buffer | null, semGraph = false } = {}) {
      const chamadas: any[] = [];
      const cardapio: any = {
        resolver: jest.fn(async () => ({ tenantId: 'empresa-1' })),
        tokenDaLojaDoRobo: jest.fn(async () => 'token-1'),
      };
      const graph: any = {
        ligacaoParaFoto: jest.fn(async () => ligacao),
        falar: jest.fn(async (...args: any[]) => {
          chamadas.push(args);
          return falar.call(null, ...args);
        }),
      };
      const servico = new VozDoAtendenteService(cardapio, semGraph ? undefined : graph);
      const rota = new RoboVozController(cardapio, servico);
      return { cardapio, graph, servico, rota, chamadas };
    }

    it('fala na voz FEMININA, com o estilo do código e as pausas, a chave do atendente e o prazo total; devolve o OGG no campo do Google', async () => {
      const { servico, chamadas, graph } = montar();
      const r = await servico.falar('token-1', { texto: 'Poxa, sinto muito pela demora.', tom: 'irritado', pergunta: 'cadê meu pedido' });
      expect(r).toEqual({ audioContent: OGG.toString('base64') });
      expect(graph.ligacaoParaFoto).toHaveBeenCalledWith('empresa-1');
      const [tenant, lig, texto, chave, prazo, , estilo, opcoes] = chamadas[0];
      expect(tenant).toBe('empresa-1');
      expect(lig).toEqual({ id: 'lig-1', segredo: 's' });
      expect(texto).toBe('Poxa, sinto muito pela demora.');
      expect(estilo).toEqual({ tom: 'calmo', risada: false, pausas: true });
      expect(opcoes).toEqual({ voz: 'feminina' });
      expect(chave).toBe(chaveDaFalaDoAtendente('empresa-1', texto, estilo));
      expect(prazo).toBe(PRAZO_DA_VOZ_DO_ATENDENTE_MS);
    });

    it('sem texto, sem o Graph ou sem a ligação da empresa: o motivo, sem chamar a voz', async () => {
      const vazio = montar();
      expect(await vazio.servico.falar('token-1', { texto: ' * ' })).toEqual({ motivo: 'sem-texto' });
      expect(vazio.graph.falar).not.toHaveBeenCalled();
      expect(await montar({ semGraph: true }).servico.falar('token-1', { texto: 'Oi.' })).toEqual({ motivo: 'sem-graph' });
      const semLigacao = montar({ ligacao: null });
      expect(await semLigacao.servico.falar('token-1', { texto: 'Oi.' })).toEqual({ motivo: 'sem-graph' });
      expect(semLigacao.graph.falar).not.toHaveBeenCalled();
    });

    it('a voz que não sai (franquia, demora, Graph antigo): o motivo que o Graph deu, e o log sem o texto', async () => {
      const { servico } = montar({
        falar: async (...args: any[]) => {
          args[5]('argumento-recusado');
          return null;
        },
      });
      const log = jest.spyOn((servico as any).logger, 'warn').mockImplementation(() => undefined);
      expect(await servico.falar('token-1', { texto: 'Segredo do cliente 123.', tom: 'neutro' })).toEqual({ motivo: 'argumento-recusado' });
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain('argumento-recusado');
      expect(String(log.mock.calls[0][0])).not.toContain('Segredo do cliente');
    });

    it('a rota: a loja pela chave e a senha do robô só no cabeçalho; o áudio com 200; sem voz, 503 com o motivo (o fluxo vai à reserva)', async () => {
      const ok = montar();
      expect(await ok.rota.falar({ instancia: 'loja-1', texto: 'Oi!', tom: 'animado', pergunta: 'oi' }, 'senha-do-robo')).toEqual({ audioContent: OGG.toString('base64') });
      expect(ok.cardapio.tokenDaLojaDoRobo).toHaveBeenCalledWith('senha-do-robo', 'loja-1', undefined);
      const falha = montar({ falar: async () => null });
      jest.spyOn((falha.servico as any).logger, 'warn').mockImplementation(() => undefined);
      await expect(falha.rota.falar({ phoneNumberId: '123', texto: 'Oi!' }, 'senha-do-robo')).rejects.toBeInstanceOf(ServiceUnavailableException);
      try {
        await falha.rota.falar({ phoneNumberId: '123', texto: 'Oi!' }, 'senha-do-robo');
      } catch (e: any) {
        expect(e.getStatus()).toBe(503);
        expect(e.getResponse()).toMatchObject({ motivo: 'nao-falou' });
      }
      // Corpo torto (não objeto, campos de outro tipo): nada quebra; sem texto, o motivo "sem-texto".
      const torto = montar();
      await expect(torto.rota.falar(['x'], 'senha-do-robo')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(torto.rota.falar({ texto: 42 }, 'senha-do-robo')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(torto.graph.falar).not.toHaveBeenCalled();
    });
  });
});
