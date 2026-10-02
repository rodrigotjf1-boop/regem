'use client';

import type { CSSProperties } from 'react';
import '@/app/c/[token]/temas/templates.css';
import { useCardapio, type Camada } from './use-cardapio';
import type { TemplateChave } from './tipos-template';
import { FONTES_TEMPLATES } from './fontes';
import { corSobre, corSuave, Ic } from './partes';
import { BarraBalcao, BarraFluxo, BarraGaleria, BarraOferta, VitrineBalcao, VitrineFluxo, VitrineGaleria, VitrineOferta } from './vitrines';
import { ProdutoTela } from './produto';
import { Checkout } from './checkout';
import { Confirmacao } from './confirmacao';
import { Conta } from './conta';
import { Busca, InfoLoja, OndeVoceEsta } from './folhas';
import { ProvedorEvento, useCamadaDoEvento } from '../eventos/contexto';

// CARDÁPIO PÚBLICO NOS TEMPLATES NOVOS (Galeria, Balcão, Oferta, Regem Fluxo). A regra inteira
// mora em `useCardapio`; este componente só escolhe o que desenhar: a vitrine do template, a barra
// da sacola e as camadas abertas por cima (produto, busca, conta, checkout…), na ordem da pilha.

const VITRINE = { galeria: VitrineGaleria, balcao: VitrineBalcao, oferta: VitrineOferta, fluxo: VitrineFluxo };
const BARRA = { galeria: BarraGaleria, balcao: BarraBalcao, oferta: BarraOferta, fluxo: BarraFluxo };
const ehEtapa = (c: Camada) => c.startsWith('etapa:');

export function CardapioTemplates({
  token,
  mesa,
  search,
  temaForcado,
}: {
  token: string;
  mesa: string;
  search: { get(nome: string): string | null } | null;
  /** Prévia de um template pelo link (`?tema=`), sem mudar a escolha da loja. */
  temaForcado?: TemplateChave | null;
}) {
  const c = useCardapio(token, mesa, search, temaForcado);
  // Evento sazonal no ar (Natal, Black Friday, Dia de jogo…): `null` na imensa maioria dos dias.
  // É só enfeite por cima do template — a cor de ação pode virar a do evento; o resto é da loja.
  const ev = useCamadaDoEvento(c);
  const acento = (ev && ev.pecas.acentoDoEvento(ev.evento, c.dark)) || c.accent;
  const vars = {
    '--p-acc': acento,
    '--p-on': corSobre(acento),
    '--p-acc-soft': corSuave(acento, c.dark ? 0.18 : 0.1),
    ...(c.corCabecalho ? { '--p-cab': c.corCabecalho, '--p-cab-ink': c.corTextoCabecalho } : {}),
  } as CSSProperties;
  const raiz = `p-root tpl-${c.template} ${c.corCabecalho ? 'tem-cab' : ''} ${ev ? ev.pecas.classesDoEvento(ev.evento) : ''} ${FONTES_TEMPLATES}`;
  const aviso = c.toast ? (ev ? ev.pecas.fraseDoAviso(ev.evento, c.toast) : c.toast) : '';

  if (c.erro && !c.menu)
    return (
      <div className="p-palco">
        <main className={`${raiz} p-vazio`} style={vars}>
          <p>{c.erro}</p>
          <button type="button" className="p-btn2" onClick={() => window.location.reload()}>
            Tentar de novo
          </button>
        </main>
      </div>
    );
  // Esqueleto no formato do conteúdo (topo, categorias e linhas de produto).
  if (!c.menu)
    return (
      <div className="p-palco">
        <main className={`${raiz} p-skel`} style={vars} aria-busy="true" aria-label="Carregando o cardápio">
          <div className="sk sk-topo" />
          <div className="sk-chips">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="sk" />
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sk-linha">
              <div className="sk" />
              <div>
                <div className="sk" />
                <div className="sk" />
                <div className="sk" />
              </div>
            </div>
          ))}
        </main>
      </div>
    );

  if (c.ped)
    return (
      <div className="p-palco">
        <main className={raiz} style={vars}>
          <ProvedorEvento valor={ev}>
            {ev && <ev.pecas.Camada c={c} e={ev} />}
            <Confirmacao c={c} />
            {aviso && <Aviso texto={aviso} />}
          </ProvedorEvento>
        </main>
      </div>
    );

  const Vitrine = VITRINE[c.template];
  const Barra = BARRA[c.template];
  // Só a etapa de cima do checkout é desenhada (as de baixo servem ao "voltar").
  const ultimaEtapa = c.pilha.map(ehEtapa).lastIndexOf(true);
  const camadas = c.pilha.filter((x, i) => !ehEtapa(x) || i === ultimaEtapa);

  return (
    <div className="p-palco">
      <main className={raiz} style={vars}>
        <ProvedorEvento valor={ev}>
          {ev && <ev.pecas.Camada c={c} e={ev} />}
          <Vitrine c={c} />
          {c.qtdItens > 0 && <Barra c={c} />}
          {camadas.map((camada, i) => {
            if (camada === 'produto')
              return c.sel ? <ProdutoTela key={`produto-${c.sel.id}-${i}`} sel={c.sel} template={c.template} loja={c.loja} onFechar={c.voltar} onAdd={c.adicionarDoProduto} /> : null;
            if (camada === 'busca') return <Busca key="busca" c={c} />;
            if (camada === 'info') return <InfoLoja key="info" c={c} />;
            if (camada === 'conta') return <Conta key="conta" c={c} />;
            if (camada === 'local') return <OndeVoceEsta key="local" c={c} />;
            return <Checkout key="checkout" c={c} />;
          })}
          {aviso && <Aviso texto={aviso} />}
        </ProvedorEvento>
      </main>
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="p-toast" role="status">
      <Ic n="check" s={16} /> {texto}
    </div>
  );
}
