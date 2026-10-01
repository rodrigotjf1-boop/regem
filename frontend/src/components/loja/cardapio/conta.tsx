'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { buscarCep, localizacaoAtual } from '@/lib/geo';
import { getClienteToken, limparCliente, setClienteToken } from '@/components/loja/tipos';
import type { Cardapio } from './use-cardapio';
import { brl, Ic } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "SUA CONTA" (05 §2.1): o que antes ficava em três painéis (Perfil, Pedidos e Promos) e só
// aparecia com o carrinho vazio. As chamadas ao servidor são as MESMAS de `cliente-panel`,
// `pedidos-panel` e `promos-panel`: entrar por código no WhatsApp, pedidos (avisos, encomendas
// recorrentes, alteração, cancelamento, pedir de novo), benefícios (cashback, troca de pontos,
// fidelidade, cupons, ofertas) e perfil (endereços, promoções pelo WhatsApp, sair, excluir conta).

type Aba = 'pedidos' | 'beneficios' | 'perfil';

const hhmm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

// Rótulo por status. "Aguardando aceite" vem do status `novo` (com auto-aceite, o pedido já
// teria saído de `novo`).
const STATUS: Record<string, string> = {
  novo: 'Aguardando aceite',
  confirmado: 'Em preparo',
  preparo: 'Em preparo',
  pronto: 'Pronto',
  despachado: 'Em rota',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};
const finalizado = (s: string) => s === 'concluido' || s === 'cancelado';
// Cancelável enquanto ainda não saiu para entrega (alinhado ao backend).
const cancelavel = (s: string) => !['despachado', 'concluido', 'cancelado'].includes(s);
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function Conta({ c }: { c: Cardapio }) {
  const token = c.token;
  const [aba, setAba] = useState<Aba>('pedidos');
  const [perfil, setPerfil] = useState<any>(null);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const ct = getClienteToken(token);
    if (!ct) {
      setPerfil(null);
      setCarregado(true);
      return;
    }
    try {
      setPerfil(await api.clientePerfil(token, ct));
    } catch {
      // Sessão que o servidor não reconhece mais: sai deste aparelho.
      setClienteToken(token, null);
      setPerfil(null);
      c.sessaoMudou();
    } finally {
      setCarregado(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const cabecalho = (
    <header className="ch">
      <button type="button" className="ch-b" onClick={c.voltar} aria-label="Voltar ao cardápio">
        <Ic n="back" />
      </button>
      <b className="ac-tit">Sua conta</b>
    </header>
  );

  if (!perfil) {
    return (
      <div className="p-panel" role="dialog" aria-label="Sua conta">
        {cabecalho}
        <div className="p-pbody">
          {!carregado ? (
            <p className="c-note c-pad">Carregando…</p>
          ) : (
            <>
              <Entrar
                token={token}
                onEntrou={async () => {
                  c.sessaoMudou();
                  await carregar();
                }}
              />
              <div className="c-sec">
                <Aparencia c={c} />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-panel" role="dialog" aria-label="Sua conta">
      {cabecalho}
      <nav className="ac-tabs" aria-label="Sua conta">
        {(
          [
            ['pedidos', 'Pedidos'],
            ['beneficios', 'Benefícios'],
            ['perfil', 'Perfil'],
          ] as [Aba, string][]
        ).map(([k, n]) => (
          <button key={k} type="button" aria-pressed={aba === k} onClick={() => { setAba(k); setErro(''); }}>
            {n}
          </button>
        ))}
      </nav>
      <div className="p-pbody" key={aba}>
        {erro && (
          <p role="alert" className="p-erro c-pad-m">
            {erro}
          </p>
        )}
        {aba === 'pedidos' && <AbaPedidos c={c} perfil={perfil} onMudou={carregar} />}
        {aba === 'beneficios' && <AbaBeneficios c={c} perfil={perfil} />}
        {aba === 'perfil' && <AbaPerfil c={c} perfil={perfil} setPerfil={setPerfil} recarregar={carregar} setErro={setErro} />}
      </div>
    </div>
  );
}

// ───────────────────────── Entrar (código pelo WhatsApp) ─────────────────────────

function Entrar({ token, onEntrou }: { token: string; onEntrou: () => void | Promise<void> }) {
  const [etapa, setEtapa] = useState<'telefone' | 'codigo'>('telefone');
  const [telefone, setTelefone] = useState('');
  const [codigo, setCodigo] = useState('');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

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
      await onEntrou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Código inválido');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="c-sec">
      <h3 className="c-h">Entre com o seu WhatsApp</h3>
      {etapa === 'telefone' ? (
        <>
          <p className="c-sub">Enviamos um código pelo WhatsApp. Com ele você vê seus pedidos, endereços e benefícios.</p>
          <div className="c-f">
            <label htmlFor="lp-otp-tel">WhatsApp com DDD</label>
            <input id="lp-otp-tel" className="c-in" inputMode="tel" autoComplete="tel" placeholder="(21) 9 0000-0000" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          </div>
          {erro && <p className="c-msg err" role="alert">{erro}</p>}
          <button type="button" className="p-btn c" onClick={enviarCodigo} disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar código'}
          </button>
          <p className="c-note">Seus dados ficam salvos e você pode apagá-los quando quiser.</p>
        </>
      ) : (
        <>
          <p className="c-sub">
            Enviamos um código para <b>{telefone}</b>.
          </p>
          <div className="c-f">
            <label htmlFor="lp-otp-nome">Seu nome</label>
            <input id="lp-otp-nome" className="c-in" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="c-f">
            <label htmlFor="lp-otp-cod">Código de 6 dígitos</label>
            <input id="lp-otp-cod" className="c-in c-in-cod" inputMode="numeric" autoComplete="one-time-code" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </div>
          {erro && <p className="c-msg err" role="alert">{erro}</p>}
          <button type="button" className="p-btn c" onClick={confirmarCodigo} disabled={busy}>
            {busy ? 'Confirmando…' : 'Confirmar'}
          </button>
          <button type="button" className="c-link" onClick={() => { setEtapa('telefone'); setErro(''); }}>
            Trocar o telefone
          </button>
        </>
      )}
    </div>
  );
}

// ───────────────────────── Pedidos ─────────────────────────

function AbaPedidos({ c, perfil, onMudou }: { c: Cardapio; perfil: any; onMudou: () => void | Promise<void> }) {
  const token = c.token;
  const [recorrencias, setRecorrencias] = useState<any[]>([]);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const historico: any[] = perfil?.historico ?? [];

  const carregarExtras = useCallback(async () => {
    const ct = getClienteToken(token);
    if (!ct) return;
    try {
      const r: any = await api.cardapioRecorrencias(token, ct);
      setRecorrencias(Array.isArray(r) ? r : []);
    } catch {
      setRecorrencias([]);
    }
    // Avisos in-app de status (só existem quando a loja está na API oficial e o cliente não
    // iniciou conversa no WhatsApp). Ao abrir a aba, marca as não lidas como lidas.
    try {
      const n: any = await api.clienteNotificacoes(token, ct);
      setNotifs(Array.isArray(n?.itens) ? n.itens : []);
      if (n?.naoLidas > 0) api.clienteNotificacoesLidas(token, ct).catch(() => {});
    } catch {
      setNotifs([]);
    }
  }, [token]);
  useEffect(() => {
    void carregarExtras();
  }, [carregarExtras]);

  async function alterarRecorrencia(id: string, acao: 'pausar' | 'retomar' | 'cancelar') {
    const ct = getClienteToken(token);
    if (!ct) return;
    try {
      await api.cardapioAlterarRecorrencia(token, id, acao, ct);
      await carregarExtras();
    } catch {
      c.avisar('Não foi possível alterar a encomenda agora.');
    }
  }

  const ativos = historico.filter((p) => !finalizado(p.status));
  const anteriores = historico.filter((p) => finalizado(p.status));
  const linha = (p: any) => (
    <div key={p.id} className="ac-ped">
      <div className="ac-row">
        <b>
          {p.numero ? `Pedido ${p.numero}` : 'Pedido'} · {brl(Number(p.total))}
        </b>
        <span className={`st ${finalizado(p.status) ? 'fim' : ''}`}>{STATUS[p.status] ?? p.status}</span>
      </div>
      <small>
        {[hhmm(p.criadoEm), (p.itens ?? []).map((i: any) => i.descricao ?? i.nome).filter(Boolean).slice(0, 3).join(' · ')].filter(Boolean).join(' · ')}
      </small>
      {!finalizado(p.status) && p.codigoEntrega && (
        <div className="ac-cod">
          <span>
            Código de entrega
            <br />
            <small>Informe ao entregador para confirmar o recebimento.</small>
          </span>
          <b>{p.codigoEntrega}</b>
        </div>
      )}
      <div className="ac-acts">
        <button type="button" onClick={() => setSel(p)}>
          {finalizado(p.status) ? 'Ver detalhes e pedir de novo' : 'Detalhes, alteração e cancelamento'}
        </button>
        {!finalizado(p.status) && <a href={`/c/${token}/pedido/${p.id}`}>Acompanhar</a>}
      </div>
    </div>
  );

  return (
    <>
      {notifs.length > 0 && (
        <div className="c-sec">
          <h3 className="c-h">Avisos do pedido</h3>
          {notifs.slice(0, 8).map((n: any) => (
            <div key={n.id} className={`ac-ped ${n.lida ? '' : 'nova'}`}>
              <div className="ac-row">
                <b>{n.titulo}</b>
                <small>{hhmm(n.em)}</small>
              </div>
              <span>{n.texto}</span>
              {n.rastreioUrl && (
                <div className="ac-acts">
                  <a href={n.rastreioUrl} target="_blank" rel="noopener noreferrer">
                    Acompanhar entrega
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {recorrencias.length > 0 && (
        <div className="c-sec">
          <h3 className="c-h">Encomendas recorrentes</h3>
          {recorrencias.map((r: any) => (
            <div key={r.id} className="ac-ped">
              <div className="ac-row">
                <b>
                  {(r.dias ?? []).map((d: number) => DIAS[d]).join(', ') || 'Sem dia definido'}
                  {r.hora ? ` · ${String(r.hora).slice(0, 5)}` : ''}
                </b>
                <span className={`st ${r.status === 'pausada' ? 'fim' : ''}`}>{r.status === 'pausada' ? 'Pausada' : 'Ativa'}</span>
              </div>
              <small>
                {r.itens} {Number(r.itens) === 1 ? 'item' : 'itens'}
              </small>
              <div className="ac-acts">
                {r.status === 'ativa' ? (
                  <button type="button" onClick={() => alterarRecorrencia(r.id, 'pausar')}>Pausar</button>
                ) : (
                  <button type="button" onClick={() => alterarRecorrencia(r.id, 'retomar')}>Retomar</button>
                )}
                <button type="button" className="ac-del" onClick={() => alterarRecorrencia(r.id, 'cancelar')}>
                  Cancelar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="c-sec">
        <h3 className="c-h">Em andamento</h3>
        {ativos.length ? ativos.map(linha) : <p className="c-empty">Nenhum pedido em andamento.</p>}
      </div>
      <div className="c-sec">
        <h3 className="c-h">Pedidos anteriores</h3>
        {anteriores.length ? anteriores.map(linha) : <p className="c-empty">Você ainda não tem pedidos concluídos por aqui.</p>}
      </div>
      {sel && (
        <PedidoDetalhe
          c={c}
          pedido={sel}
          onFechar={() => setSel(null)}
          onMudou={() => {
            setSel(null);
            void onMudou();
          }}
        />
      )}
    </>
  );
}

// Detalhe do pedido: dados + ações (cancelar/alterar para o atual; pedir de novo para o
// finalizado). As solicitações abrem um chamado no sino da equipe.
function PedidoDetalhe({ c, pedido, onFechar, onMudou }: { c: Cardapio; pedido: any; onFechar: () => void; onMudou: () => void }) {
  const token = c.token;
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [alterar, setAlterar] = useState(false);
  const [detalhe, setDetalhe] = useState('');
  const ct = getClienteToken(token) ?? '';
  const fin = finalizado(pedido.status);
  const desconto = Number(pedido.desconto ?? 0);
  const taxa = Number(pedido.taxaEntrega ?? 0);
  // Busca o status completo (traz agendamento + sinal + prazo de cancelamento).
  const [full, setFull] = useState<any>(null);
  useEffect(() => {
    api.cardapioStatus(token, pedido.id).then((r: any) => setFull(r)).catch(() => {});
  }, [token, pedido.id]);
  const ehEncomenda = !!(full?.agendamento || pedido.agendamento);
  const sinal = full?.sinal;
  const prazoCancel = sinal?.cancelavelAte ? new Date(sinal.cancelavelAte) : null;
  const foraPrazo = !!(prazoCancel && Date.now() > prazoCancel.getTime());

  async function cancelarEncomendaDireto() {
    setBusy(true);
    setErro('');
    try {
      const r: any = await api.cardapioCancelarEncomenda(token, pedido.id, ct);
      const reemb = r?.reembolso === 'estornado' ? ' O sinal foi estornado.' : r?.reembolso === 'estorno_pendente' ? ' O estorno do sinal está sendo processado pela loja.' : '';
      setMsg('Encomenda cancelada.' + reemb);
      setConfirmCancel(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível cancelar a encomenda.');
    } finally {
      setBusy(false);
    }
  }
  async function pedirDeNovo() {
    setBusy(true);
    setErro('');
    try {
      const r: any = await api.clientePedirDeNovo(token, pedido.id, ct);
      c.reordenar(r.itens ?? []);
      c.fecharTudo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível repetir o pedido.');
    } finally {
      setBusy(false);
    }
  }
  async function solicitarCancel() {
    setBusy(true);
    setErro('');
    try {
      const r: any = await api.clienteSolicitarCancelamento(token, pedido.id, ct);
      const av = Array.isArray(r?.avisos) && r.avisos.length ? ' ' + r.avisos.join(' ') : '';
      setMsg('Pedido de cancelamento enviado. A equipe vai avaliar e responder.' + av);
      setConfirmCancel(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível solicitar o cancelamento.');
    } finally {
      setBusy(false);
    }
  }
  async function solicitarAlteracao(alvo: string) {
    setBusy(true);
    setErro('');
    try {
      await api.clienteSolicitarAlteracao(token, pedido.id, ct, alvo, detalhe);
      setMsg('Solicitação enviada. A equipe vai verificar e falar com você.');
      setAlterar(false);
      setDetalhe('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="p-dim p-dim-alto" onClick={onFechar} />
      <div className="p-modal p-modal-alto" role="dialog" aria-label="Detalhes do pedido">
        <div className="ac-row">
          <h3>Pedido {pedido.numero ?? ''}</h3>
          <span className={`ac-ped-st st ${fin ? 'fim' : ''}`}>{STATUS[pedido.status] ?? pedido.status}</span>
        </div>
        {!fin && full?.codigoEntrega && (
          <div className="ac-cod">
            <span>
              Código de entrega
              <br />
              <small>Informe ao entregador para confirmar o recebimento.</small>
            </span>
            <b>{full.codigoEntrega}</b>
          </div>
        )}
        <dl>
          {hhmm(pedido.criadoEm) && (
            <div>
              <dt>Feito em</dt>
              <dd>{hhmm(pedido.criadoEm)}</dd>
            </div>
          )}
          {hhmm(pedido.despachadoEm) && (
            <div>
              <dt>Saiu para entrega</dt>
              <dd>{hhmm(pedido.despachadoEm)}</dd>
            </div>
          )}
          {hhmm(pedido.concluidoEm) && (
            <div>
              <dt>Concluído</dt>
              <dd>{hhmm(pedido.concluidoEm)}</dd>
            </div>
          )}
          {hhmm(pedido.canceladoEm) && (
            <div>
              <dt>Cancelado</dt>
              <dd>{hhmm(pedido.canceladoEm)}</dd>
            </div>
          )}
          {(pedido.formaPagamento || pedido.bandeira) && (
            <div>
              <dt>Pagamento</dt>
              <dd>{pedido.bandeira || pedido.formaPagamento}</dd>
            </div>
          )}
        </dl>
        <div className="c-sum">
          {(pedido.itens ?? []).map((i: any, k: number) => (
            <div key={k}>
              <span>
                {i.quantidade}× {i.descricao ?? i.nome}
              </span>
              <span>{brl(Number(i.precoUnitario ?? 0) * Number(i.quantidade ?? 1))}</span>
            </div>
          ))}
          {taxa > 0 && (
            <div>
              <span>Taxa de entrega</span>
              <span>{brl(taxa)}</span>
            </div>
          )}
          {desconto > 0 && (
            <div className="gr">
              <span>Desconto{pedido.cupom ? ` (${pedido.cupom})` : ''}</span>
              <span>− {brl(desconto)}</span>
            </div>
          )}
          <div className="tt">
            <span>Total</span>
            <span>{brl(Number(pedido.total))}</span>
          </div>
        </div>

        {msg && <p className="c-msg ok" role="status">{msg}</p>}
        {erro && <p className="c-msg err" role="alert">{erro}</p>}

        {!msg &&
          (fin ? (
            <button type="button" className="p-btn c" onClick={pedirDeNovo} disabled={busy}>
              {busy ? 'Adicionando…' : 'Pedir de novo'}
            </button>
          ) : (
            <>
              {alterar ? (
                <div className="c-f">
                  <label htmlFor="lp-alt">O que você quer alterar?</label>
                  <textarea id="lp-alt" className="c-in c-in-area" value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder="Detalhe (opcional): trocar o troco, mudar a rua…" />
                  <div className="c-pay">
                    <button type="button" className="p-btn2" disabled={busy} onClick={() => solicitarAlteracao('endereco')}>Endereço de entrega</button>
                    <button type="button" className="p-btn2" disabled={busy} onClick={() => solicitarAlteracao('pedido')}>Itens do pedido</button>
                    <button type="button" className="p-btn2" disabled={busy} onClick={() => solicitarAlteracao('pagamento')}>Forma de pagamento</button>
                  </div>
                  <button type="button" className="c-link" onClick={() => setAlterar(false)}>Desistir da alteração</button>
                </div>
              ) : (
                <button type="button" className="p-btn2" onClick={() => { setAlterar(true); setErro(''); }}>
                  Pedir alteração
                </button>
              )}
              {/* Encomenda: cancelamento DIRETO com estorno do sinal dentro do prazo. */}
              {ehEncomenda ? (
                foraPrazo ? (
                  <p className="c-note">O prazo para cancelar com reembolso já passou. Fale com a loja se precisar.</p>
                ) : confirmCancel ? (
                  <div className="p-aviso fechada p-aviso-0">
                    <div>
                      <b>Cancelar esta encomenda?</b>
                      <span>
                        {sinal?.status === 'pago' && sinal?.valor != null && <>O sinal de {brl(Number(sinal.valor))} será estornado. </>}
                        {prazoCancel && <>Prazo até {prazoCancel.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.</>}
                      </span>
                      <div className="m-act m-act-esp">
                        <button type="button" className="p-btn2" onClick={() => setConfirmCancel(false)}>Voltar</button>
                        <button type="button" className="p-btn c p-btn-err" disabled={busy} onClick={cancelarEncomendaDireto}>{busy ? 'Cancelando…' : 'Cancelar encomenda'}</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="p-btn2 p-btn2-err" onClick={() => { setConfirmCancel(true); setErro(''); }}>
                    Cancelar encomenda
                  </button>
                )
              ) : (
                /* Pedido normal: solicita cancelamento à equipe (chamado no sino). */
                cancelavel(pedido.status) &&
                (confirmCancel ? (
                  <div className="p-aviso fechada p-aviso-0">
                    <div>
                      <b>Enviar pedido de cancelamento à equipe?</b>
                      <span>Eles vão avaliar e responder.</span>
                      <div className="m-act m-act-esp">
                        <button type="button" className="p-btn2" onClick={() => setConfirmCancel(false)}>Voltar</button>
                        <button type="button" className="p-btn c p-btn-err" disabled={busy} onClick={solicitarCancel}>{busy ? 'Enviando…' : 'Confirmar'}</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="p-btn2 p-btn2-err" onClick={() => { setConfirmCancel(true); setErro(''); }}>
                    Pedir cancelamento
                  </button>
                ))
              )}
            </>
          ))}
        <button type="button" className="p-btn2" onClick={msg ? onMudou : onFechar}>
          Fechar
        </button>
      </div>
    </>
  );
}

// ───────────────────────── Benefícios ─────────────────────────

function AbaBeneficios({ c, perfil }: { c: Cardapio; perfil: any }) {
  const token = c.token;
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [cashback, setCashback] = useState<any>(null);

  useEffect(() => {
    api.cardapioPromos(token).then(setData).catch(() => setData({ cupons: [], fidelidadeAtiva: false }));
  }, [token]);
  const carregarStatus = useCallback(() => {
    const tel = String(perfil?.cliente?.telefone ?? '').replace(/\D/g, '');
    if (tel.length < 10) {
      setStatus(null);
      setCashback(null);
      return;
    }
    const ct = getClienteToken(token) || undefined;
    api.cardapioPontos(token, ct).then(setStatus).catch(() => setStatus(null));
    api.cardapioCashback(token, ct).then(setCashback).catch(() => setCashback(null));
  }, [token, perfil]);
  useEffect(() => {
    carregarStatus();
  }, [carregarStatus]);

  async function resgatarProduto(produtoId: string) {
    try {
      await api.cardapioCashbackResgatar(token, getClienteToken(token) || undefined, produtoId);
      c.avisar('Produto resgatado: o desconto entra no seu próximo pedido.');
      carregarStatus();
    } catch (e) {
      c.avisar(e instanceof Error ? e.message : 'Não foi possível resgatar.');
    }
  }
  async function resgatar(id: string) {
    try {
      await api.cardapioFidelidadeResgatar(token, id, getClienteToken(token) || undefined);
      c.avisar('Prêmio resgatado: o desconto entra no seu próximo pedido.');
      carregarStatus();
    } catch (e) {
      c.avisar(e instanceof Error ? e.message : 'Não foi possível resgatar.');
    }
  }
  async function usarCupom(codigo: string) {
    await c.aplicarCupom(codigo);
    c.avisar(`Cupom ${codigo} guardado para a sacola`);
  }

  const cbPontosProdutos = (cashback?.planos ?? []).filter((p: any) => p.tipo === 'pontos').flatMap((p: any) => p.produtos ?? []);
  const temCashback = cashback && ((cashback.valor ?? 0) > 0 || (cashback.pontos ?? 0) > 0 || (cashback.vales ?? []).length > 0 || cbPontosProdutos.length > 0);
  const disponiveis = (status?.resgates ?? []).filter((r: any) => r.status === 'disponivel');
  const naCarteira = (status?.resgates ?? []).filter((r: any) => r.status === 'resgatado');
  const cupons: any[] = data?.cupons ?? [];
  const ofertas: any[] = c.produtosPromo;
  const rotuloCupom = (x: any) => (x.tipo === 'fretegratis' ? 'Frete grátis' : x.tipo === 'percentual' ? `${x.valor}% off` : `${brl(x.valor)} off`);
  const nada = data && !data.fidelidadeAtiva && cupons.length === 0 && ofertas.length === 0 && !temCashback;

  return (
    <>
      {temCashback && (
        <div className="c-sec">
          <h3 className="c-h">Cashback</h3>
          {(cashback.valor ?? 0) > 0 && (
            <div className="c-cb">
              <Ic n="repeat" s={16} />
              <span>
                Saldo de cashback: <b>{brl(Number(cashback.valor))}</b>. Abate no próximo pedido.
              </span>
            </div>
          )}
          {(cashback.pontos ?? 0) > 0 && (
            <div className="c-cb">
              <Ic n="gift" s={16} />
              <span>
                Você tem <b>{cashback.pontos} pontos</b> de cashback.
              </span>
            </div>
          )}
          {(cashback.vales ?? []).length > 0 && (
            <p className="c-note">
              {cashback.vales.length} vale{cashback.vales.length === 1 ? '' : 's'} para usar: {cashback.vales.map((v: any) => v.descricao).join(', ')}.
            </p>
          )}
          {cbPontosProdutos.length > 0 && (
            <>
              <h4 className="c-h4">Troque seus pontos</h4>
              {cbPontosProdutos.map((pr: any) => {
                const pode = (cashback.pontos ?? 0) >= pr.pontos;
                return (
                  <div key={pr.produtoId} className="c-card">
                    <Ic n="gift" />
                    <div>
                      <b>{pr.nome}</b>
                      <small>
                        {pr.pontos} pontos · vale {brl(Number(pr.precoVenda))}
                      </small>
                    </div>
                    <button type="button" className="lk" disabled={!pode} onClick={() => resgatarProduto(pr.produtoId)}>
                      {pode ? 'Resgatar' : 'Faltam pontos'}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {data?.fidelidadeAtiva && (
        <div className="c-sec">
          <h3 className="c-h">Programa de fidelidade</h3>
          {!status?.ativo && <p className="c-sub">Seus pontos aparecem aqui depois do primeiro pedido.</p>}
          {/* Prêmios disponíveis para resgate */}
          {disponiveis.map((r: any) => (
            <div key={r.id} className="c-card cup">
              <Ic n="gift" />
              <div>
                <b>{r.plano}</b>
                <small>
                  {r.recompensa}
                  {r.prazoEm ? ` · resgate até ${new Date(r.prazoEm).toLocaleDateString('pt-BR')}` : ''}
                </small>
              </div>
              <button type="button" className="lk" onClick={() => resgatar(r.id)}>
                Resgatar
              </button>
            </div>
          ))}
          {/* Prêmios resgatados aguardando uso (aplicam no próximo pedido) */}
          {naCarteira.map((r: any) => (
            <div key={r.id} className="c-cb">
              <Ic n="check" s={16} />
              <span>
                <b>{r.plano}</b> · {r.recompensa}: entra no seu próximo pedido.
              </span>
            </div>
          ))}
          {/* Progresso dos planos */}
          {((status?.planos ?? []).length ? status.planos : data?.planos ?? []).map((p: any) => {
            const saldo = Number(p.pontos) || 0;
            const meta = Number(p.pontosMeta) || 0;
            return (
              <div key={p.id} className="c-fid">
                <div className="r">
                  <b>
                    <Ic n="gift" s={14} /> {p.nome}
                  </b>
                  <span>
                    {saldo}/{meta} pts
                  </span>
                </div>
                <div className="bar" aria-hidden="true">
                  <i className="a" style={{ width: `${meta ? Math.min(100, (saldo / meta) * 100) : 0}%` }} />
                </div>
                <span>
                  {saldo >= meta && meta > 0 ? `Plano completo: ${p.recompensa}.` : `Faltam ${Math.max(0, meta - saldo)} pontos para ${p.recompensa}.`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {cupons.length > 0 && (
        <div className="c-sec">
          <h3 className="c-h">Cupons</h3>
          {cupons.map((x: any) => (
            <div key={x.codigo} className="c-card cup">
              <Ic n="tag" />
              <div>
                <b>{x.codigo}</b>
                <small>
                  {rotuloCupom(x)}
                  {x.minimo ? ` · mín. ${brl(x.minimo)}` : ''}
                  {x.validade ? ` · até ${new Date(x.validade).toLocaleDateString('pt-BR')}` : ''}
                </small>
              </div>
              <button type="button" className="lk" onClick={() => void usarCupom(x.codigo)}>
                Usar
              </button>
            </div>
          ))}
        </div>
      )}

      {ofertas.length > 0 && (
        <div className="c-sec">
          <h3 className="c-h">Ofertas do dia</h3>
          {ofertas.map((p: any) => (
            <button key={p.id} type="button" className="c-card c-card-b" onClick={() => c.abrirProduto(p)}>
              <Ic n="tag" />
              <div>
                <b>{p.nome}</b>
                <small>
                  {brl(p.precoVenda)} · antes {brl(p.precoDe)}
                </small>
              </div>
              <span className="lk">-{Math.round((1 - p.precoVenda / p.precoDe) * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      {nada && (
        <div className="c-sec">
          <p className="c-empty">Esta loja não tem benefícios ativos no momento.</p>
        </div>
      )}
    </>
  );
}

// ───────────────────────── Perfil ─────────────────────────

function Aparencia({ c }: { c: Cardapio }) {
  return (
    <div className="ac-row">
      <b>Aparência</b>
      <button type="button" className="lk-b" onClick={c.alternarTema} aria-label={c.dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}>
        <Ic n={c.dark ? 'sun' : 'moon'} s={16} /> {c.dark ? 'Usar tema claro' : 'Usar tema escuro'}
      </button>
    </div>
  );
}

function AbaPerfil({
  c,
  perfil,
  setPerfil,
  recarregar,
  setErro,
}: {
  c: Cardapio;
  perfil: any;
  setPerfil: (fn: (p: any) => any) => void;
  recarregar: () => void | Promise<void>;
  setErro: (m: string) => void;
}) {
  const token = c.token;
  const clienteToken = getClienteToken(token);
  const [novoEnd, setNovoEnd] = useState(false);
  const VAZIO = { apelido: '', cep: '', logradouro: '', numero: '', bairro: '', bairroId: '', complemento: '', referencia: '', lat: '', lng: '' };
  const [end, setEnd] = useState<any>(VAZIO);
  const [geoMsg, setGeoMsg] = useState('');
  // Promoções pelo WhatsApp: a chave aparece LIGADA para quem não pediu para sair; desligar vale
  // na hora. `acabouDeDesligar` troca o texto pela confirmação.
  const [busyPromo, setBusyPromo] = useState(false);
  const [acabouDeDesligar, setAcabouDeDesligar] = useState(false);

  async function cepBlur(cep: string) {
    const d = await buscarCep(cep);
    if (d) setEnd((s: any) => ({ ...s, logradouro: d.logradouro || s.logradouro, bairro: d.bairro || s.bairro, cidade: d.cidade || s.cidade }));
  }
  async function usarLocalizacao() {
    setGeoMsg('Obtendo localização…');
    try {
      const p = await localizacaoAtual();
      setEnd((s: any) => ({ ...s, lat: p.lat, lng: p.lng }));
      setGeoMsg('Localização capturada.');
    } catch (e) {
      setGeoMsg(e instanceof Error ? e.message : 'Falha ao localizar.');
    }
  }
  async function alternarPromocoes() {
    const ct = getClienteToken(token);
    if (!ct || !perfil?.promocoes || busyPromo) return;
    const ligar = !perfil.promocoes.ativo;
    setBusyPromo(true);
    setErro('');
    try {
      const r: any = await api.clientePromocoes(token, ct, ligar);
      setPerfil((p: any) => (p ? { ...p, promocoes: r?.promocoes ?? { ...p.promocoes, ativo: ligar } } : p));
      setAcabouDeDesligar(!ligar);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a sua escolha. Tente de novo.');
    } finally {
      setBusyPromo(false);
    }
  }
  async function addEndereco() {
    if (!clienteToken) return;
    try {
      await api.clienteAddEndereco(token, { clienteToken, ...end });
      setNovoEnd(false);
      setEnd(VAZIO);
      await recarregar();
      await c.recarregarPerfil();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar endereço');
    }
  }
  async function removerEndereco(id: string) {
    if (!clienteToken) return;
    await api.clienteRemEndereco(token, id, clienteToken).catch(() => {});
    await recarregar();
    await c.recarregarPerfil();
  }
  async function tornarPrincipal(id: string) {
    if (!clienteToken) return;
    try {
      await api.clientePrincipalEndereco(token, id, clienteToken);
      await recarregar();
      await c.recarregarPerfil();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível trocar o endereço principal.');
    }
  }
  // Sair: desconecta este aparelho (não apaga a conta) e limpa o PII local (LGPD).
  function sair() {
    limparCliente(token);
    c.sessaoMudou();
    c.fecharTudo();
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
      await api.clienteOtpConfirmar(token, { telefone: perfil?.cliente?.telefone, codigo: codExc, nome: perfil?.cliente?.nome ?? 'Cliente' });
      // Sem engolir o erro: se a exclusão não aconteceu (ex.: pedido em andamento), a pessoa vê o
      // motivo aqui e a sessão continua.
      await api.clienteEsquecer(token, clienteToken);
      limparCliente(token);
      setExcluir(null);
      c.sessaoMudou();
      c.fecharTudo();
    } catch (e) {
      setErroExc(e instanceof Error ? e.message : 'Código inválido');
    } finally {
      setBusyExc(false);
    }
  }

  const enderecos: any[] = perfil?.enderecos ?? [];
  return (
    <>
      <div className="c-sec">
        <div className="c-card">
          <Ic n="user" />
          <div>
            <b>{perfil.cliente?.nome || 'Cliente'}</b>
            <small>{perfil.cliente?.telefone}</small>
          </div>
        </div>
      </div>

      <div className="c-sec">
        <div className="ac-row">
          <h3 className="c-h">Endereços salvos</h3>
          <button type="button" className="lk-b" onClick={() => setNovoEnd((v) => !v)}>
            {novoEnd ? 'Cancelar' : '＋ Novo endereço'}
          </button>
        </div>
        {novoEnd && (
          <>
            <div className="c-f">
              <label htmlFor="lp-e-ap">Nome do endereço</label>
              <input id="lp-e-ap" className="c-in" placeholder="Casa, trabalho…" value={end.apelido} onChange={(e) => setEnd({ ...end, apelido: e.target.value })} />
            </div>
            <div className="c-2 c-2-inv">
              <div className="c-f">
                <label htmlFor="lp-e-cep">CEP</label>
                <input id="lp-e-cep" className="c-in" inputMode="numeric" value={end.cep} onChange={(e) => setEnd({ ...end, cep: e.target.value })} onBlur={(e) => void cepBlur(e.target.value)} />
              </div>
              <div className="c-f">
                <label>&nbsp;</label>
                <button type="button" className="p-btn2" onClick={usarLocalizacao}>
                  <Ic n="pin" s={16} /> Usar minha localização
                </button>
              </div>
            </div>
            {geoMsg && <p className="c-note" role="status">{geoMsg}</p>}
            <div className="c-2">
              <div className="c-f">
                <label htmlFor="lp-e-rua">Rua ou avenida</label>
                <input id="lp-e-rua" className="c-in" value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} />
              </div>
              <div className="c-f">
                <label htmlFor="lp-e-num">Número</label>
                <input id="lp-e-num" className="c-in" value={end.numero} onChange={(e) => setEnd({ ...end, numero: e.target.value })} />
              </div>
            </div>
            <div className="c-f">
              <label htmlFor="lp-e-bairro">Bairro</label>
              {c.bairros.length > 0 ? (
                <select
                  id="lp-e-bairro"
                  className="c-in"
                  value={end.bairroId}
                  onChange={(e) => {
                    const b = c.bairros.find((x: any) => x.id === e.target.value);
                    setEnd({ ...end, bairroId: e.target.value, bairro: b?.nome ?? '' });
                  }}
                >
                  <option value="">Escolha o bairro</option>
                  {c.bairros.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.nome} · {brl(Number(b.taxa))}
                    </option>
                  ))}
                </select>
              ) : (
                <input id="lp-e-bairro" className="c-in" value={end.bairro} onChange={(e) => setEnd({ ...end, bairro: e.target.value })} />
              )}
            </div>
            <div className="c-f">
              <label htmlFor="lp-e-ref">
                Complemento ou referência <em>(opcional)</em>
              </label>
              <input id="lp-e-ref" className="c-in" value={end.referencia} onChange={(e) => setEnd({ ...end, referencia: e.target.value })} />
            </div>
            <button type="button" className="p-btn c" onClick={addEndereco} disabled={!String(end.logradouro ?? '').trim()}>
              Salvar endereço
            </button>
          </>
        )}
        {enderecos.length === 0 && !novoEnd && <p className="c-empty">Nenhum endereço salvo.</p>}
        {enderecos.map((e: any) => (
          <div key={e.id} className="ac-ped">
            <div className="ac-row">
              <b>{e.apelido || 'Endereço'}</b>
              {e.principal && <span className="st">Principal</span>}
            </div>
            <small>
              {[e.logradouro, e.numero].filter(Boolean).join(', ')}
              {e.bairro ? ` · ${e.bairro}` : ''}
            </small>
            <div className="ac-acts">
              <button
                type="button"
                onClick={() => {
                  c.usarEndereco(e);
                  c.fecharTudo();
                  if (c.qtdItens > 0) c.abrirSacola();
                  else c.avisar('Endereço escolhido para o próximo pedido');
                }}
              >
                Usar neste pedido
              </button>
              {!e.principal && (
                <button type="button" onClick={() => tornarPrincipal(e.id)}>
                  Tornar principal
                </button>
              )}
              <button type="button" className="ac-del" onClick={() => removerEndereco(e.id)}>
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Promoções pelo WhatsApp — só na loja que manda promoção */}
      {perfil.promocoes && (
        <div className="c-sec">
          <div className="ac-row">
            <b>Promoções pelo WhatsApp</b>
            <button
              type="button"
              className="ac-sw"
              role="switch"
              aria-checked={!!perfil.promocoes.ativo}
              aria-label="Receber promoções pelo WhatsApp"
              disabled={busyPromo}
              onClick={alternarPromocoes}
            />
          </div>
          <p className="c-note" role="status">
            {perfil.promocoes.ativo ? perfil.promocoes.ligado : acabouDeDesligar ? perfil.promocoes.desligado : perfil.promocoes.fora}
          </p>
        </div>
      )}

      <div className="c-sec">
        <Aparencia c={c} />
      </div>

      <div className="c-sec">
        <div className="ac-row">
          <button type="button" className="ac-sair" onClick={sair}>
            Sair
          </button>
          <button type="button" className="ac-del" onClick={() => { setExcluir('aviso'); setErroExc(''); setCodExc(''); }}>
            Excluir conta
          </button>
        </div>
      </div>

      {/* Excluir conta — confirmação + código */}
      {excluir && (
        <>
          <div className="p-dim p-dim-alto" onClick={() => setExcluir(null)} />
          <div className="p-modal p-modal-alto" role="dialog" aria-label="Excluir conta">
            <h3>Excluir sua conta?</h3>
            {excluir === 'aviso' ? (
              <>
                <p>
                  Você perde todo o histórico de pedidos, seus dados, os endereços salvos e os pontos de fidelidade desta loja. Não dá para desfazer.
                </p>
                <p className="c-note">Para confirmar, enviamos um código pelo WhatsApp.</p>
                {erroExc && <p className="c-msg err" role="alert">{erroExc}</p>}
                <div className="m-act">
                  <button type="button" className="p-btn2" onClick={() => setExcluir(null)}>Cancelar</button>
                  <button type="button" className="p-btn c p-btn-err" onClick={enviarCodExclusao} disabled={busyExc}>{busyExc ? 'Enviando…' : 'Sim, excluir'}</button>
                </div>
              </>
            ) : (
              <>
                <p>Digite o código enviado para o seu WhatsApp para confirmar a exclusão.</p>
                <input className="c-in c-in-cod" inputMode="numeric" autoComplete="one-time-code" aria-label="Código de confirmação" placeholder="Código" value={codExc} onChange={(e) => setCodExc(e.target.value)} />
                {erroExc && <p className="c-msg err" role="alert">{erroExc}</p>}
                <div className="m-act">
                  <button type="button" className="p-btn2" onClick={() => setExcluir(null)}>Cancelar</button>
                  <button type="button" className="p-btn c p-btn-err" onClick={confirmarExclusao} disabled={busyExc}>{busyExc ? 'Excluindo…' : 'Confirmar exclusão'}</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
