'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, estabelecerSessao } from '@/lib/api';
import { RegemMark } from '@/components/brand/regem-mark';

// Máscara progressiva de CNPJ (00.000.000/0000-00).
function mascaraCnpj(v: string) {
  return v
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export default function CriarContaPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    empresaNome: '',
    cnpj: '',
    usuario: '',
    endereco: '',
    nome: '',
    email: '',
    senha: '',
  });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [loading, setLoading] = useState(false);
  const [passo, setPasso] = useState<'dados' | 'codigo'>('dados');
  const [codigo, setCodigo] = useState('');

  function set(k: keyof typeof form, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  // Passo 1: valida e dispara o código por e-mail (não cria conta ainda).
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setAviso('');
    setLoading(true);
    try {
      await api.register(form);
      setCodigo('');
      setPasso('codigo');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar conta');
    } finally {
      setLoading(false);
    }
  }

  // Passo 2: confirma o código → cria a conta e abre a sessão.
  async function onVerificar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      const r = await api.verificarCadastro(form.email, codigo);
      await estabelecerSessao(r.access_token);
      router.push('/inicio');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível verificar o código');
    } finally {
      setLoading(false);
    }
  }

  async function onReenviar() {
    setErro('');
    setAviso('');
    try {
      await api.reenviarCodigoCadastro(form.email);
      setAviso('Enviamos um novo código para o seu e-mail.');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível reenviar');
    }
  }

  const inputCls =
    'w-full h-12 rounded-xl bg-[#0F1A2E] border border-[#243150] px-4 text-[#EDF1F8] placeholder:text-[#5c6a86] outline-none focus:border-[#E2A340] focus:ring-2 focus:ring-[#E2A340]/40 transition-colors';
  const labelCls =
    'block font-mono text-[.68rem] font-medium uppercase tracking-[.16em] text-[#909CB4] mb-1.5';

  return (
    <main className="grid min-h-dvh bg-[#0B1220] font-sans text-[#EDF1F8] md:grid-cols-2">
      {/* Lado da marca */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-[#243150] p-12 md:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60">
          <svg
            viewBox="0 0 600 600"
            className="absolute -right-24 top-1/2 w-[720px] max-w-none -translate-y-1/2"
          >
            <circle cx="300" cy="300" r="240" fill="none" stroke="#243150" />
            <circle cx="300" cy="300" r="170" fill="none" stroke="#243150" />
            <circle cx="300" cy="300" r="100" fill="none" stroke="#243150" />
            <circle cx="540" cy="300" r="8" fill="#E2A340" />
            <circle cx="300" cy="130" r="6" fill="#57A89F" />
            <circle cx="205" cy="300" r="5" fill="#E27A5B" />
          </svg>
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <RegemMark className="h-10 w-10 text-[#EDF1F8]" />
          <span className="font-display text-2xl font-semibold">Regem</span>
        </div>

        <div className="relative z-10">
          <p className="mb-4 font-mono text-[.7rem] uppercase tracking-[.24em] text-[#E2A340]">
            Plataforma de gestão
          </p>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight">
            No comando de <span className="text-[#E2A340]">todo</span> o negócio.
          </h1>
          <p className="mt-4 max-w-sm text-[#909CB4]">
            Vendas, estoque, equipe e financeiro numa só plataforma. Simples no
            balcão, completa na diretoria.
          </p>
        </div>

        <p className="relative z-10 font-mono text-[.7rem] uppercase tracking-[.14em] text-[#909CB4]">
          Do balcão ao balanço.
        </p>
      </aside>

      {/* Lado do formulário */}
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 md:hidden">
            <RegemMark className="h-9 w-9 text-[#EDF1F8]" />
            <span className="font-display text-xl font-semibold">Regem</span>
          </div>

          <h2 className="font-display text-3xl font-bold tracking-tight">
            {passo === 'dados' ? 'Criar sua conta' : 'Confirme seu e-mail'}
          </h2>
          <p className="mt-2 text-[#909CB4]">
            {passo === 'dados'
              ? '3 meses grátis do sistema completo. Configure sua empresa em minutos.'
              : `Enviamos um código de 6 dígitos para ${form.email}. Digite-o abaixo para criar sua conta.`}
          </p>

          {passo === 'dados' && (
          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div>
              <label className={labelCls} htmlFor="empresaNome">
                Nome da empresa
              </label>
              <input
                id="empresaNome"
                className={inputCls}
                value={form.empresaNome}
                onChange={(e) => set('empresaNome', e.target.value)}
                placeholder="Ex.: Bar do Zé"
                required
                minLength={2}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="cnpj">
                CNPJ
              </label>
              <input
                id="cnpj"
                className={inputCls}
                value={form.cnpj}
                onChange={(e) => set('cnpj', mascaraCnpj(e.target.value))}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                required
                minLength={18}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="endereco">
                Endereço da matriz <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <input
                id="endereco"
                className={inputCls}
                value={form.endereco}
                onChange={(e) => set('endereco', e.target.value)}
                placeholder="Rua, nº, bairro, cidade/UF"
                autoComplete="street-address"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="nome">
                Seu nome
              </label>
              <input
                id="nome"
                className={inputCls}
                value={form.nome}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="Ex.: Rodrigo Oliveira"
                required
                minLength={2}
                autoComplete="name"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                className={inputCls}
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="voce@empresa.com"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="usuario">
                Usuário de acesso
              </label>
              <input
                id="usuario"
                className={inputCls}
                value={form.usuario}
                onChange={(e) => set('usuario', e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                placeholder="ex.: rodrigo"
                required
                minLength={3}
                autoComplete="username"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                É com este usuário que você entra no Regem (você já nasce como presidente).
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="senha">
                Senha
              </label>
              <input
                id="senha"
                type="password"
                className={inputCls}
                value={form.senha}
                onChange={(e) => set('senha', e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            {erro && (
              <p role="alert" className="text-sm text-[#E27A5B]">
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="h-12 w-full rounded-xl bg-[#E2A340] font-display font-semibold text-[#0B1220] transition-colors hover:bg-[#F2C277] disabled:opacity-60"
            >
              {loading ? 'Criando…' : 'Criar conta'}
            </button>
          </form>
          )}

          {passo === 'codigo' && (
            <form onSubmit={onVerificar} className="mt-8 space-y-5">
              <div>
                <label className={labelCls} htmlFor="codigo">
                  Código de verificação
                </label>
                <input
                  id="codigo"
                  className={`${inputCls} text-center text-2xl font-mono tracking-[.5em]`}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  minLength={6}
                  maxLength={6}
                  autoFocus
                />
              </div>

              {aviso && <p className="text-sm text-[#57A89F]">{aviso}</p>}
              {erro && (
                <p role="alert" className="text-sm text-[#E27A5B]">
                  {erro}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || codigo.length < 6}
                className="h-12 w-full rounded-xl bg-[#E2A340] font-display font-semibold text-[#0B1220] transition-colors hover:bg-[#F2C277] disabled:opacity-60"
              >
                {loading ? 'Verificando…' : 'Confirmar e criar conta'}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setPasso('dados');
                    setErro('');
                    setAviso('');
                  }}
                  className="text-[#909CB4] hover:underline"
                >
                  ← Voltar
                </button>
                <button
                  type="button"
                  onClick={onReenviar}
                  className="font-medium text-[#F2C277] hover:underline"
                >
                  Reenviar código
                </button>
              </div>
            </form>
          )}

          <p className="mt-6 text-sm text-[#909CB4]">
            Já tem conta?{' '}
            <Link href="/entrar" className="font-medium text-[#F2C277] hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
