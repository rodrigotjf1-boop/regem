'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Cardapio } from './use-cardapio';
import { brl, extrasDe, Foto, Ic, Logo, pctDesconto, Preco, seloDe } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

// AS QUATRO VITRINES (docs/templates-cardapio/01 a 04). Cada uma desenha o topo, as seções e a
// barra da sacola do seu jeito; os dados e as ações vêm todos do `useCardapio`.

type Secao = { id: string; nome: string; descricao: string | null; imagemRef: string | null; itens: any[] };

/** Texto do status da loja (base §5.5): aberta, só um dos tipos, ou fechada. */
function statusLoja(c: Cardapio): string {
  const rot = c.menu?.horarioLabel as string | null;
  const volta = (v?: string | null) => (v ? (v.includes(' ') ? ` a partir de ${v}` : ` a partir das ${v}`) : ' indisponível agora');
  if (c.situacao === 'so_retirada') return `Só retirada · entrega${volta(c.proximaAbertura.entrega)}`;
  if (c.situacao === 'so_entrega') return `Só entrega · retirada${volta(c.proximaAbertura.retirada)}`;
  if (c.situacao === 'fechada') return rot && rot !== 'Fechada' ? `Fechada agora · ${rot.charAt(0).toLowerCase()}${rot.slice(1)}` : 'Fechada agora';
  return rot ?? 'Aberta';
}
const classeSituacao = (c: Cardapio) => (c.situacao === 'fechada' ? 'fechada' : c.situacao === 'aberta' ? '' : 'retirada');

/** Aviso do topo da vitrine quando a loja está só com um tipo ou fechada. */
function AvisoLoja({ c }: { c: Cardapio }) {
  if (c.situacao === 'aberta' || c.isServico) return null;
  const end = c.loja?.endereco?.texto;
  let titulo = '';
  let texto = '';
  if (c.situacao === 'so_retirada') {
    titulo = 'Agora só retirada na loja';
    texto = `${c.proximaAbertura.entrega ? `A entrega volta ${c.proximaAbertura.entrega.includes(' ') ? '' : 'às '}${c.proximaAbertura.entrega}. ` : ''}${end ? `Retire em ${end}.` : ''}`;
  } else if (c.situacao === 'so_entrega') {
    titulo = 'Agora só entrega';
    texto = c.proximaAbertura.retirada ? `A retirada volta ${c.proximaAbertura.retirada.includes(' ') ? '' : 'às '}${c.proximaAbertura.retirada}.` : 'A retirada na loja está indisponível agora.';
  } else {
    titulo = 'Estamos fechados agora';
    const rot = c.menu?.horarioLabel as string | null;
    texto = c.soAgendado
      ? `${rot && rot !== 'Fechada' ? `${rot}. ` : ''}Monte seu pedido e agende o horário.`
      : rot && rot !== 'Fechada'
        ? `${rot}. Você pode ver o cardápio; os pedidos voltam quando a loja abrir.`
        : 'Você pode ver o cardápio; os pedidos voltam quando a loja abrir.';
  }
  return (
    <div className={`p-aviso ${c.situacao === 'fechada' ? 'fechada' : ''}`} role="status">
      <Ic n={c.situacao === 'fechada' ? 'clock' : 'store'} s={18} />
      <div>
        <b>{titulo}</b>
        {texto && <span>{texto}</span>}
      </div>
    </div>
  );
}

/** Seções com a de "Mais pedidos" na frente (quando a loja mostra destaques). */
function useSecoes(c: Cardapio, comMais: boolean): Secao[] {
  return useMemo(() => {
    const base = c.secoes as Secao[];
    if (!comMais || !c.showDestaques || c.destaques.length === 0) return base;
    return [{ id: '_mais', nome: 'Mais pedidos', descricao: null, imagemRef: null, itens: c.destaques }, ...base];
  }, [c.secoes, c.destaques, c.showDestaques, comMais]);
}

/** Abas que acompanham a rolagem: devolve a seção à vista e a função de ir até uma seção. */
function useAbas(rolagem: RefObject<HTMLDivElement>, abas: RefObject<HTMLElement>, secoes: Secao[]) {
  const [ativa, setAtiva] = useState(secoes[0]?.id ?? '');
  const ativaRef = useRef(ativa);
  const ids = secoes.map((s) => s.id).join('|');
  const aoRolar = useCallback(() => {
    const sc = rolagem.current;
    if (!sc) return;
    const limite = (abas.current?.getBoundingClientRect().bottom ?? sc.getBoundingClientRect().top) + 8;
    let at = '';
    sc.querySelectorAll<HTMLElement>('[data-sec]').forEach((s) => {
      if (s.getBoundingClientRect().top <= limite) at = s.dataset.sec ?? '';
    });
    if (!at) at = ids.split('|')[0] ?? '';
    if (at !== ativaRef.current) {
      ativaRef.current = at;
      setAtiva(at);
      const t = abas.current;
      const on = t?.querySelector<HTMLElement>(`[data-tab="${at}"]`);
      if (t && on) t.scrollTo({ left: on.offsetLeft - 20, behavior: 'smooth' });
    }
  }, [rolagem, abas, ids]);
  const ir = useCallback(
    (id: string) => {
      const sc = rolagem.current;
      const alvo = sc?.querySelector<HTMLElement>(`[data-sec="${id}"]`);
      if (!sc || !alvo) return;
      const folga = abas.current && getComputedStyle(abas.current).position === 'sticky' ? abas.current.offsetHeight : 0;
      const topo = alvo.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      sc.scrollTo({ top: topo - folga + 2, behavior: 'smooth' });
    },
    [rolagem, abas],
  );
  return { ativa, aoRolar, ir };
}

/** Banner com deep-link: `category:ID` rola até a seção; o resto o `useCardapio` resolve. */
function useBanner(c: Cardapio, ir: (id: string) => void) {
  return (b: any) => {
    const r = c.abrirBanner(b);
    if (r?.categoria) ir(r.categoria);
  };
}

/** Carrossel de banners (capa do Balcão, faixa da Oferta, faixa do Fluxo): passa sozinho e tem pontos. */
function Banners({ c, classe, onAbrir }: { c: Cardapio; classe: string; onAbrir: (b: any) => void }) {
  const banners: any[] = c.showBanner ? c.menu?.banners ?? [] : [];
  const [i, setI] = useState(0);
  const n = banners.length;
  useEffect(() => {
    if (n < 2) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), Math.max(1, c.bannerIntervalo) * 1000);
    return () => clearInterval(t);
  }, [n, c.bannerIntervalo]);
  if (!n) return null;
  const idx = i % n;
  return (
    <div className={`p-ban ${classe}`}>
      <div className="p-ban-t" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {banners.map((b, k) =>
          b.link || b.deepLink ? (
            <button key={k} type="button" onClick={() => onAbrir(b)} aria-label={b.titulo ?? 'Abrir banner'} tabIndex={k === idx ? 0 : -1}>
              <img src={b.imagemRef} alt={b.titulo ?? ''} loading={k === 0 ? 'eager' : 'lazy'} />
            </button>
          ) : (
            <div key={k}>
              <img src={b.imagemRef} alt={b.titulo ?? ''} loading={k === 0 ? 'eager' : 'lazy'} />
            </div>
          ),
        )}
      </div>
      {n > 1 && (
        <div className="p-ban-d">
          {banners.map((_, k) => (
            <button key={k} type="button" className={k === idx ? 'on' : ''} aria-label={`Ir para o banner ${k + 1}`} onClick={() => setI(k)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** "Peça de novo": o último pedido do cliente volta para a sacola com um toque. */
function PecaDeNovo({ c, classe, botao }: { c: Cardapio; classe: string; botao: (total: number) => ReactNode }) {
  const u = c.ultimoPedido;
  if (!c.showUltimos || !u || !(u.itens ?? []).length) return null;
  const nomes = u.itens.map((i: any) => i.nome);
  return (
    <div className={classe}>
      <div className="a">
        <Foto src={u.itens.find((i: any) => i.imagemRef)?.imagemRef} />
      </div>
      <div>
        <small>Peça de novo</small>
        <b>{nomes[0]}</b>
        {nomes.length > 1 && <span className="s">{nomes.slice(1).join(' · ')}</span>}
      </div>
      <button type="button" onClick={() => void c.reordenarUltimo()}>
        {botao(Number(u.total) || 0)}
      </button>
    </div>
  );
}

const Mesa = ({ c }: { c: Cardapio }) => (c.mesa ? <div className="p-mesa">Mesa {c.mesa}</div> : null);

/** Linha de benefícios da loja (cupom público, cashback do cliente, plano de fidelidade). */
function beneficiosDaLoja(c: Cardapio) {
  const cupom = (c.promosLoja?.cupons ?? [])[0] ?? null;
  const plano = (c.fidStatus?.planos ?? []).find((p: any) => p.ativo !== false) ?? (c.promosLoja?.planos ?? [])[0] ?? null;
  const saldoCb = Number(c.cashbackInfo?.valor) || 0;
  const pctCb = (c.cashbackInfo?.planos ?? []).map((p: any) => Number(p.percentual) || 0).find((v: number) => v > 0) ?? 0;
  const rotCupom = cupom
    ? cupom.tipo === 'fretegratis'
      ? 'frete grátis'
      : cupom.tipo === 'percentual'
        ? `${cupom.valor}% off`
        : `${brl(cupom.valor)} off`
    : '';
  return { cupom, rotCupom, plano: c.loja?.fidelidadeAtiva ? plano : null, saldoCb, pctCb, fidelidade: !!c.loja?.fidelidadeAtiva };
}

/** Meta de frete grátis no topo da vitrine (Oferta): some sem meta e quando não há entrega. */
function BarraFreteVitrine({ c }: { c: Cardapio }) {
  if (c.freteGratisAcima == null || c.isServico || !c.habEntrega || !c.dispEntrega) return null;
  const falta = Math.max(0, c.freteGratisAcima - c.total);
  return (
    <div className="o-frete">
      {falta > 0 ? (
        <span>
          <Ic n="moto" s={14} /> <b>Frete grátis</b> acima de {brl(c.freteGratisAcima)}
          {c.qtdItens > 0 && (
            <>
              {' '}
              · faltam <b>{brl(falta)}</b>
            </>
          )}
        </span>
      ) : (
        <span>
          <b>Você ganhou frete grátis!</b>
        </span>
      )}
      <div className="bar">
        <i style={{ width: `${Math.min(100, (c.total / c.freteGratisAcima) * 100)}%` }} />
      </div>
    </div>
  );
}

// ═══════════════════════════ GALERIA ═══════════════════════════

export function VitrineGaleria({ c }: { c: Cardapio }) {
  const rolagem = useRef<HTMLDivElement>(null);
  const abas = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const secoes = useSecoes(c, true);
  const { ir } = useAbas(rolagem, abas, secoes);
  const abrirBanner = useBanner(c, ir);
  const ben = beneficiosDaLoja(c);

  // Hero: os banners da loja (legenda do produto do link); sem banner, os destaques com foto.
  const slides = useMemo(() => {
    const banners: any[] = c.showBanner ? c.menu?.banners ?? [] : [];
    if (banners.length) {
      return banners.map((b) => {
        const p = c.produtoDoBanner(b);
        return { img: b.imagemRef, k: p ? seloDe(p) : null, t: b.titulo || p?.nome || '', s: p ? brl(p.precoVenda) : '', acao: () => abrirBanner(b), toque: !!(b.link || b.deepLink) };
      });
    }
    if (!c.showDestaques) return [];
    return c.destaques
      .filter((p: any) => p.imagemRef)
      .slice(0, 3)
      .map((p: any) => ({ img: p.imagemRef, k: seloDe(p), t: p.nome, s: brl(p.precoVenda), acao: () => c.abrirProduto(p), toque: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.menu, c.destaques, c.showBanner, c.showDestaques]);
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const el = hero.current;
    if (!el || slides.length < 2) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => {
      const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
      if (!w) return;
      const i = Math.round(el.scrollLeft / (w + 10));
      el.scrollTo({ left: ((i + 1) % slides.length) * (w + 10), behavior: 'smooth' });
    }, Math.max(2, c.bannerIntervalo) * 1000);
    return () => clearInterval(t);
  }, [slides.length, c.bannerIntervalo]);

  const fotoCat = (s: Secao) => s.imagemRef ?? s.itens.find((p) => p.imagemRef)?.imagemRef ?? null;
  const mais = (p: any) =>
    !p.esgotado && (
      <span
        className="g-plus"
        role="button"
        tabIndex={0}
        aria-label={c.precisaEscolha(p) ? `Montar ${p.nome}` : `Pôr ${p.nome} na sacola`}
        onClick={(e) => {
          e.stopPropagation();
          c.adicionarRapido(p);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            c.adicionarRapido(p);
          }
        }}
      >
        <Ic n="plus" s={18} />
      </span>
    );

  return (
    <div className="p-scroll" ref={rolagem}>
      <header className="g-top">
        <div className="g-logo">
          <Logo loja={c.loja} />
        </div>
        <button type="button" className="g-id" onClick={() => c.abrir('info')} aria-label="Informações da loja">
          <b>{c.loja?.nome}</b>
          <span>
            <i className={`dot ${classeSituacao(c)}`} />
            {statusLoja(c)}
          </span>
        </button>
        <button type="button" className="g-ic" onClick={() => c.abrir('conta')} aria-label="Sua conta">
          <Ic n="user" />
        </button>
        <button type="button" className="g-ic" onClick={() => c.abrir('busca')} aria-label="Buscar">
          <Ic n="search" />
        </button>
      </header>
      <Mesa c={c} />
      <AvisoLoja c={c} />
      {slides.length > 0 && (
        <>
          <div
            className="hs g-hero"
            ref={hero}
            onScroll={(e) => {
              const el = e.currentTarget;
              const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1;
              setSlide(Math.round(el.scrollLeft / (w + 10)));
            }}
          >
            {slides.map((h, i) => (
              <button key={i} type="button" className="g-slide" onClick={h.acao} disabled={!h.toque}>
                <img src={h.img} alt={h.t} loading={i === 0 ? 'eager' : 'lazy'} />
                {(h.t || h.s) && (
                  <div className="g-cap">
                    {h.k && <small>{h.k}</small>}
                    {h.t && <b>{h.t}</b>}
                    {h.s && <span>{h.s}</span>}
                  </div>
                )}
              </button>
            ))}
          </div>
          {slides.length > 1 && (
            <div className="g-dots" aria-hidden="true">
              {slides.map((_, i) => (
                <i key={i} className={i === slide ? 'on' : ''} />
              ))}
            </div>
          )}
        </>
      )}
      {ben.cupom && (
        <div className="g-fid">
          <Ic n="tag" s={18} />
          <span>
            Cupom {ben.cupom.codigo}: {ben.rotCupom}
          </span>
        </div>
      )}
      {ben.fidelidade && (
        <div className="g-fid">
          <Ic n="gift" s={18} />
          <span>{ben.plano ? `${ben.plano.nome}: ${ben.plano.pontosMeta} pontos valem ${ben.plano.recompensa}` : 'Programa de fidelidade: cada pedido soma pontos'}</span>
          {ben.plano?.pontos != null && <b>{ben.plano.pontos} pts</b>}
        </div>
      )}
      {(ben.saldoCb > 0 || ben.pctCb > 0) && (
        <div className="g-fid cb">
          <Ic n="repeat" s={18} />
          <span>{ben.pctCb > 0 ? `${String(ben.pctCb).replace('.', ',')}% de volta em cashback` : 'Seu saldo de cashback'}</span>
          {ben.saldoCb > 0 && <b>{brl(ben.saldoCb)}</b>}
        </div>
      )}
      <PecaDeNovo c={c} classe="g-re" botao={(t) => (t > 0 ? brl(t) : 'Adicionar')} />
      {secoes.length > 1 && (
        <div className="hs g-cats" ref={abas}>
          {secoes.map((s) => (
            <button key={s.id} type="button" className="g-cat" onClick={() => ir(s.id)}>
              <span>{fotoCat(s) ? <img src={fotoCat(s) as string} alt="" loading="lazy" /> : <em>{s.nome.slice(0, 1).toUpperCase()}</em>}</span>
              {s.nome}
            </button>
          ))}
        </div>
      )}
      {secoes.map((s) =>
        s.id === '_mais' ? (
          <section key={s.id} className="g-sec" data-sec={s.id}>
            <h2>{s.nome}</h2>
            <div className="hs g-car">
              {s.itens.map((p) => (
                <button key={p.id} type="button" className="g-big" onClick={() => c.abrirProduto(p)}>
                  <div className="g-art">
                    <Foto src={p.imagemRef} alt={p.nome} />
                    {seloDe(p) && <span className="g-tag">{seloDe(p)}</span>}
                    {mais(p)}
                  </div>
                  <b>{p.nome}</b>
                  {p.descricao && <p>{p.descricao}</p>}
                  <span className="g-pr">
                    <Preco p={p} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section key={s.id} className="g-sec" data-sec={s.id}>
            <h2>{s.nome}</h2>
            {s.descricao && <p className="p-sec-d">{s.descricao}</p>}
            <div className="g-grid">
              {s.itens.map((p) => (
                <button key={p.id} type="button" className="g-card" disabled={p.esgotado} onClick={() => c.abrirProduto(p)}>
                  <div className="g-art">
                    <Foto src={p.imagemRef} alt={p.nome} />
                    {pctDesconto(p) > 0 ? <span className="g-tag">-{pctDesconto(p)}%</span> : seloDe(p) && <span className="g-tag">{seloDe(p)}</span>}
                    {mais(p)}
                  </div>
                  <b>{p.nome}</b>
                  <span className="g-pr">
                    <Preco p={p} />
                  </span>
                  {extrasDe(p, c.loja) && <small className="p-ext">{extrasDe(p, c.loja)}</small>}
                </button>
              ))}
            </div>
          </section>
        ),
      )}
      <div className="p-spacer" />
    </div>
  );
}

export function BarraGaleria({ c }: { c: Cardapio }) {
  return (
    <button type="button" key={c.pulo} className={`g-bar ${c.pulo ? 'bump' : ''}`} onClick={c.abrirSacola}>
      <span className="c">{c.qtdItens}</span>
      <span>Ver sacola</span>
      <b>{brl(c.total)}</b>
    </button>
  );
}

// ═══════════════════════════ BALCÃO ═══════════════════════════

export function VitrineBalcao({ c }: { c: Cardapio }) {
  const rolagem = useRef<HTMLDivElement>(null);
  const abas = useRef<HTMLElement>(null);
  const secoes = useSecoes(c, true);
  const { ativa, aoRolar, ir } = useAbas(rolagem, abas, secoes);
  const abrirBanner = useBanner(c, ir);
  const q = c.busca.trim();
  const linha = (p: any) => (
    <button key={p.id} type="button" className="b-row" disabled={p.esgotado} onClick={() => c.abrirProduto(p)}>
      <div>
        {seloDe(p) && <span className="b-sel">{seloDe(p)}</span>}
        <b>{p.nome}</b>
        {p.descricao && <p>{p.descricao}</p>}
        <span className="b-pr">
          {p.esgotado ? (
            'Esgotado'
          ) : (
            <>
              {p.precoDe != null && <s>{brl(p.precoDe)}</s>}
              {brl(p.precoVenda)}
              {pctDesconto(p) > 0 && <span className="pct">-{pctDesconto(p)}%</span>}
            </>
          )}
        </span>
        {extrasDe(p, c.loja) && <small className="p-ext">{extrasDe(p, c.loja)}</small>}
      </div>
      <div className="b-th">
        <Foto src={p.imagemRef} alt={p.nome} />
      </div>
    </button>
  );
  const temBanner = c.showBanner && (c.menu?.banners ?? []).length > 0;
  return (
    <div className="p-scroll" ref={rolagem} onScroll={aoRolar}>
      <div className={`b-cover ${temBanner ? '' : 'lisa'}`}>
        <Banners c={c} classe="na-capa" onAbrir={abrirBanner} />
        <button type="button" className="ac-fab" onClick={() => c.abrir('conta')} aria-label="Sua conta">
          <Ic n="user" s={19} />
        </button>
      </div>
      <div className="b-head">
        <div className="b-logo">
          <Logo loja={c.loja} />
        </div>
        <button type="button" className="b-mais" onClick={() => c.abrir('info')}>
          Ver informações
        </button>
        <h1>{c.loja?.nome}</h1>
        <span className={`b-st ${classeSituacao(c)}`}>
          <i className={`dot ${classeSituacao(c)}`} />
          {statusLoja(c)}
        </span>
        <div className="b-inf">
          {c.loja?.tempoEntregaMin != null && c.habEntrega && (
            <span>
              <Ic n="clock" s={14} /> ~{c.loja.tempoEntregaMin} min
            </span>
          )}
          {c.loja?.pedidoMinimo != null && (
            <span>
              <Ic n="bag" s={14} /> Mínimo {brl(c.loja.pedidoMinimo)}
            </span>
          )}
          {c.freteGratisAcima != null && c.habEntrega && (
            <span>
              <Ic n="moto" s={14} /> Grátis acima de {brl(c.freteGratisAcima)}
            </span>
          )}
          {c.loja?.fidelidadeAtiva && (
            <span>
              <Ic n="gift" s={14} /> Fidelidade
            </span>
          )}
        </div>
      </div>
      <Mesa c={c} />
      <AvisoLoja c={c} />
      <div className="b-search">
        <label>
          <Ic n="search" s={18} />
          <input value={c.busca} onChange={(e) => c.setBusca(e.target.value)} placeholder="Buscar no cardápio" aria-label="Buscar no cardápio" />
        </label>
      </div>
      {q ? (
        <section className="b-sec">
          <h2>
            {c.resultadosBusca.length} resultado{c.resultadosBusca.length === 1 ? '' : 's'}
          </h2>
          <div className="b-list">{c.resultadosBusca.map(linha)}</div>
        </section>
      ) : (
        <>
          <PecaDeNovo c={c} classe="f-re b-re" botao={() => 'Adicionar'} />
          {secoes.length > 1 && (
            <nav className="hs b-tabs" ref={abas} aria-label="Categorias">
              {secoes.map((s) => (
                <button key={s.id} type="button" data-tab={s.id} className={ativa === s.id ? 'on' : ''} onClick={() => ir(s.id)}>
                  {s.nome}
                </button>
              ))}
            </nav>
          )}
          {secoes.map((s) => (
            <section key={s.id} className="b-sec" data-sec={s.id}>
              <h2>{s.nome}</h2>
              {s.descricao && <p className="p-sec-d">{s.descricao}</p>}
              <div className="b-list">{s.itens.map(linha)}</div>
            </section>
          ))}
        </>
      )}
      <div className="p-spacer" />
    </div>
  );
}

export function BarraBalcao({ c }: { c: Cardapio }) {
  return (
    <div className="b-bar">
      <button type="button" key={c.pulo} className={c.pulo ? 'bump' : ''} onClick={c.abrirSacola}>
        <span className="c">
          {c.qtdItens} {c.qtdItens === 1 ? 'item' : 'itens'}
        </span>
        <span>Ver sacola</span>
        <span>{brl(c.total)}</span>
      </button>
    </div>
  );
}

// ═══════════════════════════ OFERTA ═══════════════════════════

export function VitrineOferta({ c }: { c: Cardapio }) {
  const rolagem = useRef<HTMLDivElement>(null);
  const abas = useRef<HTMLElement>(null);
  const secoes = useSecoes(c, true);
  const { ativa, aoRolar, ir } = useAbas(rolagem, abas, secoes);
  const abrirBanner = useBanner(c, ir);
  const promos: any[] = c.produtosPromo;
  const maior = promos.reduce((m, p) => Math.max(m, pctDesconto(p)), 0);
  const temBanner = c.showBanner && (c.menu?.banners ?? []).length > 0;
  const cartao = (p: any) => (
    <button key={p.id} type="button" className="o-card" disabled={p.esgotado} onClick={() => c.abrirProduto(p)}>
      <div>
        {seloDe(p) && <span className={`o-rib ${p.destaque && !(p.selos ?? []).length ? '' : 'hot'}`}>{String(seloDe(p)).toUpperCase()}</span>}
        <b>{p.nome}</b>
        {p.descricao && <p>{p.descricao}</p>}
        <span className="o-dp">
          {p.esgotado ? (
            <s>Esgotado</s>
          ) : (
            <>
              {p.precoDe != null && <s>{brl(p.precoDe)}</s>}
              <b>{brl(p.precoVenda)}</b>
            </>
          )}
        </span>
        {extrasDe(p, c.loja) && <small className="p-ext">{extrasDe(p, c.loja)}</small>}
      </div>
      <div className="a">
        <Foto src={p.imagemRef} alt={p.nome} />
        {pctDesconto(p) > 0 && <span className="o-off">-{pctDesconto(p)}%</span>}
      </div>
    </button>
  );
  return (
    <div className="p-scroll" ref={rolagem} onScroll={aoRolar}>
      <div className={`o-band ${temBanner ? '' : 'lisa'}`}>
        <Banners c={c} classe="na-capa" onAbrir={abrirBanner} />
        <button type="button" className="ac-fab" onClick={() => c.abrir('conta')} aria-label="Sua conta">
          <Ic n="user" s={19} />
        </button>
        <button type="button" className="ac-fab dir" onClick={() => c.abrir('busca')} aria-label="Buscar">
          <Ic n="search" s={19} />
        </button>
      </div>
      <div className="o-head">
        <div className="o-logo">
          <Logo loja={c.loja} />
        </div>
        <h1>
          <button type="button" onClick={() => c.abrir('info')} aria-label="Informações da loja">
            {c.loja?.nome}
          </button>
        </h1>
        <div className="o-chips">
          <span className={`ab ${classeSituacao(c)}`}>
            <i className={`dot ${classeSituacao(c)}`} />
            {statusLoja(c)}
          </span>
          {c.loja?.tempoEntregaMin != null && c.habEntrega && (
            <span>
              <Ic n="clock" s={13} /> {c.loja.tempoEntregaMin} min
            </span>
          )}
          {c.loja?.pedidoMinimo != null && <span>Mínimo {brl(c.loja.pedidoMinimo)}</span>}
          {c.loja?.fidelidadeAtiva && (
            <span>
              <Ic n="gift" s={13} /> Fidelidade
            </span>
          )}
        </div>
      </div>
      <Mesa c={c} />
      <AvisoLoja c={c} />
      <BarraFreteVitrine c={c} />
      <PecaDeNovo c={c} classe="f-re o-re" botao={() => 'Adicionar'} />
      {promos.length > 0 && (
        <section className="o-sec">
          <h2>
            Promoções de hoje {maior > 0 && <em>-{maior}%</em>}
          </h2>
          <small>Preço especial enquanto a oferta estiver no ar</small>
          <div className="hs o-pro">
            {promos.map((p) => (
              <button key={p.id} type="button" className="o-pc" onClick={() => c.abrirProduto(p)}>
                <div className="a">
                  <Foto src={p.imagemRef} alt={p.nome} />
                  {pctDesconto(p) > 0 && <span className="o-off">-{pctDesconto(p)}%</span>}
                </div>
                <div className="t">
                  <b>{p.nome}</b>
                  <span className="o-dp">
                    {p.precoDe != null && <s>{brl(p.precoDe)}</s>}
                    <b>{brl(p.precoVenda)}</b>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {secoes.length > 1 && (
        <nav className="hs o-pills" ref={abas} aria-label="Categorias">
          {secoes.map((s) => (
            <button key={s.id} type="button" data-tab={s.id} className={ativa === s.id ? 'on' : ''} onClick={() => ir(s.id)}>
              {s.nome}
            </button>
          ))}
        </nav>
      )}
      {secoes.map((s) => (
        <section key={s.id} className="o-sec o-sec-l" data-sec={s.id}>
          <h2>{s.nome}</h2>
          <small>{s.descricao ?? ''}</small>
          <div className="o-list">{s.itens.map(cartao)}</div>
        </section>
      ))}
      <div className="p-spacer p-spacer-g" />
    </div>
  );
}

export function BarraOferta({ c }: { c: Cardapio }) {
  const entrega = !c.isServico && c.chk.tipo === 'entrega' && c.dispEntrega;
  const falta = c.freteGratisAcima != null ? Math.max(0, c.freteGratisAcima - c.total) : null;
  return (
    <div className="o-bar">
      {!c.mesaDireta && (
        <small>
          {!entrega ? (
            'Retirada na loja · grátis'
          ) : falta == null ? (
            'Entrega calculada na próxima etapa'
          ) : falta > 0 ? (
            <>
              Faltam <b>{brl(falta)}</b> para o frete grátis
            </>
          ) : (
            <>
              <b>Frete grátis</b> garantido
            </>
          )}
        </small>
      )}
      <button type="button" key={c.pulo} className={c.pulo ? 'bump' : ''} onClick={c.abrirSacola}>
        <span className="c">{c.qtdItens}</span>
        <span>Ver sacola</span>
        <span>{brl(c.total)}</span>
      </button>
    </div>
  );
}

// ═══════════════════════════ REGEM FLUXO ═══════════════════════════

export function VitrineFluxo({ c }: { c: Cardapio }) {
  const rolagem = useRef<HTMLDivElement>(null);
  const abas = useRef<HTMLElement>(null);
  const secoes = useSecoes(c, false);
  const { ativa, aoRolar, ir } = useAbas(rolagem, abas, secoes);
  const abrirBanner = useBanner(c, ir);
  const ben = beneficiosDaLoja(c);
  const entrega = c.chk.tipo === 'entrega' && c.dispEntrega;
  const destaques: any[] = c.showDestaques ? c.destaques : [];
  const resumo = [
    statusLoja(c),
    c.situacao === 'aberta' && c.loja?.tempoEntregaMin != null && c.habEntrega ? `~${c.loja.tempoEntregaMin} min` : '',
    c.loja?.pedidoMinimo != null ? `mínimo ${brl(c.loja.pedidoMinimo)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="p-scroll" ref={rolagem} onScroll={aoRolar}>
      <header className="f-top">
        <button type="button" className="f-tit" onClick={() => c.abrir('info')} aria-label="Informações da loja">
          <h1>{c.loja?.nome}</h1>
          <p>
            <i className={`dot ${classeSituacao(c)}`} />
            {resumo}
          </p>
        </button>
        <button type="button" className="f-ic" onClick={() => c.abrir('conta')} aria-label="Sua conta">
          <Ic n="user" s={19} />
        </button>
        <button type="button" className="f-ic" onClick={() => c.abrir('busca')} aria-label="Buscar">
          <Ic n="search" s={19} />
        </button>
      </header>
      <Mesa c={c} />
      <AvisoLoja c={c} />
      {!c.isServico && !c.mesaDireta && (
        <div className="hs f-strip">
          {c.habEntrega && c.dispEntrega ? (
            <button type="button" className="f-loc" onClick={() => c.abrir('local')} aria-haspopup="dialog">
              <Ic n={c.chk.tipo === 'retirada' ? 'store' : 'pin'} s={13} />{' '}
              {c.chk.tipo === 'retirada'
                ? 'Retirar na loja'
                : c.areaRaio
                  ? c.km != null
                    ? `Entregar a ${c.km.toFixed(1).replace('.', ',')} km`
                    : 'Entregar em: informe onde'
                  : c.bairroSel
                    ? `Entregar em ${c.bairroSel.nome}`
                    : 'Entregar em: escolha o bairro'}{' '}
              <Ic n="down" s={13} />
            </button>
          ) : (
            c.habRetirada && (
              <span>
                <Ic n="store" s={13} /> Retirada na loja
              </span>
            )
          )}
          {entrega && (c.freteGratisAcima != null || !c.taxaPendente) && (
            <span>
              <Ic n="moto" s={13} />{' '}
              {[
                !c.taxaPendente ? (c.taxa === 0 ? 'Entrega grátis' : `Entrega ${brl(c.taxa)}`) : '',
                c.freteGratisAcima != null && !(c.taxa === 0 && !c.taxaPendente) ? `grátis acima de ${brl(c.freteGratisAcima)}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          {ben.cupom && (
            <span className="cup">
              <Ic n="tag" s={13} /> {ben.cupom.codigo} · {ben.rotCupom}
            </span>
          )}
          {(ben.saldoCb > 0 || ben.pctCb > 0) && (
            <span className="cb">
              <Ic n="repeat" s={13} /> {ben.saldoCb > 0 ? `${brl(ben.saldoCb)} de cashback` : `${String(ben.pctCb).replace('.', ',')}% de volta`}
            </span>
          )}
          {ben.fidelidade && (
            <span className="g">
              <Ic n="gift" s={13} />{' '}
              {ben.plano ? (ben.plano.pontos != null ? `${ben.plano.pontos}/${ben.plano.pontosMeta} pts` : `${ben.plano.pontosMeta} pts = ${ben.plano.recompensa}`) : 'Fidelidade: some pontos'}
            </span>
          )}
        </div>
      )}
      <Banners c={c} classe="solta" onAbrir={abrirBanner} />
      <PecaDeNovo c={c} classe="f-re" botao={() => 'Adicionar'} />
      {destaques.length > 0 && (
        <section className="f-sec">
          <h2>Mais pedidos</h2>
          <div className="hs f-hi">
            {destaques.map((p) => (
              <button key={p.id} type="button" className="f-hc" onClick={() => c.abrirProduto(p)}>
                <div className="a">
                  <Foto src={p.imagemRef} alt={p.nome} />
                </div>
                <b>{p.nome}</b>
                <span className="pr">{brl(p.precoVenda)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {secoes.length > 1 && (
        <nav className="hs f-tabs" ref={abas} aria-label="Categorias">
          {secoes.map((s) => (
            <button key={s.id} type="button" data-tab={s.id} className={ativa === s.id ? 'on' : ''} onClick={() => ir(s.id)}>
              {s.nome}
            </button>
          ))}
        </nav>
      )}
      {secoes.map((s) => (
        <section key={s.id} className="f-sec" data-sec={s.id}>
          <h2>
            {s.nome} <small>{s.itens.length}</small>
          </h2>
          {s.descricao && <p className="p-sec-d">{s.descricao}</p>}
          {s.itens.map((p) => (
            <div key={p.id} className={`f-row ${p.esgotado ? 'off' : ''}`}>
              <button type="button" className="a" onClick={() => c.abrirProduto(p)} aria-label={p.nome} tabIndex={-1} disabled={p.esgotado}>
                <Foto src={p.imagemRef} />
              </button>
              <button type="button" className="t" onClick={() => c.abrirProduto(p)} disabled={p.esgotado}>
                {seloDe(p) && <span className={`f-sel ${seloDe(p) === 'Mais pedido' ? 'hot' : ''}`}>{seloDe(p)}</span>}
                <b>{p.nome}</b>
                {p.descricao && <p>{p.descricao}</p>}
                <span className="f-pr">{p.esgotado ? 'Esgotado' : <Preco p={p} />}</span>
                {extrasDe(p, c.loja) && <small className="p-ext">{extrasDe(p, c.loja)}</small>}
              </button>
              {p.esgotado ? (
                <span />
              ) : c.precisaEscolha(p) ? (
                <button type="button" className="f-mon" onClick={() => c.abrirProduto(p)}>
                  Montar <Ic n="chev" s={14} />
                </button>
              ) : (
                <button type="button" className="f-add" onClick={() => c.adicionarRapido(p)} aria-label={`Pôr ${p.nome} na sacola`}>
                  <Ic n="plus" s={18} />
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
      <div className="p-spacer p-spacer-m" />
    </div>
  );
}

export function BarraFluxo({ c }: { c: Cardapio }) {
  const entrega = !c.isServico && !c.mesaDireta && c.chk.tipo === 'entrega' && c.dispEntrega;
  const falta = c.freteGratisAcima != null ? Math.max(0, c.freteGratisAcima - c.total) : null;
  const pct = c.freteGratisAcima != null ? Math.min(100, (c.total / c.freteGratisAcima) * 100) : 0;
  const info = c.mesaDireta
    ? `mesa ${c.mesa}`
    : c.isServico
      ? 'agendamento'
      : !entrega
        ? 'retirada na loja · grátis'
        : falta != null && falta <= 0
          ? 'frete grátis garantido'
          : [!c.taxaPendente ? (c.taxa === 0 ? 'entrega grátis' : `entrega ${brl(c.taxa)}`) : '', falta != null ? `faltam ${brl(falta)} p/ ${c.taxaPendente ? 'frete ' : ''}grátis` : c.taxaPendente ? 'entrega a calcular' : '']
              .filter(Boolean)
              .join(' · ');
  return (
    <div key={c.pulo} className={`f-bar ${c.pulo ? 'bump' : ''}`}>
      {entrega && c.freteGratisAcima != null && (
        <div className="pg">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="r">
        <div>
          <b>{brl(c.total)}</b>
          <small>
            {c.qtdItens} {c.qtdItens === 1 ? 'item' : 'itens'} · {info}
          </small>
        </div>
        <button type="button" onClick={c.abrirSacola}>
          Ver sacola <Ic n="chev" s={16} />
        </button>
      </div>
    </div>
  );
}
