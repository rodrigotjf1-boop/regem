'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearDistToken, distApi, getDistToken } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PERFIL_LABEL: Record<string, string> = { diretoria: 'Diretoria', tecnico: 'Técnico', financeiro: 'Financeiro' };
const NIVEL_COR: Record<string, string> = { fatal: 'text-red-400', error: 'text-amber-400', warn: 'text-slate-400' };
const PLANOS = ['basico', 'balcao', 'completo'];

function online(ts?: string | null) { return ts ? Date.now() - new Date(ts).getTime() < 5 * 60 * 1000 : false; }
function quando(ts?: string | null) { return ts ? new Date(ts).toLocaleString('pt-BR') : '—'; }
function ehTeste(l: any) { return !l.cnpj; } // sem CNPJ = tenant de teste/dev

// Status de licença (espelha o licenca.service): valida | a_vencer | vencida.
function statusLic(l: any): { k: string; label: string; cor: string } {
  const assinante = ['active', 'trialing', 'past_due'].includes(l.assinaturaStatus ?? '');
  if (l.status === 'bloqueado') return { k: 'vencida', label: 'Bloqueada', cor: 'text-red-400' };
  if (!l.trialAte) return { k: 'valida', label: assinante ? 'Assinatura' : 'Ativa', cor: 'text-emerald-400' };
  const ate = new Date(l.trialAte).getTime(); const agora = Date.now();
  if (ate < agora) return { k: 'vencida', label: 'Vencida', cor: 'text-red-400' };
  const dias = Math.ceil((ate - agora) / 86400000);
  if (dias <= 7) return { k: 'a_vencer', label: `Vence em ${dias}d`, cor: 'text-amber-400' };
  return { k: 'valida', label: assinante ? 'Assinatura' : `Trial ${dias}d`, cor: 'text-emerald-400' };
}

export default function DistHome() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [aba, setAba] = useState<'frota' | 'telemetria' | 'licencas' | 'usuarios'>('frota');
  const [frota, setFrota] = useState<any[] | null>(null);
  const [telemetria, setTelemetria] = useState<any[] | null>(null);
  const [licencas, setLicencas] = useState<any[] | null>(null);
  const [usuarios, setUsuarios] = useState<any[] | null>(null);
  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState('todas');
  const [ocultarTestes, setOcultarTestes] = useState(true);
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', perfil: 'tecnico' });

  const sair = useCallback(() => { clearDistToken(); router.replace('/distribuicao/login'); }, [router]);

  const carregar = useCallback((perfil: string) => {
    distApi.frota().then(setFrota).catch(() => {});
    distApi.licencas().then(setLicencas).catch(() => {});
    if (perfil === 'diretoria' || perfil === 'tecnico') distApi.telemetria().then(setTelemetria).catch(() => {});
    if (perfil === 'diretoria') distApi.usuarios().then(setUsuarios).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getDistToken()) { router.replace('/distribuicao/login'); return; }
    distApi.me().then((u: any) => { setMe(u); carregar(u.perfil); }).catch(() => sair());
  }, [router, sair, carregar]);

  async function resolver(id: string) {
    setTelemetria((l) => (l ?? []).map((t) => (t.id === id ? { ...t, resolvido: true } : t)));
    await distApi.resolverTelemetria(id).catch(() => {});
  }
  async function acaoLicenca(fn: Promise<any>) {
    setErro('');
    try { await fn; setLicencas(await distApi.licencas()); setFrota(await distApi.frota()); }
    catch (err) { setErro(err instanceof Error ? err.message : 'Erro na ação.'); }
  }
  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    try {
      await distApi.criarUsuario(novo);
      setNovo({ nome: '', email: '', senha: '', perfil: 'tecnico' });
      setUsuarios(await distApi.usuarios());
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro'); }
  }

  if (!me) return <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">Carregando…</div>;
  const podeTelemetria = me.perfil === 'diretoria' || me.perfil === 'tecnico';
  const ehDiretoria = me.perfil === 'diretoria';
  const podeAgir = me.perfil === 'diretoria' || me.perfil === 'financeiro';
  const abas = [{ k: 'frota', t: 'Frota' }, ...(podeTelemetria ? [{ k: 'telemetria', t: 'Telemetria' }] : []), { k: 'licencas', t: 'Licenças' }, ...(ehDiretoria ? [{ k: 'usuarios', t: 'Usuários' }] : [])];

  const filtrar = (l: any[]) => l
    .filter((x) => !ocultarTestes || !ehTeste(x))
    .filter((x) => !busca || String(x.nome).toLowerCase().includes(busca.toLowerCase()) || String(x.cnpj ?? '').includes(busca));
  const filtrarLic = (l: any[]) => filtrar(l).filter((x) => fStatus === 'todas' || statusLic(x).k === fStatus);

  const filtroBar = (comStatus: boolean) => (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome/CNPJ…" className="h-9 w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 outline-none focus:border-amber-500" />
      {comStatus && (
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2">
          <option value="todas">Todas licenças</option>
          <option value="valida">Válidas</option>
          <option value="a_vencer">A vencer (≤7d)</option>
          <option value="vencida">Vencidas/bloqueadas</option>
        </select>
      )}
      <label className="flex items-center gap-1.5 text-slate-400"><input type="checkbox" checked={ocultarTestes} onChange={(e) => setOcultarTestes(e.target.checked)} className="h-4 w-4 accent-amber-500" /> ocultar testes (sem CNPJ)</label>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Regem · Distribuição</p>
          <h1 className="text-lg font-bold">Console de controle</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-300">{me.nome} · <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-amber-300">{PERFIL_LABEL[me.perfil] ?? me.perfil}</span></span>
          <button onClick={sair} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500">Sair</button>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-800 px-6">
        {abas.map((a) => (
          <button key={a.k} onClick={() => setAba(a.k as any)} className={`border-b-2 px-4 py-2.5 text-sm ${aba === a.k ? 'border-amber-500 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{a.t}</button>
        ))}
      </nav>
      {erro && <p className="px-6 pt-3 text-sm text-red-400">{erro}</p>}

      <main className="mx-auto max-w-6xl space-y-4 p-6">
        {aba === 'frota' && (
          <section>
            {filtroBar(false)}
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400"><tr><th className="p-3">Loja</th><th className="p-3">Edge</th><th className="p-3">Versão</th><th className="p-3">Clientes</th><th className="p-3">Erros</th><th className="p-3">Licença</th><th className="p-3">Último sinal</th></tr></thead>
                <tbody>
                  {frota && filtrar(frota).map((l) => (
                    <tr key={l.id} className="border-t border-slate-800/70">
                      <td className="p-3"><div className="font-medium">{l.nome}</div><div className="text-xs text-slate-500">{l.cnpj ?? '(teste)'}</div></td>
                      <td className="p-3"><span className={online(l.ultimoHeartbeat) ? 'text-emerald-400' : 'text-slate-500'}>● {online(l.ultimoHeartbeat) ? 'online' : 'offline'}</span></td>
                      <td className="p-3 font-mono text-xs">{l.edgeVersao ?? '—'}</td>
                      <td className="p-3">{l.clientes ?? '—'}</td>
                      <td className="p-3">{l.errosAbertos > 0 ? <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">{l.errosAbertos}</span> : <span className="text-slate-600">0</span>}</td>
                      <td className={`p-3 text-xs ${statusLic(l).cor}`}>{statusLic(l).label}</td>
                      <td className="p-3 text-xs text-slate-500">{quando(l.ultimoHeartbeat)}</td>
                    </tr>
                  ))}
                  {frota && filtrar(frota).length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Nenhuma loja no filtro.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {aba === 'telemetria' && podeTelemetria && (
          <section className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400"><tr><th className="p-3">Loja</th><th className="p-3">Nível</th><th className="p-3">Origem</th><th className="p-3">Mensagem</th><th className="p-3">Ocorr.</th><th className="p-3">Versão</th><th className="p-3">Última</th><th className="p-3"></th></tr></thead>
              <tbody>
                {(telemetria ?? []).map((t) => (
                  <tr key={t.id} className={`border-t border-slate-800/70 ${t.resolvido ? 'opacity-40' : ''}`}>
                    <td className="p-3">{t.loja ?? '—'}</td>
                    <td className={`p-3 font-semibold ${NIVEL_COR[t.nivel] ?? ''}`}>{t.nivel}</td>
                    <td className="p-3 text-xs text-slate-400">{t.origem}{t.tipo ? ` · ${t.tipo}` : ''}</td>
                    <td className="p-3 max-w-md truncate text-slate-300" title={t.mensagem}>{t.mensagem}</td>
                    <td className="p-3">{t.ocorrencias}</td>
                    <td className="p-3 font-mono text-xs">{t.versao ?? '—'}</td>
                    <td className="p-3 text-xs text-slate-500">{quando(t.ultimoEm)}</td>
                    <td className="p-3">{!t.resolvido && <button onClick={() => resolver(t.id)} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-400">Resolver</button>}</td>
                  </tr>
                ))}
                {telemetria && telemetria.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Nenhum erro reportado. 🎉</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {aba === 'licencas' && (
          <section>
            {filtroBar(true)}
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400"><tr><th className="p-3">Loja</th><th className="p-3">Plano</th><th className="p-3">Licença</th><th className="p-3">Validade</th>{podeAgir && <th className="p-3">Ações</th>}</tr></thead>
                <tbody>
                  {licencas && filtrarLic(licencas).map((l) => {
                    const s = statusLic(l);
                    return (
                      <tr key={l.id} className="border-t border-slate-800/70">
                        <td className="p-3"><div className="font-medium">{l.nome}</div><div className="text-xs text-slate-500">{l.cnpj ?? '(teste)'}</div></td>
                        <td className="p-3">
                          {podeAgir ? (
                            <select value={l.plano} onChange={(e) => acaoLicenca(distApi.mudarPlano(l.id, e.target.value))} className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs">
                              {PLANOS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          ) : <span className="text-xs">{l.plano}</span>}
                        </td>
                        <td className={`p-3 text-xs font-semibold ${s.cor}`}>{s.label}</td>
                        <td className="p-3 text-xs text-slate-500">{l.trialAte ? new Date(l.trialAte).toLocaleDateString('pt-BR') : (l.assinaturaStatus ? 'assinatura' : '—')}</td>
                        {podeAgir && (
                          <td className="p-3">
                            <div className="flex gap-1.5">
                              <button onClick={() => { const d = prompt('Liberar/renovar por quantos dias?', '30'); if (d) acaoLicenca(distApi.liberarLicenca(l.id, Number(d))); }} className="rounded border border-slate-700 px-2 py-1 text-xs text-emerald-400 hover:border-emerald-500">Liberar/Renovar</button>
                              {l.status !== 'bloqueado' && <button onClick={() => { if (confirm(`Revogar a licença de "${l.nome}"? A loja fica bloqueada para escrever/sincronizar.`)) acaoLicenca(distApi.revogarLicenca(l.id)); }} className="rounded border border-slate-700 px-2 py-1 text-xs text-red-400 hover:border-red-500">Revogar</button>}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {licencas && filtrarLic(licencas).length === 0 && <tr><td colSpan={podeAgir ? 5 : 4} className="p-6 text-center text-slate-500">Nenhuma loja no filtro.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {aba === 'usuarios' && ehDiretoria && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="font-bold">Usuários da distribuição</h2>
            <form onSubmit={criarUsuario} className="mt-3 grid gap-2 sm:grid-cols-5">
              <input required placeholder="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm" />
              <input required type="email" placeholder="E-mail" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm sm:col-span-2" />
              <input required type="password" placeholder="Senha (mín. 8)" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm" />
              <div className="flex gap-2">
                <select value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })} className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm"><option value="tecnico">Técnico</option><option value="financeiro">Financeiro</option><option value="diretoria">Diretoria</option></select>
                <button type="submit" className="rounded-lg bg-amber-500 px-3 text-sm font-semibold text-slate-950 hover:bg-amber-400">+</button>
              </div>
            </form>
            <div className="mt-4 space-y-1.5">
              {(usuarios ?? []).map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm">
                  <span>{u.nome} <span className="text-slate-500">· {u.email}</span></span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-amber-300">{PERFIL_LABEL[u.perfil] ?? u.perfil}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
