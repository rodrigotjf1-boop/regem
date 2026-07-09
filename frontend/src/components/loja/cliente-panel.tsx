'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { brl, getClienteToken, setClienteToken } from './tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Painel "Meus dados" do cliente do cardápio (link mágico assinado). Identifica
// por telefone, mostra endereços salvos e histórico com "pedir de novo".
export function ClientePanel({
  token,
  onClose,
  onUsarEndereco,
  onPedirDeNovo,
}: {
  token: string;
  onClose: () => void;
  onUsarEndereco: (e: any) => void;
  onPedirDeNovo: (itens: any[]) => void;
}) {
  const [perfil, setPerfil] = useState<any>(null);
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [novoEnd, setNovoEnd] = useState(false);
  const [end, setEnd] = useState<any>({ apelido: '', logradouro: '', numero: '', bairro: '', complemento: '', referencia: '' });

  const clienteToken = getClienteToken(token);

  const carregar = useCallback(async () => {
    const ct = getClienteToken(token);
    if (!ct) return;
    try {
      setPerfil(await api.clientePerfil(token, ct));
    } catch {
      setClienteToken(token, null); // token inválido/expirado
      setPerfil(null);
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function identificar() {
    if (telefone.replace(/\D/g, '').length < 10) return setErro('Informe um telefone válido.');
    setBusy(true);
    setErro('');
    try {
      const r: any = await api.clienteIdentificar(token, { telefone, nome });
      setClienteToken(token, r.clienteToken);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao identificar');
    } finally {
      setBusy(false);
    }
  }

  async function addEndereco() {
    if (!clienteToken) return;
    try {
      await api.clienteAddEndereco(token, { clienteToken, ...end });
      setNovoEnd(false);
      setEnd({ apelido: '', logradouro: '', numero: '', bairro: '', complemento: '', referencia: '' });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar endereço');
    }
  }
  async function removerEndereco(id: string) {
    if (!clienteToken) return;
    await api.clienteRemEndereco(token, id, clienteToken).catch(() => {});
    await carregar();
  }
  async function pedirDeNovo(pedidoId: string) {
    if (!clienteToken) return;
    try {
      const r: any = await api.clientePedirDeNovo(token, pedidoId, clienteToken);
      onPedirDeNovo(r.itens ?? []);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao repetir pedido');
    }
  }
  async function esquecer() {
    if (!clienteToken) return;
    if (!confirm('Apagar seus dados (perfil, endereços e vínculo com pedidos) deste estabelecimento?')) return;
    await api.clienteEsquecer(token, clienteToken).catch(() => {});
    setClienteToken(token, null);
    setPerfil(null);
  }

  const inp = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 text-[#1a1a1a] shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Meus dados</h2>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-black/40">×</button>
        </div>
        {erro && <p className="mb-2 text-sm text-red-600">{erro}</p>}

        {!perfil ? (
          <div className="space-y-3">
            <p className="text-sm text-black/60">Informe seu telefone para salvar endereços e ver seus pedidos anteriores.</p>
            <input className={inp} inputMode="tel" placeholder="Telefone (com DDD)" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            <input className={inp} placeholder="Seu nome (opcional)" value={nome} onChange={(e) => setNome(e.target.value)} />
            <button type="button" onClick={identificar} disabled={busy} className="w-full rounded-lg bg-[#1a1a1a] py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? 'Entrando…' : 'Entrar / criar meu cadastro'}
            </button>
            <p className="text-[11px] text-black/40">Seus dados ficam salvos neste aparelho e você pode apagá-los quando quiser (LGPD).</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Olá{perfil.cliente.nome ? `, ${perfil.cliente.nome}` : ''}! 👋
              <span className="block text-xs text-black/50">{perfil.cliente.telefone}</span>
            </p>

            {/* Endereços */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-sm font-semibold">Endereços salvos</p>
                <button type="button" onClick={() => setNovoEnd((v) => !v)} className="text-xs font-medium text-[#1a1a1a] underline">
                  {novoEnd ? 'cancelar' : '+ novo'}
                </button>
              </div>
              {novoEnd && (
                <div className="mb-2 space-y-2 rounded-lg border border-black/10 p-2.5">
                  <input className={inp} placeholder="Apelido (Casa, Trabalho)" value={end.apelido} onChange={(e) => setEnd({ ...end, apelido: e.target.value })} />
                  <div className="flex gap-2">
                    <input className={inp} placeholder="Rua" value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} />
                    <input className={`${inp} w-24`} placeholder="Nº" value={end.numero} onChange={(e) => setEnd({ ...end, numero: e.target.value })} />
                  </div>
                  <input className={inp} placeholder="Bairro" value={end.bairro} onChange={(e) => setEnd({ ...end, bairro: e.target.value })} />
                  <input className={inp} placeholder="Complemento / referência" value={end.referencia} onChange={(e) => setEnd({ ...end, referencia: e.target.value })} />
                  <button type="button" onClick={addEndereco} className="w-full rounded-lg bg-[#1a1a1a] py-2 text-sm font-semibold text-white">Salvar endereço</button>
                </div>
              )}
              {perfil.enderecos.length === 0 && !novoEnd && <p className="text-xs text-black/40">Nenhum endereço salvo.</p>}
              <div className="space-y-1.5">
                {perfil.enderecos.map((e: any) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {e.apelido || 'Endereço'} {e.principal && <span className="text-[10px] text-emerald-600">• principal</span>}
                      </p>
                      <p className="truncate text-xs text-black/50">
                        {[e.logradouro, e.numero].filter(Boolean).join(', ')}{e.bairro ? ` — ${e.bairro}` : ''}
                      </p>
                    </div>
                    <button type="button" onClick={() => { onUsarEndereco(e); onClose(); }} className="flex-none text-xs font-semibold text-[#1a1a1a] underline">usar</button>
                    <button type="button" onClick={() => removerEndereco(e.id)} className="flex-none text-xs text-red-500">excluir</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Histórico */}
            <div>
              <p className="mb-1.5 text-sm font-semibold">Meus pedidos</p>
              {perfil.historico.length === 0 && <p className="text-xs text-black/40">Você ainda não fez pedidos por aqui.</p>}
              <div className="space-y-1.5">
                {perfil.historico.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{brl(Number(p.total))} <span className="text-xs text-black/40">· {p.status}</span></p>
                      <p className="truncate text-xs text-black/50">
                        {new Date(p.criadoEm).toLocaleDateString('pt-BR')} · {(p.itens ?? []).length} item(ns)
                      </p>
                    </div>
                    <button type="button" onClick={() => pedirDeNovo(p.id)} className="flex-none rounded-lg bg-[#1a1a1a] px-2.5 py-1 text-xs font-semibold text-white">pedir de novo</button>
                  </div>
                ))}
              </div>
            </div>

            <button type="button" onClick={esquecer} className="text-xs text-red-500 underline">Sair e apagar meus dados</button>
          </div>
        )}
      </div>
    </div>
  );
}
