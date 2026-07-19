'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearDistToken, distApi, getDistToken } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PERFIL_LABEL: Record<string, string> = {
  diretoria: 'Diretoria',
  tecnico: 'Técnico',
  financeiro: 'Financeiro',
};

// Home do Console da Distribuição (Fase 1). Painéis (Frota/Telemetria/Licenças/
// Financeiro) entram nas próximas fases — aqui já valem auth, perfil e gestão de usuários.
export default function DistHome() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [usuarios, setUsuarios] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', perfil: 'tecnico' });
  const [salvando, setSalvando] = useState(false);

  const sair = useCallback(() => {
    clearDistToken();
    router.replace('/distribuicao/login');
  }, [router]);

  useEffect(() => {
    if (!getDistToken()) {
      router.replace('/distribuicao/login');
      return;
    }
    distApi
      .me()
      .then((u: any) => {
        setMe(u);
        if (u?.perfil === 'diretoria') distApi.usuarios().then(setUsuarios).catch(() => {});
      })
      .catch(() => sair());
  }, [router, sair]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      await distApi.criarUsuario(novo);
      setNovo({ nome: '', email: '', senha: '', perfil: 'tecnico' });
      setUsuarios(await distApi.usuarios());
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar usuário.');
    } finally {
      setSalvando(false);
    }
  }

  if (!me) return <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">Carregando…</div>;

  const ehDiretoria = me.perfil === 'diretoria';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Regem · Distribuição</p>
          <h1 className="text-lg font-bold">Console de controle</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-300">
            {me.nome} · <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-amber-300">{PERFIL_LABEL[me.perfil] ?? me.perfil}</span>
          </span>
          <button onClick={sair} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500">Sair</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {/* Painéis futuros (Fase 2+) */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: 'Frota', d: 'Lojas, versão, online' },
            { t: 'Telemetria', d: 'Erros por loja/versão' },
            { t: 'Licenças', d: 'Leases e fingerprints' },
            { t: 'Financeiro', d: 'Assinaturas e cobrança' },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="font-semibold">{c.t}</p>
              <p className="text-xs text-slate-400">{c.d}</p>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-slate-600">em breve</p>
            </div>
          ))}
        </section>

        {/* Gestão de usuários — só Diretoria */}
        {ehDiretoria && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="font-display text-base font-bold">Usuários da distribuição</h2>
            <form onSubmit={criar} className="mt-3 grid gap-2 sm:grid-cols-5">
              <input required placeholder="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm sm:col-span-1" />
              <input required type="email" placeholder="E-mail" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm sm:col-span-2" />
              <input required type="password" placeholder="Senha (mín. 8)" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm" />
              <div className="flex gap-2">
                <select value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })} className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm">
                  <option value="tecnico">Técnico</option>
                  <option value="financeiro">Financeiro</option>
                  <option value="diretoria">Diretoria</option>
                </select>
                <button type="submit" disabled={salvando} className="rounded-lg bg-amber-500 px-3 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60">+</button>
              </div>
            </form>
            {erro && <p className="mt-2 text-sm text-red-400">{erro}</p>}
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
