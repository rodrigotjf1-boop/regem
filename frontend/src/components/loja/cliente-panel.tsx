'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { brl, getClienteToken, setClienteToken, limparCliente } from './tipos';
import { buscarCep, localizacaoAtual } from '@/lib/geo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Painel "Perfil" do cliente — identidade confirmada por OTP (WhatsApp),
// cashback e endereços salvos. O histórico de pedidos fica na aba "Pedidos".
export function ClientePanel({
  token,
  bairros = [],
  onClose,
  onUsarEndereco,
}: {
  token: string;
  bairros?: any[];
  onClose: () => void;
  onUsarEndereco: (e: any) => void;
}) {
  const [perfil, setPerfil] = useState<any>(null);
  const [etapa, setEtapa] = useState<'telefone' | 'codigo'>('telefone');
  const [telefone, setTelefone] = useState('');
  const [codigo, setCodigo] = useState('');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [novoEnd, setNovoEnd] = useState(false);
  const [end, setEnd] = useState<any>({ apelido: '', cep: '', logradouro: '', numero: '', bairro: '', bairroId: '', complemento: '', referencia: '', lat: '', lng: '' });
  const [geoMsg, setGeoMsg] = useState('');
  async function cepBlur(cep: string) {
    const d = await buscarCep(cep);
    if (d) setEnd((s: any) => ({ ...s, logradouro: d.logradouro || s.logradouro, bairro: d.bairro || s.bairro, cidade: d.cidade || s.cidade }));
  }
  async function usarLocalizacao() {
    setGeoMsg('Obtendo localização…');
    try {
      const c = await localizacaoAtual();
      setEnd((s: any) => ({ ...s, lat: c.lat, lng: c.lng }));
      setGeoMsg('📍 Localização capturada.');
    } catch (e) {
      setGeoMsg(e instanceof Error ? e.message : 'Falha ao localizar.');
    }
  }
  const clienteToken = getClienteToken(token);
  const [cashback, setCashback] = useState<any>(null);

  const carregar = useCallback(async () => {
    const ct = getClienteToken(token);
    if (!ct) return;
    try {
      const p: any = await api.clientePerfil(token, ct);
      setPerfil(p);
      const tel = (p?.cliente?.telefone ?? '').replace(/\D/g, '');
      if (tel.length >= 10) api.cardapioCashback(token, getClienteToken(token) || undefined).then(setCashback).catch(() => setCashback(null));
    } catch {
      setClienteToken(token, null);
      setPerfil(null);
    }
  }, [token]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function enviarCodigo() {
    if (telefone.replace(/\D/g, '').length < 10) return setErro('Informe um telefone válido (com DDD).');
    setBusy(true);
    setErro('');
    try {
      const r: any = await api.clienteOtpEnviar(token, telefone);
      setEtapa('codigo');
      if (!r?.enviado) setErro('Código gerado (envio por WhatsApp ainda não configurado).');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar o código');
    } finally {
      setBusy(false);
    }
  }
  async function confirmarCodigo() {
    if (!nome.trim()) return setErro('Informe seu nome.');
    if (codigo.trim().length < 4) return setErro('Digite o código recebido.');
    setBusy(true);
    setErro('');
    try {
      const r: any = await api.clienteOtpConfirmar(token, { telefone, codigo, nome });
      setClienteToken(token, r.clienteToken);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Código inválido');
    } finally {
      setBusy(false);
    }
  }

  async function addEndereco() {
    if (!clienteToken) return;
    try {
      await api.clienteAddEndereco(token, { clienteToken, ...end });
      setNovoEnd(false);
      setEnd({ apelido: '', logradouro: '', numero: '', bairro: '', bairroId: '', complemento: '', referencia: '' });
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
  // Sair: desconecta este aparelho (não apaga a conta) e limpa o PII local (LGPD).
  function sair() {
    limparCliente(token);
    setPerfil(null);
    onClose();
  }

  // Excluir conta: exige confirmação por código OTP no WhatsApp.
  const [excluir, setExcluir] = useState<'aviso' | 'codigo' | null>(null);
  const [codExc, setCodExc] = useState('');
  const [busyExc, setBusyExc] = useState(false);
  const [erroExc, setErroExc] = useState('');

  async function enviarCodExclusao() {
    const tel = perfil?.cliente?.telefone;
    if (!tel) return;
    setBusyExc(true);
    setErroExc('');
    try {
      const r: any = await api.clienteOtpEnviar(token, tel);
      setExcluir('codigo');
      if (!r?.enviado) setErroExc('Código gerado (envio por WhatsApp ainda não configurado).');
    } catch (e) {
      setErroExc(e instanceof Error ? e.message : 'Erro ao enviar o código');
    } finally {
      setBusyExc(false);
    }
  }
  async function confirmarExclusao() {
    if (codExc.trim().length < 4) return setErroExc('Digite o código recebido.');
    if (!clienteToken) return;
    setBusyExc(true);
    setErroExc('');
    try {
      // Verifica o código (valida a posse do telefone) e então exclui a conta.
      await api.clienteOtpConfirmar(token, {
        telefone: perfil?.cliente?.telefone,
        codigo: codExc,
        nome: perfil?.cliente?.nome ?? 'Cliente',
      });
      await api.clienteEsquecer(token, clienteToken).catch(() => {});
      limparCliente(token);
      setPerfil(null);
      setExcluir(null);
      onClose();
    } catch (e) {
      setErroExc(e instanceof Error ? e.message : 'Código inválido');
    } finally {
      setBusyExc(false);
    }
  }

  const inp = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm';

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 text-[#1a1a1a] shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Perfil</h2>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-black/40">×</button>
        </div>
        {erro && <p className="mb-2 text-sm text-red-600">{erro}</p>}

        {!perfil ? (
          etapa === 'telefone' ? (
            <div className="space-y-3">
              <p className="text-sm text-black/60">Confirme seu telefone para salvar endereços e ver seus pedidos. Enviaremos um código pelo WhatsApp.</p>
              <input className={inp} inputMode="tel" placeholder="Telefone (com DDD)" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              <button type="button" onClick={enviarCodigo} disabled={busy} className="w-full rounded-lg bg-[#1a1a1a] py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? 'Enviando…' : 'Enviar código'}
              </button>
              <p className="text-[11px] text-black/40">Seus dados ficam salvos e você pode apagá-los quando quiser (LGPD).</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-black/60">Enviamos um código para <b>{telefone}</b>.</p>
              <input className={inp} placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              <input className={inp} inputMode="numeric" placeholder="Código de 6 dígitos" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              <button type="button" onClick={confirmarCodigo} disabled={busy} className="w-full rounded-lg bg-[#1a1a1a] py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? 'Confirmando…' : 'Confirmar'}
              </button>
              <button type="button" onClick={() => { setEtapa('telefone'); setErro(''); }} className="w-full text-xs text-black/50 underline">trocar telefone</button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Olá, {perfil.cliente.nome || 'cliente'}! 👋
              <span className="block text-xs text-black/50">{perfil.cliente.telefone}</span>
            </p>

            {/* Saldo de cashback */}
            {cashback && ((cashback.valor ?? 0) > 0 || (cashback.pontos ?? 0) > 0 || (cashback.vales ?? []).length > 0) && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-bold text-emerald-700">💰 Seu cashback</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-emerald-700">
                  {(cashback.valor ?? 0) > 0 && <span>Saldo: <b>{brl(Number(cashback.valor))}</b> (abate no próximo pedido)</span>}
                  {(cashback.pontos ?? 0) > 0 && <span>Pontos: <b>{cashback.pontos}</b> (troque em Promos)</span>}
                </div>
                {(cashback.vales ?? []).length > 0 && (
                  <p className="mt-1 text-[11px] text-emerald-600">{cashback.vales.length} vale(s) para usar: {cashback.vales.map((v: any) => v.descricao).join(', ')}</p>
                )}
              </div>
            )}

            {/* Pedidos ativos — número + código de entrega em destaque */}
            {Array.isArray(perfil.historico) &&
              perfil.historico.some(
                (p: any) => p.codigoEntrega && !['concluido', 'cancelado', 'entregue'].includes(p.status),
              ) && (
                <div className="rounded-xl border border-black/10 p-3">
                  <p className="text-sm font-bold">🛵 Pedidos ativos</p>
                  <div className="mt-1.5 space-y-1.5">
                    {perfil.historico
                      .filter((p: any) => p.codigoEntrega && !['concluido', 'cancelado', 'entregue'].includes(p.status))
                      .map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-black/70">Pedido {p.numero ? `#${p.numero}` : ''}</span>
                          <span className="rounded-md bg-black/5 px-2 py-0.5 font-mono text-base font-extrabold tracking-[0.2em]">
                            {p.codigoEntrega}
                          </span>
                        </div>
                      ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-black/50">Informe o código ao entregador para confirmar o recebimento.</p>
                </div>
              )}

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
                    <input className={`${inp} w-32`} inputMode="numeric" placeholder="CEP" value={end.cep} onChange={(e) => setEnd({ ...end, cep: e.target.value })} onBlur={(e) => cepBlur(e.target.value)} />
                    <button type="button" onClick={usarLocalizacao} className="flex-1 rounded-lg border border-black/15 px-2 text-xs font-semibold">📍 Usar minha localização</button>
                  </div>
                  {geoMsg && <p className="text-[11px] text-black/50">{geoMsg}</p>}
                  <div className="flex gap-2">
                    <input className={inp} placeholder="Rua" value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} />
                    <input className={`${inp} w-24`} placeholder="Nº" value={end.numero} onChange={(e) => setEnd({ ...end, numero: e.target.value })} />
                  </div>
                  {bairros.length > 0 ? (
                    <select
                      className={inp}
                      aria-label="Bairro (área de atendimento)"
                      value={end.bairroId}
                      onChange={(e) => {
                        const b = bairros.find((x: any) => x.id === e.target.value);
                        setEnd({ ...end, bairroId: e.target.value, bairro: b?.nome ?? '' });
                      }}
                    >
                      <option value="">Bairro (área de entrega)</option>
                      {bairros.map((b: any) => (
                        <option key={b.id} value={b.id}>{b.nome} — {brl(Number(b.taxa))}</option>
                      ))}
                    </select>
                  ) : (
                    <input className={inp} placeholder="Bairro" value={end.bairro} onChange={(e) => setEnd({ ...end, bairro: e.target.value })} />
                  )}
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

            <div className="flex items-center justify-between border-t border-black/10 pt-3">
              <button type="button" onClick={sair} className="text-sm font-semibold text-[#1a1a1a] underline">Sair</button>
              <button type="button" onClick={() => { setExcluir('aviso'); setErroExc(''); setCodExc(''); }} className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600" title="Excluir conta">
                🗑️ Excluir conta
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Excluir conta — confirmação + OTP */}
      {excluir && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setExcluir(null)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 text-[#1a1a1a] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-bold text-red-600">Excluir sua conta?</p>
            {excluir === 'aviso' ? (
              <>
                <p className="mt-2 text-sm text-black/70">
                  Você vai perder <b>todo o histórico de pedidos, seus dados, endereços salvos e os pontos de fidelidade</b> deste estabelecimento. Essa ação não pode ser desfeita.
                </p>
                <p className="mt-2 text-xs text-black/50">Para confirmar, enviaremos um código pelo WhatsApp.</p>
                {erroExc && <p className="mt-2 text-xs text-red-600">{erroExc}</p>}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setExcluir(null)} className="rounded-lg border border-black/15 py-2.5 text-sm font-semibold">Cancelar</button>
                  <button type="button" onClick={enviarCodExclusao} disabled={busyExc} className="rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busyExc ? 'Enviando…' : 'Sim, excluir'}</button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-black/70">Digite o código enviado para o seu WhatsApp para confirmar a exclusão.</p>
                <input value={codExc} onChange={(e) => setCodExc(e.target.value)} inputMode="numeric" placeholder="Código" className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-center font-mono text-lg tracking-widest" />
                {erroExc && <p className="mt-2 text-xs text-red-600">{erroExc}</p>}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setExcluir(null)} className="rounded-lg border border-black/15 py-2.5 text-sm font-semibold">Cancelar</button>
                  <button type="button" onClick={confirmarExclusao} disabled={busyExc} className="rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busyExc ? 'Excluindo…' : 'Confirmar exclusão'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
