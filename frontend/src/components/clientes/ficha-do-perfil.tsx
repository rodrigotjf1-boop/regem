'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Gaveta } from '@/components/ui/sobreposto';
import { Button } from '@/components/ui/button';
import { OQueMove } from './o-que-move';
import { OQueOlha } from './o-que-olha';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FICHA DO PERFIL DO CLIENTE (F1b do docs/plano-perfil-cliente.md; protótipo `mockups/regem-perfil-cliente.html`, aba
// "Clientes e ficha"). Gaveta com as camadas do perfil, cada uma com a confiança e o porquê das etiquetas. Os dados vêm de
// `GET /perfil-cliente/:id` — o servidor confere o papel (presidente e gerente), a permissão e o módulo ligado.

const SEGMENTO: Record<string, string> = {
  campeoes: 'Campeão', leais: 'Leal', recentes: 'Recente', atencao: 'Precisa de atenção', em_risco: 'Em risco', inativos: 'Inativo',
};
const ETIQUETA: Record<string, string> = {
  novo: 'Novo', campeao: 'Campeão', atrasado: 'Atrasado no ritmo', em_risco: 'Em risco', reclamou_recente: 'Reclamou recentemente',
  reclamou_repetido: 'Reclamou 2+ vezes do mesmo motivo', pede_agendado: 'Pede agendado', so_retira: 'Só retira', fim_de_semana: 'Pede no fim de semana',
};
const FAIXA: Record<string, string> = {
  madrugada: 'Madrugada (0–4h)', manha: 'Manhã', almoco: 'Almoço (11–15h)', tarde: 'Tarde', inicio_noite: 'Início da noite (18–21h)', noite: 'Noite (21–24h)',
};
const FAIXAS_DA_GRADE = ['inicio_noite', 'noite', 'madrugada', 'almoco'] as const;
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const CONFIANCA: Record<string, { rotulo: string; cls: string }> = {
  alta: { rotulo: 'confiança alta', cls: 'bg-ok/15 text-ok' },
  media: { rotulo: 'confiança média', cls: 'bg-info/10 text-info' },
  baixa: { rotulo: 'confiança baixa', cls: 'bg-secondary text-muted-foreground' },
};
const DECLARADO: Record<string, string> = {
  time: 'Time', respostas_curtas: 'Prefere respostas curtas', prefere_audio: 'Prefere áudio', apelido: 'Como gosta de ser chamado',
  gostaria: 'Gostaria de encontrar', alergia: 'Alergia (guardada a pedido do cliente)', nao_gosta: 'Não gosta de',
};
const moeda = (v: any) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const num = (v: any, casas = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const valorDeclarado = (v: any) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v ?? ''));

function Camada({ n, titulo, conf, etiqueta, children }: { n: number; titulo: string; conf?: string | null; etiqueta?: string | null; children: React.ReactNode }) {
  const c = conf ? CONFIANCA[conf] : null;
  return (
    <section className="mb-3 rounded-lg border border-border bg-card p-4" aria-labelledby={`camada-${n}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`camada-${n}`} className="font-display text-sm font-semibold">
          <span className="mr-2 rounded bg-primary/15 px-1.5 font-mono text-xs">{n}</span>
          {titulo}
        </h3>
        {c && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.cls}`}>{c.rotulo}</span>}
        {etiqueta && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">{etiqueta}</span>}
      </div>
      {children}
    </section>
  );
}

function Par({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <div className="break-words text-sm font-semibold">{children}</div>
    </div>
  );
}

export function FichaDoPerfil({ clienteId, nome, aoFechar }: { clienteId: string; nome: string; aoFechar: () => void }) {
  const [dados, setDados] = useState<any | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    api
      .perfilClienteFicha(clienteId)
      .then((d: any) => vivo && setDados(d))
      .catch((e: any) => vivo && setErro(e?.message || 'Não foi possível abrir o perfil.'));
    return () => {
      vivo = false;
    };
  }, [clienteId, tentativa]);

  const p = dados?.perfil;
  const cam = p?.camadas ?? {};
  const recl = cam.reclamacoes ?? {};
  const aval = cam.avaliacoes ?? {};
  const fav: any[] = cam.gosto?.favoritos ?? [];
  const maxFav = Math.max(1, ...fav.map((f) => Number(f.pedidos) || 0));
  const grade = cam.ritmo?.grade ?? {};

  return (
    <Gaveta titulo={`Perfil do cliente · ${nome}`} aoFechar={aoFechar} media rodape={<Button variant="outline" onClick={aoFechar}>Fechar</Button>}>
      {!dados && !erro && <p className="text-sm text-muted-foreground" role="status">Carregando o perfil…</p>}
      {erro && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-semibold">{erro}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => setTentativa((t) => t + 1)}>Tentar de novo</Button>
        </div>
      )}

      {dados?.situacao === 'so_plataforma' && (
        <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm">
          <p className="font-semibold">Este cliente fica fora do perfil.</p>
          <p className="mt-1 text-muted-foreground">
            Pediu só pelo iFood ou pela 99. Os pedidos aparecem para atender e contam nos números da loja, mas não formam ficha nem entram em
            campanha. Se ele pedir direto (cardápio, WhatsApp, balcão), o perfil começa a partir desse pedido.
          </p>
        </div>
      )}
      {dados?.situacao === 'nao_analisar' && (
        <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm">
          <p className="font-semibold">O cliente pediu para não ser analisado.</p>
          <p className="mt-1 text-muted-foreground">O perfil foi apagado e não se recalcula. O robô e a equipe usam só o pedido em curso.</p>
        </div>
      )}
      {dados?.situacao === 'sem_pedido' && (
        <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          Ainda sem pedido direto: o perfil começa no primeiro pedido.
        </p>
      )}

      {p && (
        <>
          <Camada n={1} titulo="Quem é" conf={p.confianca}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Par rotulo="Pedidos diretos">{p.pedidos_diretos}</Par>
              <Par rotulo="Primeiro pedido">{dataBr(p.primeiro_pedido_em)}</Par>
              <Par rotulo="Último pedido">{dataBr(p.ultimo_pedido_em)}</Par>
            </div>
            {dados.declarado?.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {dados.declarado.map((d: any) => (
                  <li key={d.chave}>
                    <span className="text-muted-foreground">{DECLARADO[d.chave] ?? d.chave}:</span> <strong>{valorDeclarado(d.valor)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Camada>

          <Camada n={2} titulo="O que pede" conf={p.confianca}>
            {cam.gosto?.de_sempre ? (
              <p className="mb-2 text-sm">
                <strong>De sempre:</strong> {cam.gosto.de_sempre.nome}{' '}
                <span className="text-muted-foreground">({cam.gosto.de_sempre.pedidos} de {p.pedidos_diretos} pedidos)</span>
              </p>
            ) : (
              <p className="mb-2 text-sm text-muted-foreground">Sem um "de sempre" ainda (precisa de 3 pedidos e um item em metade deles).</p>
            )}
            {fav.length > 0 && (
              <ul className="space-y-1.5" aria-label="Favoritos">
                {fav.map((f) => (
                  <li key={f.nome} className="grid grid-cols-[minmax(0,1fr)_96px_40px] items-center gap-2 text-sm">
                    <span className="truncate">{f.nome}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                      <span className="block h-full bg-primary" style={{ width: `${Math.round((100 * f.pedidos) / maxFav)}%` }} />
                    </span>
                    <span className="text-right font-mono text-xs text-muted-foreground">{f.pedidos}×</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Par rotulo="Ticket médio">{moeda(p.ticket_medio)}</Par>
              <Par rotulo="Pagamento">{cam.gosto?.pagamento ?? '—'}</Par>
              <Par rotulo="Retira na loja">{cam.gosto?.retirada_pct != null ? `${cam.gosto.retirada_pct}%` : '—'}</Par>
            </div>
          </Camada>

          <Camada n={3} titulo="O que olha no cardápio" etiqueta={dados.olha?.desde ? `desde ${dataBr(dados.olha.desde).slice(0, 5)}` : null}>
            <OQueOlha olha={dados.olha} recomendacoes={dados.escolhas?.some((e: any) => e.escolha === 'recomendacoes' && e.valor) === true} />
          </Camada>

          <Camada n={4} titulo="Quando pede" conf={p.confianca}>
            {p.pedidos_diretos >= 3 ? (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-separate border-spacing-[2px] text-[11px] sm:border-spacing-1 sm:text-xs">
                  <caption className="sr-only">Pedidos por dia de operação e faixa do dia</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-16 sm:w-24"><span className="sr-only">Faixa</span></th>
                      {DIAS.map((d) => (
                        <th key={d} scope="col" className="font-semibold text-muted-foreground">{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FAIXAS_DA_GRADE.map((fx) => (
                      <tr key={fx}>
                        <th scope="row" className="w-16 pr-1 text-left font-semibold leading-tight text-muted-foreground sm:w-24">{FAIXA[fx].split(' (')[0]}</th>
                        {DIAS.map((_, i) => {
                          const v = Number(grade?.[String(i + 1)]?.[fx] ?? 0);
                          return (
                            <td key={i} className={`rounded text-center font-mono ${v === 0 ? 'bg-secondary text-muted-foreground' : v === 1 ? 'bg-primary/15' : v <= 3 ? 'bg-primary/40' : 'bg-primary text-primary-foreground'}`}>
                              {v}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Com menos de 3 pedidos, a melhor hora de contato é o pico da loja.</p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Par rotulo="Faixa habitual">{p.faixa_habitual ? FAIXA[p.faixa_habitual] ?? p.faixa_habitual : '—'}</Par>
              <Par rotulo="Hora habitual">{cam.ritmo?.hora_habitual ?? '—'}</Par>
              <Par rotulo="Intervalo habitual">{p.pedidos_diretos >= 2 ? `a cada ${num(p.intervalo_dias, 0)} dias` : '—'}</Par>
              <Par rotulo="Próximo previsto">{p.proximo_previsto ? dataBr(p.proximo_previsto + 'T12:00:00') : '—'}</Par>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">O dia é o dia de operação: pedido até as 4h conta no dia anterior.</p>
          </Camada>

          <Camada n={5} titulo="Quanto vale, como avalia e se está indo embora" conf={p.confianca}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Par rotulo="Segmento">{SEGMENTO[p.segmento] ?? '—'} <span className="font-mono text-xs text-muted-foreground">{p.rfm}</span></Par>
              <Par rotulo="Ticket ajustado">{moeda(p.ticket_ajustado)}</Par>
              <Par rotulo="Atraso">{p.atraso != null ? `${num(p.atraso, 1)}× o ritmo` : '—'}</Par>
            </div>
            {p.etiquetas?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.etiquetas.map((e: string) => (
                  <span key={e} className="rounded-full bg-warn/10 px-2.5 py-0.5 text-xs font-semibold text-warn">{ETIQUETA[e] ?? e}</span>
                ))}
              </div>
            )}
            {Object.entries(cam.porque ?? {}).map(([k, v]) => (
              <p key={k} className="mt-1 text-xs text-muted-foreground">
                Por que “{ETIQUETA[k] ?? k}”: {String(v)}
              </p>
            ))}

            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Reclamações · últimos {recl.janela_dias ?? 90} dias
            </p>
            {recl.grupos?.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {recl.grupos.map((g: any) => (
                  <span key={g.motivo} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${g.vezes >= 2 ? 'bg-destructive/10 text-destructive' : 'bg-warn/10 text-warn'}`}>
                    {g.vezes >= 2 ? `Reclamou ${g.vezes} vezes de ${g.nome}` : `1 vez de ${g.nome}`}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Nenhuma reclamação no período.</p>
            )}
            {recl.ultimas?.length > 0 && (
              <ul className="mt-2 divide-y divide-dashed divide-border text-sm" aria-label="Últimas reclamações">
                {recl.ultimas.map((r: any, i: number) => (
                  <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span>
                      <span className="font-mono text-xs text-muted-foreground">{dataBr(r.em)}</span> · {r.nome}{' '}
                      <span className="text-muted-foreground">· {r.origem === 'avaliacao' ? `avaliação nota ${r.nota}` : 'caso no Atendimento'}</span>
                    </span>
                    {r.situacao && <span className="text-xs text-muted-foreground">{r.situacao === 'resolvido' ? 'resolvida' : 'em aberto'}</span>}
                  </li>
                ))}
              </ul>
            )}
            {recl.total > 0 && <p className="mt-1 text-xs text-muted-foreground">Desde sempre: {recl.total}. O texto do cliente fica no caso; aqui vai só o motivo.</p>}

            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Avaliações</p>
            {aval.quantas ? (
              <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Par rotulo="Nota média">{num(aval.media, 1)} <span className="text-xs font-normal text-muted-foreground">({aval.quantas})</span></Par>
                <Par rotulo="Últimas">{(aval.ultimas ?? []).join(' · ') || '—'}</Par>
                <Par rotulo="O que mais pesa">{aval.mais_pesa ?? '—'}</Par>
                <Par rotulo="Tendência">{aval.tendencia ?? '—'}</Par>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Ainda sem avaliação.</p>
            )}
          </Camada>

          <Camada n={6} titulo="O que move o cliente">
            <OQueMove linhas={dados.sensibilidade} />
            <p className="mt-2 text-xs text-muted-foreground">
              Comparado com ele mesmo, no mesmo dia da semana sem evento, nos últimos 400 dias — e só nos tipos de dia que mexem na loja.
            </p>
          </Camada>

          <p className="text-xs text-muted-foreground">
            Calculado em {new Date(p.calculado_em).toLocaleString('pt-BR')}. O perfil só muda a forma do atendimento — nunca preço, prioridade ou recusa.
          </p>
        </>
      )}
    </Gaveta>
  );
}
