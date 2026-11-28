import { NotFoundException } from '@nestjs/common';
import { AvisosNaTelaService, daLojaDaSessao } from './avisos-na-tela.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Rodada 7 de segurança, bloco I (ERR-661): avisos e regras criadas pela conversa — as regras puras e o servidor da loja com a
// nuvem de mentira. O caminho com o Postgres (as regras, o vigia, o histórico, o contador) está em `mister-pg.teste-spec.ts`.

const T = '11111111-1111-4111-8111-111111111111';
const LOJA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOJA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NIL = '00000000-0000-0000-0000-000000000000';
const aviso = (id: string, unidadeId: string | null) => ({ id, tipo: 'pedido_parado', titulo: `aviso ${id}`, detalhe: null, abertoEm: '2026-11-28T12:00:00Z', escaladoEm: null, unidadeId, cientes: [], tambem: [] });

/** O servidor da loja com a nuvem de mentira: o token devolve os avisos de A, de B e da rede (o servidor antigo sem loja). */
class TelaDaLoja extends AvisosNaTelaService {
  chamadas: string[] = [];
  protected async naNuvem(caminho: string): Promise<any> {
    this.chamadas.push(caminho);
    if (caminho === '/mister/avisos/loja')
      return { j: { tenantId: T, avisos: [aviso('a1a1a1a1-0000-4000-8000-000000000001', LOJA_A), aviso('b1b1b1b1-0000-4000-8000-000000000002', LOJA_B), aviso('c1c1c1c1-0000-4000-8000-000000000003', null)] } };
    return { j: { ok: true } };
  }
}

describe('Rodada 7, bloco I (ERR-661)', () => {
  it('MIS-I-02: a régua da sessão — a loja dela e a da rede; "todas" vê tudo; sem loja nenhuma, só a da rede', () => {
    expect(daLojaDaSessao({ unidadeId: LOJA_A }, LOJA_A)).toBe(true);
    expect(daLojaDaSessao({ unidadeId: null }, LOJA_A)).toBe(true);
    expect(daLojaDaSessao({ unidadeId: LOJA_B }, LOJA_A)).toBe(false);
    expect(daLojaDaSessao({ unidadeId: LOJA_B }, null)).toBe(true);
    expect(daLojaDaSessao({ unidadeId: LOJA_A }, NIL)).toBe(false);
    expect(daLojaDaSessao({ unidadeId: null }, NIL)).toBe(true);
  });

  describe('MIS-I-02: no servidor da loja, a tela mostra só o que a sessão vê, e o "Ciente" de outra loja não sai', () => {
    const antes = process.env.EDGE_MODE;
    beforeAll(() => (process.env.EDGE_MODE = 'true'));
    afterAll(() => (antes === undefined ? delete process.env.EDGE_MODE : (process.env.EDGE_MODE = antes)));

    it('a sessão da loja A não vê o aviso da loja B', async () => {
      const tela = new TelaDaLoja({} as any);
      const r = await tela.daLoja(T, LOJA_A, 'colab-1');
      expect(r.avisos.map((a: any) => a.titulo).sort()).toEqual(['aviso a1a1a1a1-0000-4000-8000-000000000001', 'aviso c1c1c1c1-0000-4000-8000-000000000003']);
      const semLoja = await new TelaDaLoja({} as any).daLoja(T, NIL, 'colab-1');
      expect(semLoja.avisos.map((a: any) => a.titulo)).toEqual(['aviso c1c1c1c1-0000-4000-8000-000000000003']);
    });

    it('o "Ciente" num aviso da loja B pela sessão da A: 404, sem chamar a nuvem para gravar', async () => {
      const tela = new TelaDaLoja({} as any);
      await expect(tela.ciente(T, LOJA_A, '22222222-2222-4222-8222-222222222222', 'b1b1b1b1-0000-4000-8000-000000000002')).rejects.toBeInstanceOf(NotFoundException);
      expect(tela.chamadas.some((c) => c.includes('/ciente/'))).toBe(false);
      // O da loja dela, sim.
      expect(await tela.ciente(T, LOJA_A, '22222222-2222-4222-8222-222222222222', 'a1a1a1a1-0000-4000-8000-000000000001')).toEqual({ ok: true });
    });
  });
});
