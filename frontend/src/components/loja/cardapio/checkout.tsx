'use client';

import { useRef, useState } from 'react';
import { buscarCep, localizacaoAtual } from '@/lib/geo';
import { AvisoOrigem } from '@/components/loja/aviso-origem';
import type { Cardapio } from './use-cardapio';
import { rotuloAvancar, tituloEtapa, type Etapa } from './etapas';
import { OPCOES_TEMPLATE } from './tipos-template';
import { brl, Caixa, Foto, Ic, irAoCampo, Qtd, type NomeIcone } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CHECKOUT EM ETAPAS dos quatro templates (docs/templates-cardapio/00-base-cardapio.md §5):
// Sacola → Entrega → (Dados) → Pagamento, ou Sacola → Revisar no pedido expresso do Regem Fluxo.
// Aqui só há apresentação: valores, regras e o envio vêm do `useCardapio`. Cada template muda o
// cabeçalho, o lugar do cupom e o jeito de o rodapé dizer o que falta (`OPCOES_TEMPLATE`).

const soNumeros = (v: unknown) => String(v ?? '').replace(/\D/g, '');

// Date → "YYYY-MM-DDTHH:MM" na hora LOCAL (formato do input datetime-local).
function toLocalDT(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmtAgenda = (a: string) => `${a.slice(8, 10)}/${a.slice(5, 7)} às ${a.slice(11, 16)}`;
/** "a partir das 18:00" / "a partir de sex 18:00" (o servidor manda a próxima abertura pronta). */
const voltaEm = (v?: string | null) => (v ? (v.includes(' ') ? `a partir de ${v}` : `a partir das ${v}`) : 'indisponível agora');

/** Rótulo, ícone e apoio de cada forma de pagamento (as chaves fixas e as cadastradas pela loja). */
function formaInfo(pg: string, onde: string, parcelasMax?: number | null) {
  if (pg === 'pix') return { nome: 'Pix', apoio: 'Aprovação na hora, sem digitar cartão', sigla: 'PIX', agora: true };
  if (pg === 'cartao')
    return { nome: 'Cartão online', apoio: `Pagamento online seguro${parcelasMax && parcelasMax > 1 ? ` · em até ${parcelasMax}x` : ''}`, icone: 'card' as NomeIcone, agora: true };
  if (pg === 'entrega') return { nome: `Pagar ${onde}`, apoio: 'Dinheiro ou maquininha · avise se precisa de troco', icone: 'cash' as NomeIcone, agora: false };
  if (pg === 'vr') return { nome: 'Vale-refeição', apoio: 'Na maquininha', sigla: 'VR', agora: false };
  const n = pg.toLowerCase();
  if (n.includes('pix')) return { nome: pg, apoio: '', sigla: 'PIX', agora: false };
  if (n.includes('dinheiro')) return { nome: pg, apoio: '', icone: 'cash' as NomeIcone, agora: false };
  return { nome: pg, apoio: '', icone: 'card' as NomeIcone, agora: false };
}

/** Onde o cliente paga quando não paga agora: "na entrega", "na retirada" ou, nos serviços, "no local". */
const ondePaga = (c: Cardapio) => (c.isServico ? 'no local' : c.chk.tipo === 'entrega' ? 'na entrega' : 'na retirada');

const rotuloCupom = (c: any) =>
  c.tipo === 'fretegratis' ? 'Frete grátis' : c.tipo === 'valor' ? `${brl(c.valor)} off` : `${c.valor}% off${c.tetoDesconto ? ` (até ${brl(c.tetoDesconto)})` : ''}`;

export function Checkout({ c }: { c: Cardapio }) {
  const etapa = c.etapaAtual as Etapa;
  const op = OPCOES_TEMPLATE[c.template];
  const corpo = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, c.etapas.indexOf(etapa));
  const n = c.etapas.length;
  const proxima = c.etapas[idx + 1] ?? null;
  const ctxTitulo = { template: c.template, isServico: c.isServico, tipo: c.chk.tipo };
  const titulo = tituloEtapa(etapa, ctxTitulo);
  const f = c.falta(etapa);
  const valor = etapa === 'sacola' ? Math.max(0, c.total - c.desc - c.premioDesc) : c.totalFinal;
  const rotulo = c.enviando
    ? 'Enviando…'
    : rotuloAvancar({
        etapa,
        proxima,
        mesaDireta: c.mesaDireta,
        isServico: c.isServico,
        isIndustria: c.isIndustria,
        agendado: c.agendar && !c.isServico,
        tipo: c.chk.tipo,
        tituloProxima: proxima ? tituloEtapa(proxima, ctxTitulo) : undefined,
      });

  function avancar() {
    const falta = c.avancar();
    if (falta?.campo) irAoCampo(corpo.current, falta.campo);
  }

  const voltar = (
    <button type="button" className="ch-b" onClick={c.voltar} aria-label="Voltar">
      <Ic n="back" />
    </button>
  );
  let cabecalho;
  if (c.template === 'galeria') {
    cabecalho = (
      <>
        <header className="ch g-ch">
          {voltar}
          <b>{titulo}</b>
          <span className="ch-esp" />
        </header>
        <div className="g-prog" aria-hidden="true">
          {c.etapas.map((e, k) => (
            <i key={e} className={k <= idx ? 'on' : ''} />
          ))}
        </div>
      </>
    );
  } else if (c.template === 'balcao') {
    cabecalho = (
      <header className="ch b-ch">
        {voltar}
        <div>
          <b>{titulo}</b>
          {n > 1 && (
            <small>
              Etapa {idx + 1} de {n}
            </small>
          )}
        </div>
      </header>
    );
  } else if (c.template === 'oferta') {
    cabecalho = (
      <>
        <header className="ch o-ch">
          {voltar}
          <b>{titulo}</b>
        </header>
        {n > 1 && (
          <ol className="o-steps">
            {c.etapas.map((e, k) => (
              <li key={e} className={k < idx ? 'ok' : k === idx ? 'on' : ''} aria-current={k === idx ? 'step' : undefined}>
                <span>{k < idx ? <Ic n="check" s={13} /> : k + 1}</span>
                {e === 'sacola' ? 'Sacola' : e === 'entrega' ? (c.isServico ? 'Atendimento' : c.chk.tipo === 'retirada' ? 'Retirada' : 'Entrega') : tituloEtapa(e, ctxTitulo)}
              </li>
            ))}
          </ol>
        )}
      </>
    );
  } else {
    cabecalho = (
      <>
        <header className="ch f-ch">
          {voltar}
          <div className="f-chm">
            {n > 1 && (
              <small>
                {idx + 1} DE {n}
              </small>
            )}
            <b>{titulo}</b>
          </div>
          <button type="button" className="ch-b" onClick={c.fecharCheckout} aria-label="Voltar ao cardápio">
            <Ic n="close" s={18} />
          </button>
        </header>
        <div className="f-prog" aria-hidden="true">
          <i style={{ width: `${((idx + 1) / n) * 100}%` }} />
        </div>
      </>
    );
  }

  return (
    <div className="p-panel" role="dialog" aria-label={titulo}>
      {cabecalho}
      <div className="p-pbody" ref={corpo} key={etapa}>
        {etapa === 'sacola' && <EtapaSacola c={c} />}
        {etapa === 'entrega' && <EtapaEntrega c={c} />}
        {etapa === 'dados' && <EtapaDados c={c} />}
        {etapa === 'pagamento' && <EtapaPagamento c={c} />}
        {etapa === 'revisar' && <EtapaRevisar c={c} />}
      </div>
      <div className="p-foot">
        {/* Motivo da recusa, logo acima do botão — some na tentativa seguinte (ERR-140). */}
        {c.erroEnvio && (
          <p role="alert" className="p-erro">
            {c.erroEnvio}
          </p>
        )}
        {f && op.botaoDizOQueFalta ? (
          <button type="button" className="p-btn falta c" onClick={avancar}>
            {f.mensagem} {f.campo && <Ic n="down" s={16} />}
          </button>
        ) : (
          <>
            {f && <p className="p-hint">{f.mensagem}</p>}
            <button type="button" className="p-btn" onClick={avancar} disabled={!!f || c.enviando}>
              <span>{rotulo}</span>
              <span className="n">{brl(valor)}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Sacola ─────────────────────────

function EtapaSacola({ c }: { c: Cardapio }) {
  const op = OPCOES_TEMPLATE[c.template];
  return (
    <>
      <div className="c-sec">
        {c.cart.length === 0 && <p className="c-empty">Sua sacola está vazia.</p>}
        {c.cart.map((i) => (
          <div key={i.key} className="c-item">
            <div className="c-th">
              <Foto src={c.fotoDe(i.produtoId)} />
            </div>
            <div className="c-info">
              <b>{i.nome}</b>
              {(i.sub || i.obs) && <small>{[i.sub, i.obs && `Obs.: ${i.obs}`].filter(Boolean).join(' · ')}</small>}
              <span className="c-pr">{brl(i.preco * i.qtd)}</span>
            </div>
            <Qtd n={i.qtd} lixeira onMenos={() => c.mudarQtd(i.key, -1)} onMais={() => c.mudarQtd(i.key, 1)} />
          </div>
        ))}
        <button type="button" className="c-link" onClick={c.fecharCheckout}>
          <Ic n="plus" s={16} /> Adicionar mais itens
        </button>
        {op.freteNaSacola && !c.mesaDireta && <BarraFrete c={c} />}
      </div>
      <PecaTambem c={c} />
      {op.cupomNaSacola && !c.mesaDireta && !c.isIndustria && (
        <div className="c-sec">
          <CupomBox c={c} />
        </div>
      )}
      <div className="c-sec">
        <Resumo c={c} completo={false} />
        {c.template === 'fluxo' && c.etapas.length > 1 && <p className="c-note">Entrega e pagamento nas próximas etapas.</p>}
        {c.mesaDireta && <p className="c-note">Pedido da mesa {c.mesa}: vai direto para a cozinha.</p>}
      </div>
    </>
  );
}

/** "Faltam R$ X para o frete grátis" + barra; some sem meta, na retirada e com a entrega fechada. */
export function BarraFrete({ c }: { c: Cardapio }) {
  if (c.freteGratisAcima == null || c.isServico || c.chk.tipo !== 'entrega' || !c.dispEntrega) return null;
  const falta = Math.max(0, c.freteGratisAcima - c.total);
  return (
    <div className="c-frete">
      {falta > 0 ? (
        <span>
          Faltam <b>{brl(falta)}</b> para o frete grátis
        </span>
      ) : (
        <span>
          <b>Frete grátis</b> garantido neste pedido
        </span>
      )}
      <div className="bar">
        <i style={{ width: `${Math.min(100, (c.total / c.freteGratisAcima) * 100)}%` }} />
      </div>
    </div>
  );
}

function PecaTambem({ c }: { c: Cardapio }) {
  const op = OPCOES_TEMPLATE[c.template];
  const lista: any[] = c.upsell.slice(0, 6);
  if (!lista.length) return null;
  return (
    <div className="c-sec">
      <h3 className="c-h">{op.tituloUpsell}</h3>
      {op.upsellEmCards ? (
        <div className="c-ups">
          {lista.map((p) => (
            <button key={p.id} type="button" className="c-up" onClick={() => c.adicionarRapido(p)}>
              <div className="a">
                <Foto src={p.imagemRef} />
                <span>
                  <Ic n="plus" s={16} />
                </span>
              </div>
              <b>{p.nome}</b>
              <small>{Number(p.precoVenda) > 0 ? brl(p.precoVenda) : 'Monte o seu'}</small>
            </button>
          ))}
        </div>
      ) : (
        lista.slice(0, 3).map((p) => (
          <button key={p.id} type="button" className="c-upr" onClick={() => c.adicionarRapido(p)}>
            <span className="a">
              <Foto src={p.imagemRef} />
            </span>
            <span>
              <b>{p.nome}</b>
              <small>{Number(p.precoVenda) > 0 ? `+ ${brl(p.precoVenda)}` : 'Monte o seu'}</small>
            </span>
            <span>
              <Ic n="plus" s={16} />
            </span>
          </button>
        ))
      )}
    </div>
  );
}

// ───────────────────────── Cupom ─────────────────────────

function CupomBox({ c }: { c: Cardapio }) {
  const sugerido = OPCOES_TEMPLATE[c.template].botaoDizOQueFalta; // Regem Fluxo: cupom em cartão, campo recolhido
  const [aberto, setAberto] = useState(false);
  const sugestoes: any[] = c.cuponsSugeridos ?? [];
  const aplicado = !!c.cupomOk?.valido;
  const msg = c.cupomOk && (
    <p className={`c-msg ${aplicado ? 'ok' : 'err'}`} role="status">
      {aplicado
        ? c.cupomOk.freteGratis
          ? `Cupom ${c.chk.cupom} aplicado: frete grátis.`
          : `Cupom ${c.chk.cupom} aplicado: − ${brl(c.cupomOk.desconto)}.`
        : c.cupomOk.motivo ?? 'Cupom não encontrado. Confira as letras e tente de novo.'}
    </p>
  );
  const campo = (
    <div className="c-f" data-campo="cupom">
      <label htmlFor="lp-cupom">Cupom de desconto</label>
      <div className="c-cup">
        <input
          id="lp-cupom"
          className="c-in c-in-cod"
          value={c.chk.cupom ?? ''}
          disabled={aplicado}
          onChange={(e) => c.setChk((s: any) => ({ ...s, cupom: e.target.value.toUpperCase() }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void c.aplicarCupom();
            }
          }}
          placeholder="Digite o código"
          autoCapitalize="characters"
          autoComplete="off"
        />
        {aplicado ? (
          <button type="button" onClick={c.tirarCupom}>
            Tirar
          </button>
        ) : (
          <button type="button" onClick={() => void c.aplicarCupom()}>
            Aplicar
          </button>
        )}
      </div>
    </div>
  );

  if (sugerido && !aberto) {
    if (aplicado)
      return (
        <>
          {msg}
          <button type="button" className="c-link" onClick={c.tirarCupom}>
            Tirar o cupom
          </button>
        </>
      );
    const sug = sugestoes.find((x) => x.atingeMinimo);
    return (
      <>
        {sug && (
          <div className="c-card cup">
            <Ic n="tag" />
            <div>
              <b>{sug.codigo}</b>
              <small>{rotuloCupom(sug)} · disponível para você</small>
            </div>
            <button type="button" className="lk" onClick={() => void c.aplicarCupom(sug.codigo)}>
              Aplicar
            </button>
          </div>
        )}
        {c.cupomOk && !aplicado && msg}
        <button type="button" className="c-link" onClick={() => setAberto(true)}>
          <Ic n="plus" s={16} /> {sug ? 'Tenho outro código' : 'Tenho um cupom'}
        </button>
      </>
    );
  }
  return (
    <>
      {campo}
      {!aplicado && sugestoes.length > 0 && (
        <div className="c-sug">
          {sugestoes.map((s) => (
            <button key={s.codigo} type="button" disabled={!s.atingeMinimo} onClick={() => void c.aplicarCupom(s.codigo)}>
              <Ic n="tag" s={14} />
              <b>{s.codigo}</b> {rotuloCupom(s)}
              {s.minimo && !s.atingeMinimo ? ` · mín. ${brl(s.minimo)}` : ''}
            </button>
          ))}
        </div>
      )}
      {msg}
    </>
  );
}

// ───────────────────────── Resumo ─────────────────────────

function Resumo({ c, completo }: { c: Cardapio; completo: boolean }) {
  const entrega = !c.isServico && c.chk.tipo === 'entrega';
  const sinal = completo ? sinalDe(c) : null;
  const totalParcial = Math.max(0, c.total - c.desc - c.premioDesc);
  return (
    <div className="c-sum">
      <div>
        <span>Subtotal</span>
        <span>{brl(c.total)}</span>
      </div>
      {completo && entrega && (
        <div>
          <span>Entrega{c.bairroSel ? ` · ${c.bairroSel.nome}` : ''}</span>
          <span className={!c.taxaPendente && c.taxa === 0 ? 'gr' : ''}>{c.taxaPendente ? 'a calcular' : c.taxa === 0 ? 'Grátis' : brl(c.taxa)}</span>
        </div>
      )}
      {completo && !c.isServico && c.chk.tipo === 'retirada' && (
        <div>
          <span>Retirada na loja</span>
          <span>{brl(0)}</span>
        </div>
      )}
      {c.desc > 0 && (
        <div className="gr">
          <span>Cupom {c.chk.cupom}</span>
          <span>− {brl(c.desc)}</span>
        </div>
      )}
      {c.premioDesc > 0 && (
        <div className="gr">
          <span>Prêmio{c.premioNome ? ` · ${c.premioNome}` : ''}</span>
          <span>− {brl(c.premioDesc)}</span>
        </div>
      )}
      {completo && c.cashbackDesc > 0 && (
        <div className="gr">
          <span>Cashback usado</span>
          <span>− {brl(c.cashbackDesc)}</span>
        </div>
      )}
      <div className="tt">
        <span>{c.isIndustria ? 'Estimativa' : 'Total'}</span>
        <span>{brl(completo ? c.totalFinal : totalParcial)}</span>
      </div>
      {sinal && (
        <>
          <div>
            <span>Sinal agora ({sinal.pct}%)</span>
            <span>{brl(sinal.valor)}</span>
          </div>
          <div>
            <span>Restante na {c.chk.tipo === 'entrega' ? 'entrega' : 'retirada'}</span>
            <span>{brl(Math.max(0, c.totalFinal - sinal.valor))}</span>
          </div>
        </>
      )}
    </div>
  );
}

// Sinal (mig 187/188): resolve a regra pela quantidade de itens do carrinho e calcula valor +
// prazo de cancelamento para o AVISO antes de confirmar. Mesma conta do checkout antigo.
function sinalDe(c: Cardapio): { pct: number; valor: number; deadline: Date | null } | null {
  const enc = c.enc;
  if (!c.encAtiva || !enc?.sinal || !c.agendar) return null;
  const qtd = c.cart.reduce((s: number, i: any) => s + (Number(i.qtd) || 1), 0);
  const match = (enc.sinal.regras || [])
    .filter((r: any) => qtd >= (Number(r.minItens) || 0) && qtd <= (r.maxItens == null ? Infinity : Number(r.maxItens)))
    .sort((a: any, b: any) => (Number(b.minItens) || 0) - (Number(a.minItens) || 0))[0];
  const rule = match || enc.sinal.base;
  if (!rule || rule.exige === false || !(Number(rule.pct) > 0)) return null;
  const valor = Math.round(c.total * (Number(rule.pct) / 100) * 100) / 100;
  const deadline =
    rule.cancelHoras != null && c.chk.agendamento ? new Date(new Date(c.chk.agendamento).getTime() - Number(rule.cancelHoras) * 3600000) : null;
  return { pct: Number(rule.pct), valor, deadline };
}

// ───────────────────────── Entrega ─────────────────────────

function EtapaEntrega({ c }: { c: Cardapio }) {
  const comDados = c.etapas.indexOf('dados') < 0; // Galeria, Oferta e Fluxo: nome e WhatsApp aqui
  if (c.isServico) {
    return (
      <>
        <div className="c-sec">
          <h3 className="c-h">Quando?</h3>
          <div className="c-f">
            <label htmlFor="lp-agenda">Data e horário</label>
            <input
              id="lp-agenda"
              data-campo="agendamento"
              type="datetime-local"
              className="c-in"
              value={c.chk.agendamento}
              onChange={(e) => c.setChk((s: any) => ({ ...s, agendamento: e.target.value }))}
            />
          </div>
          <div className="c-f">
            <label htmlFor="lp-prof">
              Profissional <em>(opcional)</em>
            </label>
            <input id="lp-prof" className="c-in" value={c.chk.profissional ?? ''} onChange={(e) => c.setChk((s: any) => ({ ...s, profissional: e.target.value }))} />
          </div>
        </div>
        {comDados && <SecaoDados c={c} />}
      </>
    );
  }
  return (
    <>
      <TipoRecebimento c={c} />
      {c.chk.tipo === 'entrega' ? (
        <Endereco c={c} />
      ) : (
        <div className="c-sec">
          <div className="c-card">
            <Ic n="store" />
            <div>
              <b>{c.loja?.nome}</b>
              <small>
                {[c.loja?.endereco?.texto, c.loja?.tempoRetiradaMin != null ? `pronto em ~${c.loja.tempoRetiradaMin} min` : ''].filter(Boolean).join(' · ')}
              </small>
            </div>
          </div>
        </div>
      )}
      {!c.isIndustria && <Quando c={c} />}
      {c.isIndustria && (
        <div className="c-sec">
          <div className="c-f">
            <label htmlFor="lp-cnpj">
              CNPJ para faturamento <em>(opcional)</em>
            </label>
            <input id="lp-cnpj" className="c-in" inputMode="numeric" value={c.chk.cnpj ?? ''} onChange={(e) => c.setChk((s: any) => ({ ...s, cnpj: e.target.value }))} />
          </div>
        </div>
      )}
      {comDados && <SecaoDados c={c} />}
      {c.isIndustria && (
        <div className="c-sec">
          <Resumo c={c} completo />
          <Origem c={c} />
        </div>
      )}
    </>
  );
}

function TipoRecebimento({ c }: { c: Cardapio }) {
  const tipos: { v: string; rotulo: string; icone: NomeIcone; disp: boolean; apoio: string }[] = [];
  if (c.habEntrega)
    tipos.push({
      v: 'entrega',
      rotulo: 'Entrega',
      icone: 'moto',
      disp: c.dispEntrega,
      apoio: c.dispEntrega
        ? c.loja?.tempoEntregaMin != null
          ? `~${c.loja.tempoEntregaMin} min`
          : 'no seu endereço'
        : voltaEm(c.proximaAbertura.entrega),
    });
  if (c.habRetirada)
    tipos.push({
      v: 'retirada',
      rotulo: 'Retirada',
      icone: 'store',
      disp: c.dispRetirada,
      apoio: c.dispRetirada
        ? `${c.loja?.tempoRetiradaMin != null ? `~${c.loja.tempoRetiradaMin} min · ` : ''}grátis`
        : voltaEm(c.proximaAbertura.retirada),
    });
  if (tipos.length === 0) return null;
  return (
    <div className="c-sec">
      <h3 className="c-h">Como você quer receber?</h3>
      {tipos.length === 1 ? (
        <div className="c-card" data-campo="tipo">
          <Ic n={tipos[0].icone} />
          <div>
            <b>{tipos[0].rotulo}</b>
            <small>{tipos[0].apoio}</small>
          </div>
        </div>
      ) : (
        <div className="c-seg" data-campo="tipo">
          {tipos.map((t) => (
            <button key={t.v} type="button" aria-pressed={c.chk.tipo === t.v} disabled={!t.disp} onClick={() => c.setChk((s: any) => ({ ...s, tipo: t.v }))}>
              <span>
                <Ic n={t.icone} s={18} /> {t.rotulo}
              </span>
              <small>{t.apoio}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Endereco({ c }: { c: Cardapio }) {
  const set = (patch: any) => c.setChk((s: any) => ({ ...s, ...patch }));
  const [editar, setEditar] = useState(false);
  const [geo, setGeo] = useState('');
  const [cepAberto, setCepAberto] = useState(false);
  const [cep, setCep] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [apelido, setApelido] = useState('');
  const [querSalvar, setQuerSalvar] = useState(false);
  const salvos: any[] = c.enderecosSalvos ?? [];
  const localOk = c.areaRaio ? !!(c.chk.lat && c.chk.lng) : !!c.chk.bairroId;
  const completo = !!String(c.chk.rua ?? '').trim() && localOk;
  // Regem Fluxo: endereço já conhecido aparece resumido, com "Trocar".
  const resumido = c.template === 'fluxo' && completo && !editar && c.temCliente;
  const ehSalvo = (e: any) => (e.logradouro ?? '') === (c.chk.rua ?? '') && String(e.numero ?? '') === String(c.chk.numero ?? '');
  const jaSalvo = salvos.some(ehSalvo);

  async function usarLocalizacao() {
    setGeo('Obtendo localização…');
    try {
      const p = await localizacaoAtual();
      set({ lat: p.lat, lng: p.lng });
      setGeo('Localização definida: frete calculado pela distância.');
    } catch (e) {
      setGeo(e instanceof Error ? e.message : 'Não foi possível obter a localização.');
    }
  }
  async function cepBlur(v: string) {
    const d = await buscarCep(v);
    if (d?.logradouro) set({ rua: d.logradouro });
  }
  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    try {
      await c.cadastrarEndereco({
        apelido,
        cep,
        logradouro: c.chk.rua,
        numero: c.chk.numero,
        referencia: c.chk.referencia,
        bairroId: c.chk.bairroId,
        lat: c.chk.lat,
        lng: c.chk.lng,
      });
      setQuerSalvar(false);
      setApelido('');
      c.avisar('Endereço salvo na sua conta');
    } catch {
      // Não salvou: o motivo aparece acima do botão do rodapé.
    } finally {
      setSalvando(false);
    }
  }

  if (resumido) {
    return (
      <div className="c-sec">
        <h3 className="c-h">Entregar em</h3>
        <div className="c-card" data-campo="rua">
          <Ic n="pin" />
          <div>
            <b>{[c.chk.rua, c.chk.numero].filter(Boolean).join(', ')}</b>
            <small>{[c.bairroSel?.nome, c.chk.referencia].filter(Boolean).join(' · ')}</small>
          </div>
          <button type="button" className="lk" onClick={() => setEditar(true)}>
            Trocar
          </button>
        </div>
        <NotaFrete c={c} />
      </div>
    );
  }

  return (
    <div className="c-sec">
      <h3 className="c-h">Endereço de entrega</h3>
      {c.temCliente && salvos.length > 0 && (
        <div className="c-pay">
          {salvos.map((e) => (
            <button key={e.id} type="button" className="c-opt" aria-pressed={ehSalvo(e)} onClick={() => c.usarEndereco(e)}>
              <span className="ico">
                <Ic n="pin" s={18} />
              </span>
              <span>
                <b>{e.apelido || 'Endereço'}</b>
                <small>{[[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="po-r" />
            </button>
          ))}
        </div>
      )}
      {c.areaRaio ? (
        <div className="c-f" data-campo="localizacao">
          <button type="button" className="p-btn2" onClick={usarLocalizacao}>
            <Ic n="pin" s={18} /> Usar minha localização
          </button>
          <p className={`c-msg ${c.chk.lat ? 'ok' : ''}`} role="status">
            {geo || (c.chk.lat ? 'Localização definida: frete calculado pela distância.' : 'Toque em usar localização ou informe a rua: o frete é calculado pela distância.')}
          </p>
        </div>
      ) : (
        <div className="c-f">
          <label htmlFor="lp-bairro">
            Bairro <em>(define a taxa)</em>
          </label>
          <select id="lp-bairro" data-campo="bairroId" className="c-in" value={c.chk.bairroId ?? ''} onChange={(e) => set({ bairroId: e.target.value })}>
            <option value="">{c.bairros.length ? 'Escolha o bairro' : 'Sem área de entrega cadastrada'}</option>
            {c.bairros.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.nome} · {c.gratisAcima || Number(b.taxa) === 0 ? 'grátis' : brl(Number(b.taxa))}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="c-f">
        <label htmlFor="lp-rua">Rua ou avenida</label>
        <input
          id="lp-rua"
          data-campo="rua"
          className="c-in"
          value={c.chk.rua ?? ''}
          onChange={(e) => set({ rua: e.target.value })}
          autoComplete="address-line1"
        />
      </div>
      <div className="c-2">
        <div className="c-f">
          <label htmlFor="lp-ref">
            Complemento <em>(opcional)</em>
          </label>
          <input id="lp-ref" className="c-in" value={c.chk.referencia ?? ''} onChange={(e) => set({ referencia: e.target.value })} placeholder="Apto, bloco, referência" />
        </div>
        <div className="c-f">
          <label htmlFor="lp-num">Número</label>
          <input
            id="lp-num"
            className="c-in"
            value={c.chk.numero ?? ''}
            onChange={(e) => set({ numero: e.target.value })}
            inputMode="numeric"
          />
        </div>
      </div>
      {cepAberto ? (
        <div className="c-f">
          <label htmlFor="lp-cep">
            CEP <em>(preenche a rua)</em>
          </label>
          <input id="lp-cep" className="c-in" inputMode="numeric" value={cep} onChange={(e) => setCep(e.target.value)} onBlur={(e) => void cepBlur(e.target.value)} placeholder="00000-000" />
        </div>
      ) : (
        <button type="button" className="c-link" onClick={() => setCepAberto(true)}>
          <Ic n="search" s={16} /> Buscar a rua pelo CEP
        </button>
      )}
      <NotaFrete c={c} />
      {c.temCliente && completo && !jaSalvo && (
        querSalvar ? (
          <div className="c-f">
            <label htmlFor="lp-apelido">
              Nome deste endereço <em>(opcional)</em>
            </label>
            <div className="c-cup">
              <input id="lp-apelido" className="c-in" value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="Casa, trabalho…" />
              <button type="button" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="c-link" onClick={() => setQuerSalvar(true)}>
            <Ic n="plus" s={16} /> Salvar este endereço na minha conta
          </button>
        )
      )}
    </div>
  );
}

function NotaFrete({ c }: { c: Cardapio }) {
  if (c.taxaPendente) return null;
  const onde = c.areaRaio ? (c.km != null ? `a ${c.km.toFixed(1).replace('.', ',')} km` : '') : c.bairroSel ? `em ${c.bairroSel.nome}` : '';
  return (
    <p className="c-note">
      Entrega {onde}: {c.taxa === 0 ? 'grátis' : brl(c.taxa)}.
    </p>
  );
}

function Quando({ c }: { c: Cardapio }) {
  const set = (patch: any) => c.setChk((s: any) => ({ ...s, ...patch }));
  const enc = c.enc;
  // Sem o modo encomenda, o pedido é sempre para agora (e a loja fechada não aceita pedido).
  if (!c.encAtiva) return null;
  const tempo = c.chk.tipo === 'entrega' ? c.loja?.tempoEntregaMin : c.loja?.tempoRetiradaMin;
  // Antecedência em HORAS (permite o mesmo dia, mais tarde); o servidor revalida.
  const min = toLocalDT(new Date(Date.now() + (Number(enc?.antecedenciaHoras) || 0) * 3600000));
  const max = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (Number(enc?.horizonteDias) || 30));
    d.setHours(23, 59, 0, 0);
    return toLocalDT(d);
  })();
  const sinal = sinalDe(c);
  return (
    <div className="c-sec">
      <h3 className="c-h">Quando?</h3>
      <div className="c-seg">
        <button type="button" aria-pressed={!c.agendar} disabled={c.soAgendado} onClick={() => set({ quando: 'agora', agendamento: '' })}>
          <span>
            <Ic n="clock" s={16} /> O quanto antes
          </span>
          <small>{c.soAgendado ? 'fechado agora' : tempo != null ? `~${tempo} min` : 'assim que ficar pronto'}</small>
        </button>
        <button type="button" aria-pressed={c.agendar} onClick={() => set({ quando: 'agendar' })}>
          <span>
            <Ic n="clock" s={16} /> Agendar
          </span>
          <small>escolha o horário</small>
        </button>
      </div>
      {c.agendar && (
        <>
          <div className="c-f">
            <label htmlFor="lp-agenda">
              Data e horário{Number(enc?.antecedenciaHoras) > 0 && <em> (mín. {enc.antecedenciaHoras} h de antecedência)</em>}
            </label>
            <input
              id="lp-agenda"
              data-campo="agendamento"
              type="datetime-local"
              className="c-in"
              min={min}
              max={max}
              value={c.chk.agendamento}
              onChange={(e) => set({ agendamento: e.target.value })}
            />
          </div>
          {sinal && (
            <div className="c-sinal" role="note">
              <b>Esta encomenda pede sinal</b>
              <span>
                Você paga agora {brl(sinal.valor)} de sinal ({sinal.pct}% do pedido). O restante fica para a {c.chk.tipo === 'entrega' ? 'entrega' : 'retirada'}.{' '}
                {sinal.deadline
                  ? `Dá para cancelar com reembolso até ${sinal.deadline.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Depois disso, o sinal não é reembolsado e o pedido não pode ser cancelado.`
                  : 'Depois de confirmar, o sinal não é reembolsável.'}
              </span>
            </div>
          )}
          {/* Recorrência leve: repetir nos dias da semana (mig 190). */}
          <Caixa marcada={!!c.chk.recorrente} onMudar={(v) => set({ recorrente: v })}>
            Repetir toda semana
          </Caixa>
          {c.chk.recorrente && (
            <>
              <div className="m-chips">
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, i) => {
                  const on = (c.chk.recorrenciaDias ?? []).includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const dias = new Set<number>(c.chk.recorrenciaDias ?? []);
                        if (on) dias.delete(i);
                        else dias.add(i);
                        set({ recorrenciaDias: [...dias].sort() });
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="c-note">Você recebe o link do sinal de cada entrega pelo WhatsApp, alguns dias antes.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Dados ─────────────────────────

function CamposDados({ c }: { c: Cardapio }) {
  const set = (patch: any) => c.setChk((s: any) => ({ ...s, ...patch }));
  return (
    <>
      <div className="c-f">
        <label htmlFor="lp-nome">Seu nome</label>
        <input id="lp-nome" data-campo="nome" className="c-in" value={c.chk.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoComplete="name" placeholder="Como chamamos você" />
      </div>
      <div className="c-f">
        <label htmlFor="lp-tel">WhatsApp</label>
        <input id="lp-tel" data-campo="telefone" className="c-in" value={c.chk.telefone ?? ''} onChange={(e) => set({ telefone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="(21) 9 0000-0000" />
      </div>
      <p className="c-note">Usamos o WhatsApp para avisar sobre este pedido.</p>
      <PromocoesCaixa c={c} />
      {!c.isServico && c.chk.tipo === 'entrega' && (
        <div className="c-f">
          <label htmlFor="lp-tel2">
            Outro telefone <em>(opcional)</em>
          </label>
          <input id="lp-tel2" className="c-in" value={c.chk.telefone2 ?? ''} onChange={(e) => set({ telefone2: e.target.value })} inputMode="tel" placeholder="Para o entregador, se precisar" />
        </div>
      )}
    </>
  );
}

/** A caixinha de promoções: já marcada, só no primeiro pedido e só na loja que manda promoção. */
function PromocoesCaixa({ c }: { c: Cardapio }) {
  if (!c.perguntaPromocoes || !c.promoLoja) return null;
  return (
    <Caixa marcada={c.promoMarcada} onMudar={c.setPromoMarcada} className="promo">
      {c.promoLoja.frase}
      <small>{c.promoLoja.apoio}</small>
    </Caixa>
  );
}

function SecaoDados({ c }: { c: Cardapio }) {
  const [editar, setEditar] = useState(false);
  const ok = !!String(c.chk.nome ?? '').trim() && soNumeros(c.chk.telefone).length >= 10;
  // Regem Fluxo: cliente reconhecido vê os dados resumidos, com "Trocar".
  if (c.template === 'fluxo' && c.temCliente && ok && !editar) {
    return (
      <div className="c-sec">
        <div className="c-card" data-campo="nome">
          <Ic n="user" />
          <div>
            <b>Pedido de {c.chk.nome}</b>
            <small>{c.chk.telefone}</small>
          </div>
          <button type="button" className="lk" onClick={() => setEditar(true)}>
            Trocar
          </button>
        </div>
        <PromocoesCaixa c={c} />
      </div>
    );
  }
  return (
    <div className="c-sec">
      <h3 className="c-h">Seus dados</h3>
      <CamposDados c={c} />
    </div>
  );
}

function EtapaDados({ c }: { c: Cardapio }) {
  return (
    <div className="c-sec">
      <h3 className="c-h">Quem vai receber?</h3>
      <p className="c-sub">Na próxima vez a gente já preenche.</p>
      <CamposDados c={c} />
    </div>
  );
}

// ───────────────────────── Pagamento ─────────────────────────

function FormasPagamento({ c }: { c: Cardapio }) {
  const op = OPCOES_TEMPLATE[c.template];
  const set = (patch: any) => c.setChk((s: any) => ({ ...s, ...patch }));
  const formas: string[] = c.loja?.pagamentos ?? [];
  if (!formas.length) return null;
  const onde = ondePaga(c);
  const agora = formas.filter((pg) => formaInfo(pg, onde).agora);
  const depois = formas.filter((pg) => !formaInfo(pg, onde).agora);
  const opcao = (pg: string) => {
    const i = formaInfo(pg, onde, c.loja?.parcelasMax);
    return (
      <button key={pg} type="button" className="c-opt" aria-pressed={c.chk.forma === pg} onClick={() => set({ forma: pg, bandeira: '' })}>
        <span className="ico">{i.sigla ?? <Ic n={i.icone as NomeIcone} s={18} />}</span>
        <span>
          <b>
            {i.nome} {pg === 'pix' && op.pixEmDestaque && <em>Mais rápido</em>}
          </b>
          {i.apoio && <small>{i.apoio}</small>}
        </span>
        <span className="po-r" />
      </button>
    );
  };
  const bandeiras: string[] = c.loja?.formasCartao ?? [];
  return (
    <div className="c-sec">
      <h3 className="c-h">Como você vai pagar?</h3>
      <div className="c-pay" data-campo="forma">
        {agora.length > 0 && depois.length > 0 && <h4>Pague agora</h4>}
        {agora.map(opcao)}
        {agora.length > 0 && depois.length > 0 && <h4>Pague {onde}</h4>}
        {depois.map(opcao)}
      </div>
      {/* Sub-opções de cartão (formas cadastradas na config do cardápio) */}
      {c.chk.forma === 'cartao' && bandeiras.length > 0 && (
        <div className="c-f" data-campo="bandeira">
          <label>Qual cartão?</label>
          <div className="m-chips">
            {bandeiras.map((b) => (
              <button key={b} type="button" aria-pressed={c.chk.bandeira === b} onClick={() => set({ bandeira: b })}>
                {b}
              </button>
            ))}
          </div>
        </div>
      )}
      {c.chk.forma === 'entrega' && (
        <div className="c-f">
          <label htmlFor="lp-troco">
            Troco para quanto? <em>(opcional)</em>
          </label>
          <input id="lp-troco" className="c-in" value={c.chk.troco ?? ''} onChange={(e) => set({ troco: e.target.value })} inputMode="decimal" placeholder="Ex.: 100" />
        </div>
      )}
      {/* CPF na nota — só onde a loja emite cupom fiscal. Opcional: quem marca passa a ter de preencher. */}
      {c.loja?.emiteNota && (
        <>
          <Caixa marcada={!!c.chk.cupomFiscal} onMudar={(v) => set({ cupomFiscal: v, cpf: v ? c.chk.cpf : '' })}>
            CPF na nota
          </Caixa>
          {c.chk.cupomFiscal && (
            <div className="c-f">
              <label htmlFor="lp-cpf">CPF ou CNPJ</label>
              <input id="lp-cpf" data-campo="cpf" className="c-in" value={c.chk.cpf ?? ''} onChange={(e) => set({ cpf: e.target.value })} inputMode="numeric" placeholder="Só números" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "Seus benefícios": cupom, prêmio de fidelidade, cashback e o progresso do plano. */
function Beneficios({ c, semCupom }: { c: Cardapio; semCupom?: boolean }) {
  if (c.mesaDireta || c.isIndustria) return null;
  const premios: any[] = c.premios ?? [];
  const plano = (c.fidStatus?.planos ?? []).find((p: any) => p.ativo !== false) ?? (c.promosLoja?.planos ?? [])[0] ?? null;
  const temFid = !!c.loja?.fidelidadeAtiva && c.pontosPrevistos != null;
  const pctCashback = (c.cashbackInfo?.planos ?? []).map((p: any) => Number(p.percentual) || 0).find((v: number) => v > 0);
  const partes: JSX.Element[] = [];
  if (!semCupom) partes.push(<CupomBox key="cupom" c={c} />);
  if (premios.length === 1)
    partes.push(
      <Caixa key="premio" marcada={!!c.premioSel} onMudar={(v) => c.setPremioSel(v ? premios[0].id : '')}>
        Usar prêmio: {premios[0].plano} · {premios[0].recompensa}
        {c.premioDesc > 0 && <small>Desconto de {brl(c.premioDesc)} neste pedido.</small>}
      </Caixa>,
    );
  if (premios.length > 1)
    partes.push(
      <div key="premio" className="c-f">
        <label htmlFor="lp-premio">Prêmio de fidelidade</label>
        <select id="lp-premio" className="c-in" value={c.premioSel} onChange={(e) => c.setPremioSel(e.target.value)}>
          <option value="">Não usar prêmio agora</option>
          {premios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.plano} · {p.recompensa}
            </option>
          ))}
        </select>
      </div>,
    );
  if (c.cashbackSaldo > 0)
    partes.push(
      <Caixa key="cb" marcada={c.usarCashback !== false} onMudar={c.setUsarCashback}>
        Usar meu cashback · <b className="num">{brl(c.cashbackSaldo)}</b> disponível
      </Caixa>,
    );
  if (temFid) {
    const pts = c.pontosPrevistos ?? 0;
    if (plano && Number(plano.pontosMeta) > 0) {
      const meta = Number(plano.pontosMeta);
      const saldo = Number(plano.pontos) || 0;
      const novo = saldo + pts;
      const a = Math.min(100, (saldo / meta) * 100);
      const b = Math.min(100, (novo / meta) * 100);
      partes.push(
        <div key="fid" className="c-fid">
          <div className="r">
            <b>
              <Ic n="gift" s={14} /> {plano.nome}
            </b>
            <span>
              {Math.min(novo, meta)}/{meta} pts
            </span>
          </div>
          <div className="bar" aria-hidden="true">
            <i className="a" style={{ width: `${a}%` }} />
            <i className="b" style={{ left: `${a}%`, width: `${Math.max(0, b - a)}%` }} />
          </div>
          <span>
            {novo >= meta ? (
              <>
                Com este pedido você completa o plano e ganha <b>{plano.recompensa}</b>.
              </>
            ) : (
              <>
                Este pedido soma <b>{pts} pontos</b>. Faltam {meta - novo} para {String(plano.recompensa ?? 'o prêmio')}.
              </>
            )}
          </span>
        </div>,
      );
    } else {
      partes.push(
        <div key="fid" className="c-pts">
          <Ic n="gift" s={16} />
          <span>
            Este pedido soma <b>{pts} pontos</b> no programa de fidelidade.
          </span>
        </div>,
      );
    }
  }
  if (pctCashback)
    partes.push(
      <div key="cbg" className="c-cb">
        <Ic n="repeat" s={16} />
        <span>
          Este pedido rende <b>{String(pctCashback).replace('.', ',')}% de cashback</b> para o próximo.
        </span>
      </div>,
    );
  if (!partes.length) return null;
  return (
    <div className="c-sec">
      <h3 className="c-h">Seus benefícios</h3>
      {partes}
    </div>
  );
}

/** Aviso de origem do anúncio (trilha C), logo acima do botão final. */
function Origem({ c }: { c: Cardapio }) {
  if (!c.estadoOrigem) return null;
  return (
    <div className="c-origem">
      <AvisoOrigem
        estado={c.estadoOrigem}
        lojaNome={c.loja?.nome ?? 'Esta loja'}
        documento={c.loja?.documento}
        whatsapp={c.loja?.whatsapp}
        contato={c.loja?.contatoLoja}
        ferramenta={c.loja?.medeAnuncios?.ferramenta ?? null}
        accent={c.accent}
        onRecusar={c.recusarOrigemPedido}
        onDesfazer={c.desfazerRecusaOrigem}
      />
    </div>
  );
}

function EtapaPagamento({ c }: { c: Cardapio }) {
  const op = OPCOES_TEMPLATE[c.template];
  return (
    <>
      <FormasPagamento c={c} />
      <Beneficios c={c} semCupom={op.cupomNaSacola} />
      <div className="c-sec">
        <Resumo c={c} completo />
        <Origem c={c} />
      </div>
    </>
  );
}

// ───────────────────────── Revisar (pedido expresso do Regem Fluxo) ─────────────────────────

function EtapaRevisar({ c }: { c: Cardapio }) {
  const tempo = c.chk.tipo === 'entrega' ? c.loja?.tempoEntregaMin : c.loja?.tempoRetiradaMin;
  const forma = c.chk.forma ? formaInfo(c.chk.forma, ondePaga(c), c.loja?.parcelasMax) : null;
  const enc = c.enc;
  const min = toLocalDT(new Date(Date.now() + (Number(enc?.antecedenciaHoras) || 0) * 3600000));
  const sinal = sinalDe(c);
  return (
    <>
      <div className="c-sec">
        <p className="c-sub c-sub-0">Usamos os dados do seu último pedido. Confira e peça.</p>
        {c.situacao === 'so_retirada' && c.chk.tipo === 'retirada' && (
          <p className="c-note">Agora só retirada{c.proximaAbertura.entrega ? `: a entrega volta ${c.proximaAbertura.entrega.includes(' ') ? '' : 'às '}${c.proximaAbertura.entrega}` : ''}.</p>
        )}
        <div className="c-card" data-campo={c.areaRaio ? 'localizacao' : 'bairroId'}>
          <Ic n={c.chk.tipo === 'retirada' ? 'store' : 'pin'} />
          <div data-campo="rua">
            {c.chk.tipo === 'retirada' ? (
              <>
                <b>Retirar na loja</b>
                <small>{c.loja?.endereco?.texto ?? c.loja?.nome}</small>
              </>
            ) : (
              <>
                <b>{[c.chk.rua, c.chk.numero].filter(Boolean).join(', ') || 'Informe o endereço'}</b>
                <small>
                  {[c.bairroSel?.nome, c.taxaPendente ? 'entrega a calcular' : c.taxa === 0 ? 'entrega grátis' : `entrega ${brl(c.taxa)}`].filter(Boolean).join(' · ')}
                </small>
              </>
            )}
          </div>
          <button type="button" className="lk" onClick={() => c.trocarNoExpresso('entrega')}>
            Trocar
          </button>
        </div>
        <div className="c-card" data-campo="tipo">
          <Ic n="clock" />
          <div>
            <b>{c.agendar ? (c.chk.agendamento ? `Agendado para ${fmtAgenda(c.chk.agendamento)}` : 'Agendar horário') : `O quanto antes${tempo != null ? ` · ~${tempo} min` : ''}`}</b>
            <small>{c.soAgendado ? c.menu?.horarioLabel ?? 'Loja fechada agora' : 'Previsão confirmada depois do pedido'}</small>
          </div>
          {!c.soAgendado && c.encAtiva && (
            <button type="button" className="lk" onClick={() => c.trocarNoExpresso('entrega')}>
              Trocar
            </button>
          )}
        </div>
        {c.soAgendado && (
          <>
            <div className="c-f">
              <label htmlFor="lp-agenda">Agendar para</label>
              <input
                id="lp-agenda"
                data-campo="agendamento"
                type="datetime-local"
                className="c-in"
                min={min}
                value={c.chk.agendamento}
                onChange={(e) => c.setChk((s: any) => ({ ...s, agendamento: e.target.value }))}
              />
            </div>
            {sinal && (
              <div className="c-sinal" role="note">
                <b>Esta encomenda pede sinal</b>
                <span>
                  Você paga agora {brl(sinal.valor)} de sinal ({sinal.pct}% do pedido). O restante fica para a {c.chk.tipo === 'entrega' ? 'entrega' : 'retirada'}.
                </span>
              </div>
            )}
          </>
        )}
        <div className="c-card" data-campo="forma">
          {forma?.sigla ? <span className="ico-t">{forma.sigla}</span> : <Ic n="card" />}
          <div data-campo="bandeira">
            <b>{forma ? [forma.nome, c.chk.bandeira].filter(Boolean).join(' · ') : 'Escolha como pagar'}</b>
            <small>{forma ? 'Último usado' : ''}</small>
          </div>
          <button type="button" className="lk" onClick={() => c.trocarNoExpresso('pagamento')}>
            Trocar
          </button>
        </div>
        <div className="c-card" data-campo="nome">
          <Ic n="user" />
          <div data-campo="telefone">
            <b>{c.chk.nome || 'Informe seu nome'}</b>
            <small>{c.chk.telefone}</small>
          </div>
          <button type="button" className="lk" onClick={() => c.trocarNoExpresso('entrega')}>
            Trocar
          </button>
        </div>
        <PromocoesCaixa c={c} />
      </div>
      <Beneficios c={c} />
      <div className="c-sec">
        <Resumo c={c} completo />
        <Origem c={c} />
      </div>
    </>
  );
}
