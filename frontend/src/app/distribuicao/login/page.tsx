'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { distApi, getDistToken, setDistToken } from '@/lib/api';

// Login do CONSOLE DA DISTRIBUIÇÃO (Regem) — realm separado das lojas.
export default function DistLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getDistToken()) router.replace('/distribuicao');
  }, [router]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      const r: any = await distApi.login(email.trim(), senha);
      setDistToken(r.access_token);
      router.replace('/distribuicao');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Regem · Distribuição</p>
          <h1 className="mt-1 text-2xl font-bold">Console de controle</h1>
          <p className="mt-1 text-sm text-slate-400">Acesso restrito à equipe da distribuição.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm text-slate-300">E-mail</label>
          <input
            id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-amber-500"
            autoComplete="username" placeholder="voce@regem"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="senha" className="text-sm text-slate-300">Senha</label>
          <input
            id="senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-amber-500"
            autoComplete="current-password"
          />
        </div>
        {erro && <p className="text-sm text-red-400">{erro}</p>}
        <button
          type="submit" disabled={loading}
          className="h-11 w-full rounded-lg bg-amber-500 font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-60"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
