import { LicencaService } from './licenca.service';
import { edgeHeartbeat } from '../../db/schema';

// F1 (saúde da frota): o heartbeat passa a gravar unidade_id (do TOKEN, não-spoofável),
// fingerprint e saude (jsonb). Testa o contrato de gravação com um DB falso (sem Postgres).
function fakeDb() {
  const inserts: any[] = [];
  const sel: any = Promise.resolve([{ id: 'a1' }]); // a ativação resolvida
  sel.from = () => sel;
  sel.where = () => sel;
  sel.limit = () => sel;
  return {
    inserts,
    select: () => sel,
    insert: (t: any) => ({
      values: (v: any) => {
        inserts.push({ t, v });
        return Promise.resolve();
      },
    }),
  };
}

function valoresDoHeartbeat(db: ReturnType<typeof fakeDb>) {
  return db.inserts.find((i) => i.t === edgeHeartbeat)?.v;
}

describe('LicencaService.heartbeat — F1 (saúde/unidade/fingerprint)', () => {
  it('grava a unidade do TOKEN (não do dto) + fingerprint + saude + disco', async () => {
    const db = fakeDb();
    const svc = new LicencaService(db as any, {} as any);
    await svc.heartbeat('t1', 'u-token', {
      versao: '1.23.0',
      estado: 'sync_ok',
      unidadeId: 'u-SPOOF', // um edge malicioso poderia mandar outra unidade no corpo
      fingerprint: 'fp-abc',
      discoLivreMb: 12345,
      saude: { servicos: { pg: 'Running', sync: 'Running' }, restaurando: false },
    });
    const v = valoresDoHeartbeat(db);
    expect(v.unidadeId).toBe('u-token'); // o token vence o dto (anti-spoof)
    expect(v.fingerprint).toBe('fp-abc');
    expect(v.discoLivreMb).toBe(12345);
    expect(v.saude).toEqual({ servicos: { pg: 'Running', sync: 'Running' }, restaurando: false });
  });

  it('cai no dto.unidadeId quando o token não tem unidade (edge antigo/1 loja)', async () => {
    const db = fakeDb();
    const svc = new LicencaService(db as any, {} as any);
    await svc.heartbeat('t1', null, { unidadeId: 'u-dto' });
    expect(valoresDoHeartbeat(db).unidadeId).toBe('u-dto');
  });

  it('sem unidade em lugar nenhum → null (não quebra)', async () => {
    const db = fakeDb();
    const svc = new LicencaService(db as any, {} as any);
    await svc.heartbeat('t1', null, { versao: '1' });
    const v = valoresDoHeartbeat(db);
    expect(v.unidadeId).toBeNull();
    expect(v.fingerprint).toBeNull();
    expect(v.saude).toBeNull();
  });
});
