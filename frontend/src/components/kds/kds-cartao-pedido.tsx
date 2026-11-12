'use client';

import { textoEntregadorDoCanal } from '@/components/delivery/logistica-canal';
import {
  agregarItens,
  atrasadoAgora,
  encomendaAguarda,
  etiquetasDoLugar,
  faixaTempo,
  identPedido,
  inicioDoTempo,
  linhasDasEscolhas,
  minutosDoCartao,
  prazoDoPreparo,
  proximaAcaoNaEstacao,
  rotuloEtapa,
  senhaDoCartao,
  type EtapasDaLoja,
  type LimitesTempo,
} from '@/lib/kds-fila';
import type { TemaKds } from '@/lib/kds-tema';
import { useMarcadosDoCartao } from './use-marcados-do-cartao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CARTÃO DO PEDIDO no KDS — no padrão da foto do dono (12/11/2026), sobre a versão 2 (onda 2 da auditoria do KDS): o
// cabeçalho tem as etiquetas do lugar à esquerda (VIAGEM cheia; MESA, BALCÃO e o canal em contorno) e a SENHA grande à
// DIREITA, com a linha escura embaixo; cada item tem a caixinha de marcar (desta tela — ajuda de quem prepara, não muda
// o pedido), a quantidade e o nome; o rodapé tem o tempo (a cor do status só ali), o prazo do preparo ("Preparo 15 min ·
// faltam 6 min") e o botão. O cartão segue NEUTRO, com a letra para 1–2 m (item 20 px, complemento e observação 16 px) e o
// toque de 48 px. Desenho em `app/kds/kds-tela.css`.

// O tema mora em `lib/kds-tema` (medido nos dois temas pelo check:kds); o tipo segue exportado daqui para quem já usa.
export type { TemaKds };

const CLASSE_FAIXA = { ok: 't-ok', atencao: 't-warn', atrasado: 't-late' } as const;
const hm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Etiqueta curta (VIAGEM, OBS, NOVO…): contorno na cor da tinta, "cheia" (invertida) ou "atraso" (contorno vermelho). */
export function EtiquetaKds({ children, tipo }: { children: React.ReactNode; tipo?: 'cheia' | 'atraso' }) {
  return <span className={`k-tag${tipo ? ` ${tipo}` : ''}`}>{children}</span>;
}

export function KdsCartaoPedido({
  p,
  agoraMs,
  limites,
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
  agoraMs: number;
  limites: LimitesTempo;
  agregar: boolean;
  realce: 'nenhum' | 'destaque' | 'apagado'; // item escolhido no resumo: destaca quem o leva
  itemEmDestaque: string;
  // `de` = a etapa que esta tela VIU: o servidor só avança se o cartão ainda está nela (toque duplo e tela velha não
  // pulam etapa — auditoria do KDS, 11/11/2026).
  onAvancar: (p: any, de?: string) => void;
  etapas?: EtapasDaLoja; // as etapas da loja: o nome do botão segue o que o servidor faz
  ocupado?: boolean; // o toque foi mandado e a resposta ainda não voltou: o botão espera ("Aguarde…")
  proximoNome?: string | null; // o "vai para" da estação: o botão diz "Pronto → Montagem" (entrega 2)
  veioDe?: string | null; // a estação de onde o cartão veio ("Veio da Chapa")
  onVisto?: (id: string) => void; // pedido ALTERADO (mig 362): a cozinha viu a mudança
}) {
  const { marcados, alternar } = useMarcadosDoCartao(String(p.id));
  const cancelado = p.status === 'cancelado';
  const aguarda = encomendaAguarda(p, agoraMs);
  const min = minutosDoCartao(p, agoraMs);
  const atrasado = atrasadoAgora(p, agoraMs, limites);
  const acao = proximaAcaoNaEstacao(p.status, proximoNome, etapas);
  const alterado = p.obs === 'ALTERADO';
  // Pedido ALTERADO que a cozinha ainda não viu (mig 362): o aviso grande com a exclamação e o "Visto" (decisão 6A).
  const naoVisto = !!p.alteracaoNaoVista && !cancelado;
  const entregador = textoEntregadorDoCanal(p.logistica);
  const lugar = etiquetasDoLugar(p);
  // O rodapé: o prazo do preparo enquanto o pedido não está pronto; depois dele (e na encomenda que aguarda), a etapa.
  const prazo = aguarda || cancelado ? null : prazoDoPreparo(p, min);
  const itens: any[] = agregar ? agregarItens(p.itens ?? []) : (p.itens ?? []);
  const para = p.encomendaPara ? new Date(p.encomendaPara).getTime() : NaN;
  const classe = [
    'k-card',
    cancelado ? 't-off cancelado' : aguarda ? 't-agenda' : CLASSE_FAIXA[faixaTempo(min, limites)],
    realce === 'destaque' ? 'destaque' : realce === 'apagado' ? 'apagado' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={classe}
      aria-label={`${identPedido(p)}, ${aguarda ? `encomenda para ${hm(para)}` : `${min} minutos`}, ${
        cancelado ? 'cancelado' : rotuloEtapa(p.status)
      }${atrasado ? ', atrasado' : ''}`}
      data-kds-cartao={p.id}
    >
      {/* Cabeçalho da foto: as etiquetas à esquerda, a senha grande à DIREITA (pedido do dono, 12/11/2026). */}
      <div className="k-cab k-cab-pedido">
        <span className="k-etqs">
          {lugar.map((e) => (
            <EtiquetaKds key={e.texto} tipo={e.cheia ? 'cheia' : undefined}>
              {e.texto}
            </EtiquetaKds>
          ))}
          {Number.isFinite(para) && !cancelado && <EtiquetaKds>Encomenda · para {hm(para)}</EtiquetaKds>}
          {cancelado && <EtiquetaKds tipo="cheia">Cancelado</EtiquetaKds>}
          {atrasado && <EtiquetaKds tipo="atraso">Atrasado</EtiquetaKds>}
          {alterado && <EtiquetaKds>Alterado</EtiquetaKds>}
          {/* O endereço do pedido mudou (mig 362): para quem despacha — nada muda para a cozinha. */}
          {p.enderecoMudouEm && !cancelado && <EtiquetaKds>Endereço mudou</EtiquetaKds>}
          {veioDe && !cancelado && <EtiquetaKds>Veio de {veioDe}</EtiquetaKds>}
          {/* "Cheguei" na retirada (mig 354): o cliente já está na loja. */}
          {p.chegada && !cancelado && <EtiquetaKds tipo="cheia">Cliente chegou</EtiquetaKds>}
          {/* Pedido IGUAL ainda sem o "São dois pedidos" (mig 360). */}
          {p.repetido && !cancelado && <EtiquetaKds tipo="cheia">Repetido?</EtiquetaKds>}
        </span>
        <span className="k-ident">
          {naoVisto && <span aria-hidden="true">! </span>}
          {senhaDoCartao(p)}
        </span>
      </div>

      <div className="k-cc">
        {/* PEDIDO ALTERADO ainda não visto (mig 362): o bloco invertido, a exclamação, a hora da mudança e o "Visto". Depois
            do Visto sobra a etiqueta "Alterado" e o NOVO no item. */}
        {naoVisto && (
          <div className="k-alt" role="alert" data-kds-alterado>
            <span className="ex" aria-hidden="true">
              !
            </span>
            <span className="tx">
              <b>Pedido alterado</b>
              {p.alteradoEm && <span>{hm(new Date(p.alteradoEm).getTime())}</span>}
            </span>
            {onVisto && (
              <button type="button" onClick={() => onVisto(p.id)} data-kds-visto>
                Visto
              </button>
            )}
          </div>
        )}
        {/* O outro pedido igual do mesmo cliente: a cozinha confirma com o atendimento antes de fazer. */}
        {p.repetido && !cancelado && (
          <p className="k-linha-inf" data-kds-repetido>
            {p.repetido.texto}
          </p>
        )}
        {/* Onde o cliente da retirada está (o "Cheguei" do cardápio ou do WhatsApp), quando ele disse. */}
        {p.chegada && !cancelado && (p.chegada.onde || p.chegada.obs) && (
          <p className="k-linha-inf">
            {p.chegada.onde === 'balcao' ? '🏪 No balcão' : p.chegada.onde === 'porta' ? '🛵 Na porta' : '🙋'}
            {p.chegada.obs ? `${p.chegada.onde === 'porta' ? ':' : ' ·'} ${p.chegada.obs}` : ''}
          </p>
        )}
        {/* Entregador do canal (99, mig 294): quem vem buscar, se já chegou e o código de coleta. */}
        {entregador && (
          <p className="k-linha-inf">
            {p.logistica?.status === 130 ? <EtiquetaKds tipo="cheia">Entregador chegou</EtiquetaKds> : <EtiquetaKds>Entregador</EtiquetaKds>}{' '}
            {entregador}
            {p.logistica?.codigoColeta ? ` · código ${p.logistica.codigoColeta}` : ''}
          </p>
        )}
        <ul className="k-itens">
          {itens.map((it: any, ix: number) => {
            const alvo = realce === 'destaque' && String(it.descricao ?? '').trim() === itemEmDestaque;
            // Pedido alterado (mig 362): o item que entrou leva NOVO; o que saiu fica riscado com TIRAR até o "Visto".
            const tirar = it.status === 'removido' && !cancelado;
            const novo = it.status === 'novo';
            const comp = linhasDasEscolhas(it.complementosTexto);
            const chave = String(it.id ?? `${ix}:${it.descricao ?? ''}`);
            const feito = marcados.has(chave);
            const qtd = Number(it.quantidade);
            return (
              <li
                key={it.id ?? ix}
                className={`k-it k-it-chk${tirar ? ' tirar' : ''}${alvo ? ' alvo' : ''}${feito ? ' feito' : ''}`}
                data-kds-item={tirar ? 'tirar' : novo ? 'novo' : undefined}
              >
                {/* A caixinha: só onde há o que fazer (o item que sai e o pedido cancelado não se marcam). */}
                {tirar || cancelado ? (
                  <span className="k-chk-vazio" aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    className="k-chk"
                    aria-pressed={feito}
                    aria-label={`${feito ? 'Desmarcar' : 'Marcar'} ${qtd} ${it.descricao ?? 'item'} como feito`}
                    onClick={() => alternar(chave)}
                    data-kds-chk
                  >
                    <span className="caixa" aria-hidden="true">
                      {feito ? '✓' : ''}
                    </span>
                  </button>
                )}
                <span className="k-q">{qtd}</span>
                <div className="k-it-txt">
                  <span className="k-d">{it.descricao}</span>
                  {novo && (
                    <>
                      {' '}
                      <EtiquetaKds tipo="cheia">Novo</EtiquetaKds>
                    </>
                  )}
                  {tirar && (
                    <>
                      {' '}
                      <EtiquetaKds tipo="cheia">Tirar</EtiquetaKds>
                    </>
                  )}
                  {comp.length > 0 && (
                    <ul className="k-comp">
                      {comp.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {it.observacao && (
                    <p className="k-obs">
                      <EtiquetaKds tipo="cheia">Obs</EtiquetaKds> {it.observacao}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Rodapé da foto: o tempo (a cor do status só aqui), o prazo do preparo ou a etapa, e o botão à direita. */}
      <div className="k-cartao-pe">
        {aguarda ? (
          <span className="k-tempo">
            <small>começa</small>
            {hm(inicioDoTempo(p))}
          </span>
        ) : (
          <span className="k-tempo">
            {min}
            <small>min</small>
          </span>
        )}
        <span className="k-prazo" data-kds-prazo>
          {prazo ? (
            <>
              <span>{prazo.preparo}</span>
              <b>{prazo.resta}</b>
            </>
          ) : (
            <span>{cancelado ? 'Cancelado' : rotuloEtapa(p.status)}</span>
          )}
        </span>
        {!cancelado && acao && (
          <button
            type="button"
            className="k-avancar"
            onClick={() => onAvancar(p, p.status)}
            disabled={!!ocupado}
            aria-busy={ocupado ? 'true' : undefined}
          >
            {ocupado ? 'Aguarde…' : acao}
          </button>
        )}
      </div>
    </article>
  );
}
