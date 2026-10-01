'use client';

import { useEffect, useRef, useState } from 'react';
import { localizacaoAtual } from '@/lib/geo';
import type { Cardapio } from './use-cardapio';
import { brl, Foto, Ic, type NomeIcone } from './partes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Folhas comuns aos quatro templates: busca, informações da loja e "Onde você está?".

/** Busca: filtra os produtos já carregados (sem chamada nova). Vazia, mostra os mais pedidos. */
export function Busca({ c }: { c: Cardapio }) {
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campo.current?.focus({ preventScroll: true });
  }, []);
  const q = c.busca.trim();
  const lista: any[] = q ? c.resultadosBusca : c.destaques;
  function fechar() {
    c.setBusca('');
    c.voltar();
  }
  return (
    <div className="p-panel" role="dialog" aria-label="Buscar no cardápio">
      <div className="p-bus">
        <button type="button" className="ch-b" onClick={fechar} aria-label="Fechar busca">
          <Ic n="back" />
        </button>
        <input ref={campo} className="c-in" value={c.busca} onChange={(e) => c.setBusca(e.target.value)} placeholder="Buscar no cardápio" aria-label="Buscar no cardápio" />
      </div>
      <div className="p-pbody">
        <div className="p-res">
          {!q && lista.length > 0 && <p className="c-note c-pad">Mais pedidos</p>}
          {lista.map((p) => (
            <button key={p.id} type="button" disabled={p.esgotado} onClick={() => c.abrirProduto(p)}>
              <span className="a">
                <Foto src={p.imagemRef} />
              </span>
              <span>
                <b>{p.nome}</b>
                <small>{p.esgotado ? 'Esgotado' : brl(p.precoVenda)}</small>
              </span>
              <Ic n="chev" s={18} />
            </button>
          ))}
          {q && lista.length === 0 && <p className="c-note c-pad">Nada encontrado para “{c.busca}”.</p>}
          {!q && lista.length === 0 && <p className="c-note c-pad">Digite o nome do produto.</p>}
        </div>
      </div>
    </div>
  );
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const NOME_FORMA: Record<string, string> = { pix: 'Pix', cartao: 'Cartão online', entrega: 'Dinheiro ou maquininha na entrega', vr: 'Vale-refeição' };

/** Informações da loja: endereço, horários, formas de pagamento e contatos (05 §2.6). */
export function InfoLoja({ c }: { c: Cardapio }) {
  const loja = c.loja ?? {};
  const horarios: any[] = (c.menu?.horarios ?? []).filter((h: any) => h.ativo && h.abre && h.fecha);
  const porDia = DIAS.map((nome, d) => ({ nome, janelas: horarios.filter((h) => Number(h.dia) === d).map((h) => `${h.abre} às ${h.fecha}`) })).filter((x) => x.janelas.length);
  const formas: string[] = loja.pagamentos ?? [];
  const zap = String(loja.whatsapp ?? '').replace(/\D/g, '');
  const insta = String(loja.instagram ?? '').trim().replace(/^@/, '');
  const site = String(loja.site ?? '').trim();
  return (
    <>
      <div className="p-dim" onClick={c.voltar} />
      <div className="p-modal" role="dialog" aria-label="Informações da loja">
        <h3>{loja.nome}</h3>
        {loja.subtitulo && <p>{loja.subtitulo}</p>}
        {loja.endereco?.texto && (
          <div className="c-card">
            <Ic n="pin" />
            <div>
              <b>Endereço</b>
              <small>{loja.endereco.texto}</small>
            </div>
          </div>
        )}
        <div className="c-card">
          <Ic n="clock" />
          <div>
            <b>Horário{c.menu?.horarioLabel ? ` · ${c.menu.horarioLabel}` : ''}</b>
            {porDia.length ? (
              porDia.map((d) => (
                <small key={d.nome} className="blk">
                  {d.nome}: {d.janelas.join(' e ')}
                </small>
              ))
            ) : (
              <small>{loja.aberto === false ? 'Loja fechada no momento' : 'Sem horário fixo cadastrado'}</small>
            )}
          </div>
        </div>
        {formas.length > 0 && (
          <div className="c-card">
            <Ic n="card" />
            <div>
              <b>Formas de pagamento</b>
              <small>{formas.map((f) => NOME_FORMA[f] ?? f).join(', ')}</small>
            </div>
          </div>
        )}
        {(loja.pedidoMinimo != null || c.freteGratisAcima != null) && (
          <div className="c-card">
            <Ic n="bag" />
            <div>
              <b>Pedidos</b>
              <small>
                {[loja.pedidoMinimo != null ? `Pedido mínimo ${brl(loja.pedidoMinimo)}` : '', c.freteGratisAcima != null ? `frete grátis acima de ${brl(c.freteGratisAcima)}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </div>
          </div>
        )}
        {zap && (
          <a className="p-btn2" href={`https://wa.me/${zap}`} target="_blank" rel="noopener noreferrer">
            <Ic n="chat" s={18} /> WhatsApp da loja
          </a>
        )}
        {(insta || site) && (
          <p className="ok-wa">
            {insta && (
              <a href={`https://instagram.com/${insta}`} target="_blank" rel="noopener noreferrer">
                Instagram @{insta}
              </a>
            )}
            {insta && site && ' · '}
            {site && (
              <a href={/^https?:\/\//.test(site) ? site : `https://${site}`} target="_blank" rel="noopener noreferrer">
                {site.replace(/^https?:\/\//, '')}
              </a>
            )}
          </p>
        )}
        <div className="ac-row">
          <b>Aparência</b>
          <button type="button" className="lk-b" onClick={c.alternarTema} aria-label={c.dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}>
            <Ic n={c.dark ? 'sun' : 'moon'} s={16} /> {c.dark ? 'Usar tema claro' : 'Usar tema escuro'}
          </button>
        </div>
        <button type="button" className="p-btn2" onClick={c.voltar}>
          Fechar
        </button>
      </div>
    </>
  );
}

/** "Onde você está?" (Regem Fluxo): o bairro (ou a localização) e a taxa antes do primeiro item. */
export function OndeVoceEsta({ c }: { c: Cardapio }) {
  const [geo, setGeo] = useState('');
  const set = (patch: any) => c.setChk((s: any) => ({ ...s, ...patch }));
  const opcao = (chave: string, icone: NomeIcone, nome: string, apoio: string, marcada: boolean, acao: () => void) => (
    <button key={chave} type="button" className="c-opt" aria-pressed={marcada} onClick={acao}>
      <span className="ico">
        <Ic n={icone} s={18} />
      </span>
      <span>
        <b>{nome}</b>
        {apoio && <small>{apoio}</small>}
      </span>
      <span className="po-r" />
    </button>
  );
  async function localizar() {
    setGeo('Obtendo localização…');
    try {
      const p = await localizacaoAtual();
      set({ tipo: 'entrega', lat: p.lat, lng: p.lng });
      c.avisar('Localização definida');
      c.voltar();
    } catch (e) {
      setGeo(e instanceof Error ? e.message : 'Não foi possível obter a localização.');
    }
  }
  const meta = c.freteGratisAcima;
  return (
    <>
      <div className="p-dim" onClick={c.voltar} />
      <div className="p-modal" role="dialog" aria-label="Onde você está">
        <h3>Onde você está?</h3>
        <p>A taxa de entrega já aparece no cardápio e na sacola.</p>
        <div className="c-pay">
          {c.dispEntrega && c.areaRaio && (
            <>
              {opcao('gps', 'pin', 'Usar minha localização', c.km != null ? `Você está a ${c.km.toFixed(1).replace('.', ',')} km da loja` : 'O frete é calculado pela distância', c.chk.tipo === 'entrega' && c.km != null, () => void localizar())}
              {geo && (
                <p className="c-note" role="status">
                  {geo}
                </p>
              )}
            </>
          )}
          {c.dispEntrega &&
            !c.areaRaio &&
            c.bairros.map((b: any) =>
              opcao(
                b.id,
                'pin',
                b.nome,
                (meta != null && c.total >= meta) || Number(b.taxa) === 0 ? 'Entrega grátis' : `Entrega ${brl(Number(b.taxa))}${meta != null ? ` · grátis acima de ${brl(meta)}` : ''}`,
                c.chk.tipo === 'entrega' && c.chk.bairroId === b.id,
                () => {
                  set({ tipo: 'entrega', bairroId: b.id });
                  c.avisar(`Entrega em ${b.nome}`);
                  c.voltar();
                },
              ),
            )}
          {c.dispRetirada &&
            opcao('retirada', 'store', 'Vou retirar na loja', [c.loja?.endereco?.texto, 'grátis'].filter(Boolean).join(' · '), c.chk.tipo === 'retirada', () => {
              set({ tipo: 'retirada' });
              c.avisar('Retirada na loja');
              c.voltar();
            })}
        </div>
        {c.dispEntrega && !c.areaRaio && (
          <p className="c-note">{c.dispRetirada ? 'Não achou seu bairro? A loja ainda não entrega aí, mas você pode retirar.' : 'Não achou seu bairro? A loja ainda não entrega aí.'}</p>
        )}
      </div>
    </>
  );
}
