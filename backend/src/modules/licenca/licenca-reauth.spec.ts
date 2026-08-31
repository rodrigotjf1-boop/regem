import * as bcrypt from 'bcryptjs';
import { LicencaService } from './licenca.service';
import { hashCodigoReauth } from './reauth-instalacao';
import { ativacao, colaborador, equipamento, reautorizacaoEdge } from '../../db/schema';

// F3a-2 — o fluxo mais auth-crítico: confirmar a re-autorização MOVE o edge (rotaciona o
// token = mata a máquina antiga). DB falso roteado por tabela.

function rowsFor(t: any, estado: any): any[] {
  if (t === colaborador) return estado.colaborador ? [estado.colaborador] : [];
  if (t === ativacao) return estado.ativacao ? [estado.ativacao] : [];
  if (t === reautorizacaoEdge) return estado.pend ? [estado.pend] : [];
  if (t === equipamento) return estado.equipamento ? [estado.equipamento] : [];
  return [];
}

function fakeDb(estado: any, caps: any[]) {
  const chain = (resolver: (st: any) => any) => {
    const st: any = {};
    const p: any = {
      from: (t: any) => ((st.t = t), p),
      leftJoin: () => p,
      where: () => p,
      orderBy: () => p,
      limit: () => p,
      set: (v: any) => ((st.v = v), p),
      values: (v: any) => ((st.v = v), p),
      returning: () => ((st.ret = true), p),
      then: (res: any, rej: any) => Promise.resolve(resolver(st)).then(res, rej),
    };
    return p;
  };
  return {
    select: () => chain((st) => rowsFor(st.t, estado)),
    update: (t: any) =>
      chain((st) => {
        caps.push({ op: 'update', t, v: st.v });
        // returning() do equipamento/ativação devolve 1 linha (com a unidade/estado novos).
        return st.ret ? [{ id: estado.ativacao?.id ?? 'a1', unidadeId: 'u-nova', ...st.v }] : undefined;
      }),
    insert: (t: any) => chain((st) => (caps.push({ op: 'insert', t, v: st.v }), undefined)),
  };
}

describe('LicencaService.reautorizarConfirmar — F3a-2 (mover o edge)', () => {
  let senhaHash: string;
  beforeAll(async () => {
    senhaHash = await bcrypt.hash('senha123', 4);
  });

  function baseEstado(over: any = {}) {
    return {
      colaborador: { id: 'u1', nome: 'Chefe', tenantId: 't1', senhaHash, categoria: 'presidente' },
      ativacao: { id: 'a1', tenantId: 't1', deviceFingerprint: 'fp-antiga', reauthTotpSecret: null },
      equipamento: { unidadeId: 'u-nova' },
      pend: {
        id: 'r1',
        tenantId: 't1',
        fingerprintNovo: 'fp-nova',
        metodo: 'email',
        codigoHash: hashCodigoReauth('123456'),
        expiraEm: new Date(Date.now() + 5 * 60000),
        tentativas: 0,
        status: 'pendente',
      },
      ...over,
    };
  }

  it('código correto → ROTACIONA o token (novo syncToken) + aprova o pedido', async () => {
    const caps: any[] = [];
    const svc = new LicencaService(fakeDb(baseEstado(), caps) as any, {} as any);
    // leaseDe usa a chave de licença; stub p/ não exigir env.
    (svc as any).leaseDe = () => 'lease-fake';
    const r: any = await svc.reautorizarConfirmar({ email: 'a@b.com', senha: 'senha123', fingerprint: 'fp-nova', codigo: '123456' });
    expect(typeof r.syncToken).toBe('string');
    expect(r.syncToken.length).toBeGreaterThanOrEqual(32); // token novo (rotacionado)
    // rotacionou o equipamento (token novo) e rebindou a ativação p/ a máquina nova.
    const upEquip = caps.find((c) => c.op === 'update' && c.t === equipamento);
    expect(upEquip?.v?.token).toBe(r.syncToken);
    const upAtiv = caps.find((c) => c.op === 'update' && c.t === ativacao);
    expect(upAtiv?.v?.deviceFingerprint).toBe('fp-nova');
    const upPend = caps.find((c) => c.op === 'update' && c.t === reautorizacaoEdge && c.v?.status === 'aprovada');
    expect(upPend).toBeTruthy();
  });

  it('código ERRADO → 401 e NÃO rotaciona o token', async () => {
    const caps: any[] = [];
    const svc = new LicencaService(fakeDb(baseEstado(), caps) as any, {} as any);
    (svc as any).leaseDe = () => 'lease-fake';
    await expect(
      svc.reautorizarConfirmar({ email: 'a@b.com', senha: 'senha123', fingerprint: 'fp-nova', codigo: '000000' }),
    ).rejects.toThrow();
    // não trocou o token do equipamento (só incrementou tentativas).
    expect(caps.some((c) => c.op === 'update' && c.t === equipamento)).toBe(false);
  });

  it('senha ERRADA → 401 antes de qualquer coisa', async () => {
    const caps: any[] = [];
    const svc = new LicencaService(fakeDb(baseEstado(), caps) as any, {} as any);
    await expect(
      svc.reautorizarConfirmar({ email: 'a@b.com', senha: 'errada', fingerprint: 'fp-nova', codigo: '123456' }),
    ).rejects.toThrow();
    expect(caps.length).toBe(0);
  });

  it('sem pedido pendente → erro (reinicie a instalação)', async () => {
    const caps: any[] = [];
    const svc = new LicencaService(fakeDb(baseEstado({ pend: null }), caps) as any, {} as any);
    await expect(
      svc.reautorizarConfirmar({ email: 'a@b.com', senha: 'senha123', fingerprint: 'fp-nova', codigo: '123456' }),
    ).rejects.toThrow();
  });
});

// Blindagem contra migration-lag (deploy antes da 220): instalarSelfService tolera as
// colunas reauth_* ausentes tratando a trava como desligada, em vez de 500 (incidente
// potitjf 31/08 16:14). ehColunaAusente é o discriminador que decide o que engolir.
describe('LicencaService.ehColunaAusente — F3 tolerância a migration-lag', () => {
  const svc: any = new LicencaService({} as any, {} as any);
  it('reconhece 42703 (Postgres column does not exist)', () => {
    expect(svc.ehColunaAusente({ code: '42703' })).toBe(true);
  });
  it('reconhece pela mensagem (o exato erro do potitjf)', () => {
    expect(svc.ehColunaAusente(new Error('column "reauth_ativo" does not exist'))).toBe(true);
  });
  it('reconhece a causa aninhada (drizzle/pg encapsula)', () => {
    expect(svc.ehColunaAusente({ message: 'query failed', cause: { code: '42703' } })).toBe(true);
  });
  it('NÃO engole outros erros (ex.: unique violation 23505)', () => {
    expect(svc.ehColunaAusente({ code: '23505', message: 'duplicate key' })).toBe(false);
  });
  it('NÃO engole erro genérico sem código/mensagem de coluna', () => {
    expect(svc.ehColunaAusente(new Error('timeout'))).toBe(false);
  });
});
