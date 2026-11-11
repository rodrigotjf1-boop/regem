'use client';

import { textoEntregadorDoCanal } from '@/components/delivery/logistica-canal';
import { agregarItens, corDoPedido, estaAtrasado, identPedido, proximaAcaoNaEstacao, rotuloEtapa, type EtapasDaLoja, type LimitesTempo } from '@/lib/kds-fila';
import type { TemaKds } from '@/lib/kds-tema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CARTÃO DO PEDIDO no KDS — tela neutra, a única cor é a do tempo (verde, amarelo, vermelho).
// `cor='cabecalho'`: só o cabeçalho e o botão de avanço levam a cor; `cor='inteiro'`: o cartão todo.
// Sem borda colorida e sem canto arredondado (decisão do dono, 02/10/2026). Mockup:
// `mockups/regem-kds-producao.html`.

// O tema mora em `lib/kds-tema` (medido nos dois temas pelo check:kds); o tipo segue exportado daqui para quem já usa.
export type { TemaKds };
export type CorDoCartao = 'cabecalho' | 'inteiro';

// Etiqueta curta (ATRASADO, ALTERADO, OBS…): contorno na cor do texto ou "cheia" (invertida).
export function EtiquetaKds({ children, cheia, esc }: { children: React.ReactNode; cheia?: { fundo: string; texto: string }; esc: number }) {
  return (
    <span
      className="inline-block border-[1.5px] px-1.5 font-extrabold uppercase leading-normal tracking-[0.06em]"
      style={{
        fontSize: Math.round(11.5 * esc),
        borderColor: cheia ? cheia.fundo : 'currentColor',
        background: cheia?.fundo,
        color: cheia?.texto,
      }}
    >
      {children}
    </span>
  );
}

export function KdsCartaoPedido({
  p,
  min,
  limites,
  T,
  esc,
  cor,
  agregar,
  realce,
  itemEmDestaque,
  onAvancar,
  proximoNome,
  veioDe,
  onVisto,
  etapas,
  ocupado,
}: {
  p: any;
  min: number;
  limites: LimitesTempo;
  T: TemaKds;
  esc: number;
  cor: CorDoCartao;
  agregar: boolean;
  realce: 'nenhum' | 'destaque' | 'apagado'; // item escolhido no resumo: destaca quem o leva
  itemEmDestaque: string;
  // `de` = a etapa que esta tela VIU: o servidor só avança se o cartão ainda está nela (toque duplo e tela velha não
  // pulam etapa — auditoria do KDS, 11/11/2026).
  onAvancar: (id: string, de?: string) => void;
  etapas?: EtapasDaLoja; // as etapas da loja: o nome do botão segue o que o servidor faz
  ocupado?: boolean; // o toque foi mandado e a resposta ainda não voltou: o botão espera ("Aguarde…")
  proximoNome?: string | null; // o "vai para" da estação: o botão diz "Pronto → Montagem" (entrega 2)
  veioDe?: string | null; // a estação de onde o cartão veio ("Veio da Chapa")
  onVisto?: (id: string) => void; // pedido ALTERADO (mig 362): a cozinha viu a mudança
}) {
  const st = corDoPedido(p, min, limites);
  const inteiro = cor === 'inteiro';
  const cancelado = p.status === 'cancelado';
  const acao = proximaAcaoNaEstacao(p.status, proximoNome, etapas);
  const atrasado = estaAtrasado(p, min, limites);
  const alterado = p.obs === 'ALTERADO';
  // Pedido ALTERADO que a cozinha ainda não viu (mig 362): o aviso grande com a exclamação e o "Visto" (decisão 6A).
  const naoVisto = !!p.alteracaoNaoVista && !cancelado;
  // "invertido": o par de cores que salta sobre o fundo onde está (cabeçalho × corpo).
  const invCab = { fundo: st.texto, texto: st.fundo };
  const invCorpo = inteiro ? invCab : { fundo: T.text, texto: T.panel };
  const entregador = textoEntregadorDoCanal(p.logistica);
  const origem = p.plataforma ? `${p.plataforma}${p.senhaPlataforma ? ` #${p.senhaPlataforma}` : ''}` : '';
  const linha = [cancelado ? '' : rotuloEtapa(p.status), origem].filter(Boolean).join(' · ');
  const itens: any[] = agregar ? agregarItens(p.itens ?? []) : (p.itens ?? []);
  const risco = cancelado ? 'line-through' : undefined;

  return (
    <article
      aria-label={`${identPedido(p)}, ${min} minutos, ${rotuloEtapa(p.status)}${atrasado ? ', atrasado' : ''}`}
      className="flex flex-col overflow-hidden border transition-opacity"
      style={{
        background: inteiro ? st.fundo : T.panel,
        color: inteiro ? st.texto : T.text,
        borderColor: inteiro ? 'transparent' : T.border,
        opacity: realce === 'apagado' ? 0.32 : 1,
        outline: realce === 'destaque' ? `5px solid ${T.text}` : undefined,
        outlineOffset: realce === 'destaque' ? -5 : undefined,
      }}
    >
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1"
        style={{
          background: inteiro ? 'transparent' : st.fundo,
          color: st.texto,
          padding: `${Math.round(11 * esc)}px ${Math.round(14 * esc)}px`,
          borderBottom: inteiro ? `1.5px solid ${st.texto}59` : undefined,
        }}
      >
        <span
          className="whitespace-nowrap font-extrabold leading-none"
          style={{ fontFamily: 'Archivo, sans-serif', fontSize: Math.round(27 * esc), textDecoration: risco }}
        >
          {naoVisto && <span aria-hidden="true">! </span>}
          {identPedido(p)}
        </span>
        <span className="whitespace-nowrap font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: Math.round(24 * esc) }}>
          {min}
          <small className="ml-[3px] font-bold" style={{ fontFamily: 'Figtree, sans-serif', fontSize: Math.round(13.5 * esc) }}>min</small>
        </span>
        <span className="flex basis-full flex-wrap items-center gap-x-2 gap-y-1 font-bold" style={{ fontSize: Math.round(13.5 * esc) }}>
          {linha && <span>{linha}</span>}
          {/* Para viagem (mig 310): etiqueta NEUTRA ao lado do canal — a cor continua sendo só o status. */}
          {p.consumo === 'viagem' && <EtiquetaKds esc={esc}>Viagem</EtiquetaKds>}
          {cancelado && <EtiquetaKds cheia={invCab} esc={esc}>Cancelado</EtiquetaKds>}
          {atrasado && <EtiquetaKds cheia={invCab} esc={esc}>Atrasado</EtiquetaKds>}
          {alterado && <EtiquetaKds esc={esc}>Alterado</EtiquetaKds>}
          {/* O endereço do pedido mudou (mig 362): para quem despacha — nada muda para a cozinha. */}
          {p.enderecoMudouEm && !cancelado && <EtiquetaKds esc={esc}>Endereço mudou</EtiquetaKds>}
          {veioDe && !cancelado && <EtiquetaKds esc={esc}>Veio de {veioDe}</EtiquetaKds>}
          {/* "Cheguei" na retirada (mig 354): o cliente já está na loja — etiqueta CHEIA (sem cor nova: a do tempo segue). */}
          {p.chegada && !cancelado && <EtiquetaKds cheia={invCab} esc={esc}>Cliente chegou</EtiquetaKds>}
          {/* Pedido IGUAL ainda sem o "São dois pedidos" (mig 360): etiqueta CHEIA (sem cor nova: a do tempo segue). */}
          {p.repetido && !cancelado && <EtiquetaKds cheia={invCab} esc={esc}>Repetido?</EtiquetaKds>}
        </span>
      </div>

      <div className="flex flex-1 flex-col" style={{ padding: `${Math.round(12 * esc)}px ${Math.round(14 * esc)}px ${Math.round(14 * esc)}px` }}>
        {/* PEDIDO ALTERADO ainda não visto (mig 362): o bloco INVERTIDO (sem cor nova — a do tempo segue), a exclamação, a
            hora da mudança e o "Visto". Depois do Visto sobra a etiqueta "Alterado" e o NOVO no item. */}
        {naoVisto && (
          <div
            role="alert"
            className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2"
            style={{ background: invCorpo.fundo, color: invCorpo.texto, padding: `${Math.round(10 * esc)}px ${Math.round(12 * esc)}px` }}
            data-kds-alterado
          >
            <span aria-hidden="true" className="font-black leading-none" style={{ fontFamily: 'Archivo, sans-serif', fontSize: Math.round(34 * esc) }}>
              !
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-black uppercase leading-tight tracking-[0.04em]" style={{ fontFamily: 'Archivo, sans-serif', fontSize: Math.round(20 * esc) }}>
                Pedido alterado
              </span>
              {p.alteradoEm && (
                <span className="block font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: Math.round(13 * esc) }}>
                  {new Date(p.alteradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </span>
            {onVisto && (
              <button
                type="button"
                onClick={() => onVisto(p.id)}
                className="font-extrabold uppercase tracking-[0.08em] active:opacity-85"
                style={{
                  minHeight: Math.round(44 * esc),
                  padding: `0 ${Math.round(16 * esc)}px`,
                  fontFamily: 'Archivo, sans-serif',
                  fontSize: Math.round(14 * esc),
                  background: invCorpo.texto,
                  color: invCorpo.fundo,
                }}
                data-kds-visto
              >
                Visto
              </button>
            )}
          </div>
        )}
        {/* O outro pedido igual do mesmo cliente: a cozinha confirma com o atendimento antes de fazer. */}
        {p.repetido && !cancelado && (
          <p className="mb-2.5 font-bold" style={{ fontSize: Math.round(13.5 * esc) }} data-kds-repetido>
            {p.repetido.texto}
          </p>
        )}
        {/* Onde o cliente da retirada está (o "Cheguei" do cardápio ou do WhatsApp), quando ele disse. */}
        {p.chegada && !cancelado && (p.chegada.onde || p.chegada.obs) && (
          <p className="mb-2.5 font-bold" style={{ fontSize: Math.round(13.5 * esc) }}>
            {p.chegada.onde === 'balcao' ? '🏪 No balcão' : p.chegada.onde === 'porta' ? '🛵 Na porta' : '🙋'}
            {p.chegada.obs ? `${p.chegada.onde === 'porta' ? ':' : ' ·'} ${p.chegada.obs}` : ''}
          </p>
        )}
        {/* Entregador do canal (99, mig 294): quem vem buscar, se já chegou e o código de coleta. */}
        {entregador && (
          <p className="mb-2.5 font-bold" style={{ fontSize: Math.round(13.5 * esc) }}>
            {p.logistica?.status === 130 ? <EtiquetaKds cheia={invCorpo} esc={esc}>Entregador chegou</EtiquetaKds> : <EtiquetaKds esc={esc}>Entregador</EtiquetaKds>}{' '}
            {entregador}
            {p.logistica?.codigoColeta ? ` · código ${p.logistica.codigoColeta}` : ''}
          </p>
        )}
        <ul className="mb-3 grid flex-1 content-start gap-2">
          {itens.map((it: any, ix: number) => {
            const alvo = realce === 'destaque' && String(it.descricao ?? '').trim() === itemEmDestaque;
            // Pedido alterado (mig 362): o item que entrou leva NOVO; o que saiu fica riscado com TIRAR até o "Visto".
            const tirar = it.status === 'removido' && !cancelado;
            const novo = it.status === 'novo';
            return (
              <li
                key={it.id ?? ix}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 leading-snug"
                style={{ fontSize: Math.round(16 * esc), textDecoration: risco ?? (tirar ? 'line-through' : undefined) }}
                data-kds-item={tirar ? 'tirar' : novo ? 'novo' : undefined}
              >
                <span className="min-w-[2.2ch] text-right font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {Number(it.quantidade)}×
                </span>
                <div>
                  <span className="font-bold" style={alvo ? { background: invCorpo.fundo, color: invCorpo.texto, padding: '0 5px' } : undefined}>
                    {it.descricao}
                  </span>
                  {novo && (
                    <>
                      {' '}
                      <EtiquetaKds cheia={invCorpo} esc={esc}>Novo</EtiquetaKds>
                    </>
                  )}
                  {tirar && (
                    <>
                      {' '}
                      <EtiquetaKds cheia={invCorpo} esc={esc}>Tirar</EtiquetaKds>
                    </>
                  )}
                  {it.complementosTexto && (
                    <div className="mt-0.5 font-semibold" style={{ fontSize: Math.round(13.5 * esc), color: inteiro ? 'inherit' : T.muted }}>
                      + {it.complementosTexto}
                    </div>
                  )}
                  {it.observacao && (
                    <div className="mt-1 font-extrabold" style={{ fontSize: Math.round(13.5 * esc) }}>
                      <EtiquetaKds cheia={invCorpo} esc={esc}>Obs</EtiquetaKds> {it.observacao}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!cancelado && acao && (
          <button
            type="button"
            onClick={() => onAvancar(p.id, p.status)}
            disabled={!!ocupado}
            aria-busy={!!ocupado || undefined}
            className="w-full font-extrabold uppercase tracking-[0.08em] active:opacity-85 disabled:cursor-wait disabled:opacity-70"
            // No modo "cabeçalho" o botão tem a cor do cabeçalho; no "inteiro", invertido sobre a cor.
            style={{
              minHeight: Math.round(48 * esc),
              fontFamily: 'Archivo, sans-serif',
              fontSize: Math.round(14.5 * esc),
              background: inteiro ? st.texto : st.fundo,
              color: inteiro ? st.fundo : st.texto,
            }}
          >
            {ocupado ? 'Aguarde…' : acao}
          </button>
        )}
      </div>
    </article>
  );
}
