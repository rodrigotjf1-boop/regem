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
  const [aba, setAba] = useState<'frota' | 'telemetria' | 'licencas' | 'atualizacoes' | 'integracoes' | 'auditoria' | 'usuarios'>('frota');
  const [pedidosInteg, setPedidosInteg] = useState<any[] | null>(null);
  const [frota, setFrota] = useState<any[] | null>(null);
  const [telemetria, setTelemetria] = useState<any[] | null>(null);
  const [licencas, setLicencas] = useState<any[] | null>(null);
  const [usuarios, setUsuarios] = useState<any[] | null>(null);
  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState('todas');
  const [ocultarTestes, setOcultarTestes] = useState(true);
  const [releases, setReleases] = useState<any[] | null>(null);
  const [auditoria, setAuditoria] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', perfil: 'tecnico' });
  const [rel, setRel] = useState({ versao: '', url: '', sha256: '', notas: '' });

  const sair = useCallback(() => { clearDistToken(); router.replace('/distribuicao/login'); }, [router]);

  const carregar = useCallback((perfil: string) => {
    distApi.frota().then(setFrota).catch(() => {});
    distApi.licencas().then(setLicencas).catch(() => {});
    if (perfil === 'diretoria' || perfil === 'tecnico') distApi.telemetria().then(setTelemetria).catch(() => {});
    if (perfil === 'diretoria' || perfil === 'tecnico') distApi.releases().then(setReleases).catch(() => {});
    if (perfil === 'diretoria' || perfil === 'tecnico') distApi.pedidosIntegracao().then(setPedidosInteg).catch(() => {});
    if (perfil === 'diretoria') distApi.usuarios().then(setUsuarios).catch(() => {});
    if (perfil === 'diretoria') distApi.auditoria().then(setAuditoria).catch(() => {});
  }, []);

  async function publicar(e: React.FormEvent) {
    e.preventDefault(); setErro('');
    try { await distApi.publicarRelease(rel); setRel({ versao: '', url: '', sha256: '', notas: '' }); setReleases(await distApi.releases()); }
    catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao publicar.'); }
  }
  async function rollback(id: string, nome: string) {
    if (!confirm(`Disparar ROLLBACK remoto no edge de "${nome}"?\nO servidor reverte à versão anterior no próximo ciclo (reinicia serviços). Use só se a última atualização causou problema.`)) return;
    try { await distApi.rollbackRemoto(id); setErro(''); alert('Rollback solicitado. O edge executa no próximo ciclo de sync.'); }
    catch (err) { setErro(err instanceof Error ? err.message : 'Erro'); }
  }

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
  async function resolverInteg(id: string, acao: 'conectado' | 'recusado') {
    setErro('');
    try { await distApi.resolverPedidoIntegracao(id, acao); setPedidosInteg(await distApi.pedidosIntegracao()); }
    catch (err) { setErro(err instanceof Error ? err.message : 'Erro'); }
  }

  if (!me) return <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">Carregando…</div>;
  const podeTelemetria = me.perfil === 'diretoria' || me.perfil === 'tecnico';
  const ehDiretoria = me.perfil === 'diretoria';
  const podeAgir = me.perfil === 'diretoria' || me.perfil === 'financeiro';
  const abas = [
    { k: 'frota', t: 'Frota' },
    ...(podeTelemetria ? [{ k: 'telemetria', t: 'Telemetria' }] : []),
    { k: 'licencas', t: 'Licenças' },
    ...(podeTelemetria ? [{ k: 'atualizacoes', t: 'Atualizações' }] : []),
    ...(podeTelemetria ? [{ k: 'integracoes', t: `Integrações${(pedidosInteg ?? []).filter((p) => p.status === 'pendente').length ? ` (${(pedidosInteg ?? []).filter((p) => p.status === 'pendente').length})` : ''}` }] : []),
    ...(ehDiretoria ? [{ k: 'auditoria', t: 'Auditoria' }] : []),
    ...(ehDiretoria ? [{ k: 'usuarios', t: 'Usuários' }] : []),
  ];

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
                <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400"><tr><th className="p-3">Loja</th><th className="p-3">Edge</th><th className="p-3">Versão</th><th className="p-3">Clientes</th><th className="p-3">Erros</th><th className="p-3">Licença</th><th className="p-3">Último login</th><th className="p-3">Último sinal</th>{podeTelemetria && <th className="p-3"></th>}</tr></thead>
                <tbody>
                  {frota && filtrar(frota).map((l) => (
                    <tr key={l.id} className="border-t border-slate-800/70">
                      <td className="p-3"><div className="font-medium">{l.nome}</div><div className="text-xs text-slate-500">{l.cnpj ?? '(teste)'}</div></td>
                      <td className="p-3"><span className={online(l.ultimoHeartbeat) ? 'text-emerald-400' : 'text-slate-500'}>● {online(l.ultimoHeartbeat) ? 'online' : 'offline'}</span></td>
                      <td className="p-3 font-mono text-xs">{l.edgeVersao ?? '—'}</td>
                      <td className="p-3">{l.clientes ?? '—'}</td>
                      <td className="p-3">{l.errosAbertos > 0 ? <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">{l.errosAbertos}</span> : <span className="text-slate-600">0</span>}</td>
                      <td className={`p-3 text-xs ${statusLic(l).cor}`}>{statusLic(l).label}</td>
                      <td className="p-3 text-xs text-slate-500">{quando(l.ultimoLogin)}</td>
                      <td className="p-3 text-xs text-slate-500">{quando(l.ultimoHeartbeat)}</td>
                      {podeTelemetria && <td className="p-3">{l.edgeVersao && <button onClick={() => rollback(l.id, l.nome)} className="rounded border border-slate-700 px-2 py-1 text-xs text-amber-400 hover:border-amber-500">Rollback</button>}</td>}
                    </tr>
                  ))}
                  {frota && filtrar(frota).length === 0 && <tr><td colSpan={podeTelemetria ? 8 : 7} className="p-6 text-center text-slate-500">Nenhuma loja no filtro.</td></tr>}
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

        {aba === 'atualizacoes' && podeTelemetria && (
          <section className="space-y-4">
            {ehDiretoria && (
              <form onSubmit={publicar} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <h2 className="font-bold">Publicar release</h2>
                <p className="mt-1 text-xs text-slate-400">O edge lê o último release aqui no update-check (dispensa mexer no EasyPanel). O gestor da loja instala pelo botão dele.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input required placeholder="Versão (ex.: 1.1.6)" value={rel.versao} onChange={(e) => setRel({ ...rel, versao: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm" />
                  <input required placeholder="SHA-256 do .zip" value={rel.sha256} onChange={(e) => setRel({ ...rel, sha256: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm font-mono" />
                  <input required placeholder="URL do .zip (https)" value={rel.url} onChange={(e) => setRel({ ...rel, url: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm sm:col-span-2" />
                  <input placeholder="Notas (o que muda)" value={rel.notas} onChange={(e) => setRel({ ...rel, notas: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm sm:col-span-2" />
                </div>
                <button type="submit" className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400">Publicar release</button>
              </form>
            )}
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400"><tr><th className="p-3">Versão</th><th className="p-3">Notas</th><th className="p-3">Por</th><th className="p-3">Quando</th></tr></thead>
                <tbody>
                  {(releases ?? []).map((r, i) => (
                    <tr key={i} className="border-t border-slate-800/70">
                      <td className="p-3 font-mono">{r.versao}{i === 0 && <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">atual</span>}</td>
                      <td className="p-3 text-slate-400">{r.notas ?? '—'}</td>
                      <td className="p-3 text-xs text-slate-500">{r.publicadoPor ?? '—'}</td>
                      <td className="p-3 text-xs text-slate-500">{quando(r.publicadoEm)}</td>
                    </tr>
                  ))}
                  {releases && releases.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">Nenhum release publicado (usa o env do EasyPanel).</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {aba === 'integracoes' && podeTelemetria && (
          <section className="space-y-3">
            <p className="text-xs text-slate-400">
              Pedidos de integração das lojas. A loja salva o token do canal (ex.: Anota Aí) e a
              distribuição finaliza a conexão no Portal de Integração do canal — depois marque como conectado.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400"><tr>
                  <th className="p-3">Loja</th><th className="p-3">Canal</th><th className="p-3">Token</th>
                  <th className="p-3">Status</th><th className="p-3">Solicitado</th><th className="p-3">Ação</th>
                </tr></thead>
                <tbody>
                  {(pedidosInteg ?? []).map((p) => (
                    <tr key={p.integracaoId} className="border-t border-slate-800/70">
                      <td className="p-3">{p.loja}<div className="text-[11px] text-slate-500">{p.cnpj ?? ''}</div></td>
                      <td className="p-3 uppercase text-slate-300">{p.canal}</td>
                      <td className="p-3">
                        <button
                          onClick={() => { navigator.clipboard.writeText(p.token ?? ''); }}
                          title="Copiar token"
                          className="max-w-[180px] truncate rounded bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-300 hover:bg-slate-700"
                        >{p.token ? `${String(p.token).slice(0, 10)}…  copiar` : '—'}</button>
                      </td>
                      <td className="p-3">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${p.status === 'pendente' ? 'bg-amber-500/15 text-amber-400' : p.status === 'conectado' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>{p.status}</span>
                      </td>
                      <td className="p-3 text-xs text-slate-500">{quando(p.solicitadoEm)}</td>
                      <td className="p-3">
                        {p.status === 'pendente' ? (
                          <div className="flex gap-1.5">
                            <button onClick={() => resolverInteg(p.integracaoId, 'conectado')} className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400">Marcar conectado</button>
                            <button onClick={() => resolverInteg(p.integracaoId, 'recusado')} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">Recusar</button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">{p.conectadoPor ? `por ${p.conectadoPor}` : ''} {p.conectadoEm ? quando(p.conectadoEm) : ''}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {pedidosInteg && pedidosInteg.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhum pedido de integração ainda.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {aba === 'auditoria' && ehDiretoria && (
          <section className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400"><tr><th className="p-3">Quando</th><th className="p-3">Usuário</th><th className="p-3">Perfil</th><th className="p-3">Ação</th><th className="p-3">Alvo</th><th className="p-3">IP</th></tr></thead>
              <tbody>
                {(auditoria ?? []).map((a, i) => (
                  <tr key={i} className="border-t border-slate-800/70">
                    <td className="p-3 text-xs text-slate-500">{quando(a.criadoEm)}</td>
                    <td className="p-3">{a.usuario ?? '—'}</td>
                    <td className="p-3 text-xs text-slate-400">{a.perfil ?? '—'}</td>
                    <td className="p-3 text-amber-300">{a.acao}</td>
                    <td className="p-3 text-xs text-slate-500">{a.alvo ?? '—'}</td>
                    <td className="p-3 text-xs text-slate-500">{a.ip ?? '—'}</td>
                  </tr>
                ))}
                {auditoria && auditoria.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Sem ações registradas.</td></tr>}
              </tbody>
            </table>
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
