'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Ajustes, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chave } from '@/components/ui/chave';
import { Selo, texto2 } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { GavetaDasAnalises, PRECO_DAS_ANALISES } from './gaveta-das-analises';
import { GavetaDosValores, textoDoValor } from './gaveta-dos-valores';

// MISTER › AVISOS E RELATÓRIOS — "para onde vai" cada aviso (versão 2 do protótipo `mockups/regem-mister.html`, aprovada
// em 14/11/2026). Cada aviso vai para quem resolve; o padrão é a tabela que o dono aprovou e cada empresa muda em "Mudar".
// Só o presidente (rotas `mister/avisos`). A tela segue o modelo das telas de ajuste do Regem: grupos contados, "buscar
// ajuste" e UMA barra de "Salvar alterações" — o "Mudar" abre a gaveta e "Aplicar" leva a escolha para a barra.

type Destino = 'presidente' | 'gerente' | 'tela' | 'kds' | 'atendimento' | 'dms';
type Regra = {
  ligado: boolean;
  destinos: Destino[];
  escalaMin: number | null;
  escalaPara: Destino[];
  parametro: number | null;
  /** Só no gasto do WhatsApp oficial (G2, mig 446): os valores do alerta, em reais. */
  valores?: number[];
};
/** Os avisos de dinheiro do WhatsApp oficial (G2): sem KDS nem Atendimento e sem "se ninguém resolver" (o servidor confere). */
const TIPOS_DO_GASTO = ['gasto_whatsapp', 'franquia_atendimento'];
const DESTINOS_DO_GASTO: Destino[] = ['presidente', 'gerente', 'tela', 'dms'];
type AvisoNaTela = { tipo: string; grupo: string; titulo: string; descricao: string; jaFunciona: boolean; regra: Regra; padrao: boolean };
type DaTela = { avisos: AvisoNaTela[]; destinos: { id: Destino; nome: string }[] };
type RegraDoRelatorio = { ligado: boolean; hora: string; diaSemana: number | null };
type RelatorioNaTela = {
  tipo: string;
  titulo: string;
  descricao: string;
  /** Para quem vai, quando não é a régua dos avisos (F4c: o das fichas novas vai a quem pode ver os candidatos). */
  vaiPara?: string;
  /** Se a IA escreve (soma no "Uso da IA"); o das fichas novas só conta. */
  usaIa?: boolean;
  regra: RegraDoRelatorio;
  ultimo: { referencia: string; situacao: string; motivo: string | null; em: string } | null;
};
/** Os ajustes da conversa (mig 440; versão 3 do protótipo, grupo "Conversa"): por enquanto, os documentos por foto. */
type ModoDoBoleto = 'sozinho' | 'perguntar';
/** Versão 5, M5e (mig 462): "Como mandar o resumo" — a mesma lista do servidor (`FORMAS_DE_ENTREGA_DO_RESUMO`). */
type FormaDoResumo = 'botoes' | 'pdf' | 'link' | 'texto';
type Conversa = { documentosLigado: boolean; documentosModo: ModoDoBoleto; resumoEntrega?: FormaDoResumo; responderAudio?: boolean; analisesProfundas?: boolean };
const CONV = 'conversa:documentos';
const CONV_RESUMO = 'conversa:resumo';
const CONV_VOZ = 'conversa:voz';
const CONV_ANALISES = 'conversa:analises';
const FORMAS_DO_RESUMO: { v: FormaDoResumo; rotulo: string }[] = [
  { v: 'botoes', rotulo: 'texto com os botões PDF e link' },
  { v: 'pdf', rotulo: 'texto e o PDF junto' },
  { v: 'link', rotulo: 'texto e o link junto' },
  { v: 'texto', rotulo: 'só o texto' },
];
const formaDoResumo = (v: unknown): FormaDoResumo => (FORMAS_DO_RESUMO.some((f) => f.v === v) ? (v as FormaDoResumo) : 'botoes');
/** M3a parte 4: quando avisar do boleto perto de vencer (o `parametro` da regra; o servidor confere a mesma lista). */
const ANTECEDENCIAS_DO_BOLETO = [
  { v: 3, rotulo: '3 dias antes e no dia' },
  { v: 1, rotulo: '1 dia antes e no dia' },
  { v: 0, rotulo: 'só no dia' },
];
/** M3e: quando avisar do ponto esquecido (o `parametro` da regra; o servidor confere a mesma lista). */
const QUANDO_DO_PONTO = [
  { v: 0, rotulo: 'no dia seguinte, às 10h' },
  { v: 30, rotulo: '30 min depois' },
  { v: 60, rotulo: '1 hora depois' },
];
const MODOS_DO_BOLETO: { v: ModoDoBoleto; rotulo: string }[] = [
  { v: 'sozinho', rotulo: 'boleto: sozinho se o código confere' },
  { v: 'perguntar', rotulo: 'boleto: pergunta antes' },
];
const paraValorDaConversa = (c: Conversa): string => JSON.stringify({ documentosLigado: c.documentosLigado, documentosModo: c.documentosModo });
const deValorDaConversa = (v: Valor | undefined): Conversa => {
  try {
    const c = JSON.parse(String(v ?? ''));
    return { documentosLigado: c.documentosLigado !== false, documentosModo: c.documentosModo === 'perguntar' ? 'perguntar' : 'sozinho' };
  } catch {
    return { documentosLigado: true, documentosModo: 'sozinho' };
  }
};

/** Os relatórios (mig 420) ficam nos mesmos valores da tela, com a chave `rel:<tipo>`. */
const REL = 'rel:';
const DIAS_DA_SEMANA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const paraValorDoRelatorio = (r: RegraDoRelatorio): string => JSON.stringify({ ligado: r.ligado, hora: r.hora, diaSemana: r.diaSemana });
const deValorDoRelatorio = (v: Valor | undefined): RegraDoRelatorio => {
  try {
    const r = JSON.parse(String(v ?? ''));
    return { ligado: !!r.ligado, hora: String(r.hora ?? ''), diaSemana: r.diaSemana ?? null };
  } catch {
    return { ligado: false, hora: '', diaSemana: null };
  }
};
/** O motivo de um relatório que não saiu, em português (o servidor guarda o código). */
const MOTIVO_DO_RELATORIO: Record<string, string> = {
  fora_da_janela_de_24h: 'a pessoa não falou com o Mister nas últimas 24 horas',
  fora_da_janela_e_sem_modelo: 'a pessoa não falou com o Mister nas últimas 24 horas, e a Meta ainda não aprovou o modelo de mensagem',
  sem_acesso: 'a pessoa não tem mais acesso ao Mister',
  sem_chave: 'sem a chave de IA',
  chave_recusada: 'a chave de IA foi recusada',
  sem_credito: 'a chave de IA está sem crédito',
  teto_atingido: 'a chave de IA chegou ao teto de gasto',
  interrompido: 'o servidor reiniciou no meio',
  sem_fichas: 'as fichas do resumo já não estavam na Página de vagas quando a pessoa tocou em "Ver resumo"',
};
const quandoFoi = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

const ORDEM: Destino[] = ['presidente', 'gerente', 'tela', 'kds', 'atendimento', 'dms'];
const TEMPOS_DA_ESCALA = [5, 15, 30, 120];
const nomeDoTempo = (m: number) => (m >= 60 ? `${m / 60} ${m === 60 ? 'hora' : 'horas'}` : `${m} min`);

/** A regra como valor da tela: texto com as chaves sempre na mesma ordem (é o que decide "mudou ou não"). */
const paraValor = (r: Regra): string =>
  JSON.stringify({
    ligado: r.ligado,
    destinos: ORDEM.filter((d) => r.destinos.includes(d)),
    escalaMin: r.escalaMin,
    escalaPara: ORDEM.filter((d) => r.escalaPara.includes(d)),
    parametro: r.parametro,
    // Só o gasto do WhatsApp tem valores (nos outros a chave nem aparece: o texto dos outros avisos não muda).
    ...(Array.isArray(r.valores) ? { valores: r.valores } : {}),
  });
const deValor = (v: Valor | undefined): Regra => {
  try {
    const r = JSON.parse(String(v ?? ''));
    return {
      ligado: !!r.ligado,
      destinos: r.destinos ?? [],
      escalaMin: r.escalaMin ?? null,
      escalaPara: r.escalaPara ?? [],
      parametro: r.parametro ?? null,
      ...(Array.isArray(r.valores) ? { valores: r.valores.map(Number) } : {}),
    };
  } catch {
    return { ligado: false, destinos: [], escalaMin: null, escalaPara: [], parametro: null };
  }
};

function GavetaDoDestino({
  aviso,
  regra,
  nomes,
  aoAplicar,
  aoFechar,
}: {
  aviso: AvisoNaTela;
  regra: Regra;
  nomes: Record<Destino, string>;
  aoAplicar: (r: Regra) => void;
  aoFechar: () => void;
}) {
  // O gasto do WhatsApp (G2): só os destinos de dinheiro e nada de "se ninguém resolver".
  const doGasto = TIPOS_DO_GASTO.includes(aviso.tipo);
  const opcoes = doGasto ? ORDEM.filter((d) => DESTINOS_DO_GASTO.includes(d)) : ORDEM;
  const [destinos, setDestinos] = useState<Destino[]>(regra.destinos);
  const [escalaMin, setEscalaMin] = useState<number | null>(regra.escalaMin);
  const [escalaPara, setEscalaPara] = useState<Destino[]>(regra.escalaPara);
  const virar = (l: Destino[], d: Destino) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d]);
  const semDestino = regra.ligado && destinos.length === 0;
  const semQuem = escalaMin !== null && escalaPara.length === 0;
  return (
    <Gaveta
      titulo={`Para onde vai: ${aviso.titulo}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={semDestino || semQuem}
            onClick={() => aoAplicar({ ...regra, destinos, escalaMin, escalaPara: escalaMin === null ? [] : escalaPara })}
          >
            Aplicar
          </Button>
        </>
      }
    >
      <p className={`text-sm ${texto2}`}>Escolha quem fica sabendo deste aviso. O que você escolher aqui vale para todas as lojas da empresa.</p>
      <fieldset className="mt-4 space-y-1 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-bold">Na hora</legend>
        {opcoes.map((d) => (
          <label key={d} className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={destinos.includes(d)} onChange={() => setDestinos((l) => virar(l, d))} />
            {nomes[d]}
          </label>
        ))}
        {semDestino && (
          <p role="alert" className="text-sm font-medium text-destructive">
            Escolha pelo menos um destino, ou desligue o aviso.
          </p>
        )}
      </fieldset>
      {doGasto && (
        <p className={`mt-3 text-sm ${texto2}`}>
          É um aviso de valor, não de um problema a resolver: não tem &quot;se ninguém resolver&quot;. O KDS e o Atendimento não recebem aviso de gasto.
        </p>
      )}
      <fieldset className="mt-3 space-y-2 rounded-lg border border-border p-3" hidden={doGasto}>
        <legend className="px-1 text-sm font-bold">Se ninguém resolver</legend>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Depois de
          <select
            className="min-h-10 max-w-full rounded-md border border-input bg-background px-2"
            value={escalaMin ?? ''}
            onChange={(e) => setEscalaMin(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">não avisar mais ninguém</option>
            {TEMPOS_DA_ESCALA.map((m) => (
              <option key={m} value={m}>
                {nomeDoTempo(m)}
              </option>
            ))}
          </select>
        </label>
        {escalaMin !== null && (
          <div className="space-y-1">
            <p className={`text-sm ${texto2}`}>avisar também:</p>
            {(['gerente', 'presidente'] as Destino[]).map((d) => (
              <label key={d} className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={escalaPara.includes(d)} onChange={() => setEscalaPara((l) => virar(l, d))} />
                {nomes[d]}
              </label>
            ))}
            {semQuem && (
              <p role="alert" className="text-sm font-medium text-destructive">
                Escolha quem fica sabendo se ninguém resolver.
              </p>
            )}
          </div>
        )}
      </fieldset>
      <p className={`mt-3 text-xs ${texto2}`}>
        Pelo WhatsApp, o aviso chega a quem ligou o próprio número em Pessoas e não respondeu PARAR AVISOS. Sem gerente ligado na loja, o aviso do gerente vai ao
        presidente.
      </p>
    </Gaveta>
  );
}

export function AvisosDoMister() {
  const [dados, setDados] = useState<DaTela | null>(null);
  const [erroLeitura, setErroLeitura] = useState(false);
  const [salvos, setSalvos] = useState<Valores>({});
  const [valores, setValores] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [mudando, setMudando] = useState<AvisoNaTela | null>(null);
  // Os valores do alerta de gasto (G2): a gaveta própria; "Aplicar" leva para a barra de "Salvar".
  const [editandoValores, setEditandoValores] = useState<AvisoNaTela | null>(null);
  const [relatorios, setRelatorios] = useState<RelatorioNaTela[] | null>(null);
  const [conversa, setConversa] = useState<Conversa | null>(null);
  // M5e: a versão 5 está ligada nesta instalação? (Desligada, o resumo segue só por escrito; o ajuste diz isso.)
  const [resumoLigado, setResumoLigado] = useState<boolean | null>(null);
  // V7e: a gaveta "Ver como funciona" das análises mais profundas.
  const [vendoAnalises, setVendoAnalises] = useState(false);
  // V7e: ligar o que gasta a chave de IA pede a confirmação, com o preço (o "Ligar e salvar?" do protótipo).
  const [confirmandoCusto, setConfirmandoCusto] = useState(false);

  // Cada parte (avisos e relatórios) troca só os SEUS valores: salvar uma e falhar a outra mantém a pendência da que falhou.
  const aplicar = useCallback((d: DaTela) => {
    const v: Valores = {};
    for (const a of d.avisos) v[a.tipo] = paraValor(a.regra);
    setDados(d);
    setSalvos((s) => ({ ...s, ...v }));
    setValores((x) => ({ ...x, ...v }));
  }, []);
  const aplicarRelatorios = useCallback((rs: RelatorioNaTela[]) => {
    const v: Valores = {};
    for (const r of rs) v[REL + r.tipo] = paraValorDoRelatorio(r.regra);
    setRelatorios(rs);
    setSalvos((s) => ({ ...s, ...v }));
    setValores((x) => ({ ...x, ...v }));
  }, []);
  const aplicarConversa = useCallback((c: Conversa, disponivel?: { resumoEmArquivo?: boolean }) => {
    const v = paraValorDaConversa(c);
    const r = formaDoResumo(c.resumoEntrega);
    setConversa(c);
    if (disponivel) setResumoLigado(disponivel.resumoEmArquivo === true);
    const voz = c.responderAudio === true ? '1' : '0';
    const analises = c.analisesProfundas === true ? '1' : '0';
    setSalvos((s) => ({ ...s, [CONV]: v, [CONV_RESUMO]: r, [CONV_VOZ]: voz, [CONV_ANALISES]: analises }));
    setValores((x) => ({ ...x, [CONV]: v, [CONV_RESUMO]: r, [CONV_VOZ]: voz, [CONV_ANALISES]: analises }));
  }, []);

  const ler = useCallback(async () => {
    setErroLeitura(false);
    try {
      const [d, r, c] = await Promise.all([
        api.get('/mister/avisos'),
        api.get('/mister/relatorios'),
        // Os ajustes da conversa: se a leitura falhar, o grupo não aparece (os avisos seguem).
        api.get('/mister/conversa').catch(() => null),
      ]);
      aplicar(d as DaTela);
      aplicarRelatorios(((r as { relatorios?: RelatorioNaTela[] })?.relatorios ?? []) as RelatorioNaTela[]);
      const lida = c as { conversa?: Conversa; disponivel?: { resumoEmArquivo?: boolean } } | null;
      if (lida?.conversa) aplicarConversa(lida.conversa, lida.disponivel);
    } catch {
      setErroLeitura(true);
    }
  }, [aplicar, aplicarRelatorios, aplicarConversa]);

  useEffect(() => {
    void ler();
  }, [ler]);

  const nomes = useMemo(() => Object.fromEntries((dados?.destinos ?? []).map((d) => [d.id, d.nome])) as Record<Destino, string>, [dados]);

  const grupos: GrupoDeAjustes[] = useMemo(() => {
    if (!dados) return [];
    const porGrupo = new Map<string, AvisoNaTela[]>();
    for (const a of dados.avisos) porGrupo.set(a.grupo, [...(porGrupo.get(a.grupo) ?? []), a]);
    const dosAvisos: GrupoDeAjustes[] = [...porGrupo.entries()].map(([titulo, avisos]) => ({
      titulo,
      itens: avisos.map((a) => {
        const r = deValor(valores[a.tipo]);
        return {
          id: a.tipo,
          rotulo: a.titulo,
          tipo: 'livre' as const,
          palavras: `${a.descricao} ${r.destinos.map((d) => nomes[d]).join(' ')}`,
          ajuda: (
            <>
              <span className="block">{a.descricao}</span>
              {!a.jaFunciona && (
                <span className="mt-1 block">
                  <Selo tom="info">chega numa próxima entrega</Selo> <span className="text-xs">O que você escolher já fica guardado.</span>
                </span>
              )}
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs">Vai para:</span>
                {r.destinos.length ? (
                  r.destinos.map((d) => <Selo key={d}>{nomes[d] ?? d}</Selo>)
                ) : (
                  <Selo tom="aviso">nenhum destino</Selo>
                )}
                {r.escalaMin !== null && r.escalaPara.length > 0 && (
                  <span className="text-xs">
                    · sem resolver em {nomeDoTempo(r.escalaMin)}: {r.escalaPara.map((d) => nomes[d] ?? d).join(', ')}
                  </span>
                )}
                <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={() => setMudando(a)} aria-label={`Mudar para onde vai: ${a.titulo}`}>
                  Mudar
                </Button>
              </span>
              {a.tipo === 'gasto_whatsapp' && (
                <span className="mt-2 flex flex-wrap items-center gap-1.5" data-valores-do-gasto>
                  <span className="text-xs">Valores:</span>
                  {(r.valores ?? []).length ? (
                    (r.valores ?? []).map((v) => (
                      <Selo key={v} tom="info">
                        R$ {textoDoValor(v)}
                      </Selo>
                    ))
                  ) : (
                    <Selo tom={r.ligado ? 'aviso' : 'neutro'}>nenhum valor</Selo>
                  )}
                  <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={() => setEditandoValores(a)} aria-label="Mudar os valores do alerta de gasto">
                    Valores
                  </Button>
                </span>
              )}
            </>
          ),
          desenhar: (v: Valor, mudar: (x: Valor) => void) => {
            const atual = deValor(v);
            return (
              <span className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                {a.tipo === 'pedido_parado' && (
                  <label className="flex items-center gap-1 text-sm">
                    <span className="sr-only">Tempo do pedido parado</span>
                    <select
                      className="min-h-10 rounded-md border border-input bg-background px-2"
                      value={atual.parametro ?? 20}
                      onChange={(e) => mudar(paraValor({ ...atual, parametro: Number(e.target.value) }))}
                    >
                      {[15, 20, 30].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {a.tipo === 'boleto_vencendo' && (
                  <label className="flex items-center gap-1 text-sm">
                    <span className="sr-only">Quando avisar do boleto</span>
                    <select
                      className="min-h-10 max-w-full rounded-md border border-input bg-background px-2"
                      value={atual.parametro ?? 3}
                      onChange={(e) => mudar(paraValor({ ...atual, parametro: Number(e.target.value) }))}
                    >
                      {ANTECEDENCIAS_DO_BOLETO.map((x) => (
                        <option key={x.v} value={x.v}>
                          {x.rotulo}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {a.tipo === 'ponto_esquecido' && (
                  <label className="flex items-center gap-1 text-sm">
                    <span className="sr-only">Quando avisar do ponto esquecido</span>
                    <select
                      className="min-h-10 max-w-full rounded-md border border-input bg-background px-2"
                      value={atual.parametro ?? 0}
                      onChange={(e) => mudar(paraValor({ ...atual, parametro: Number(e.target.value) }))}
                    >
                      {QUANDO_DO_PONTO.map((x) => (
                        <option key={x.v} value={x.v}>
                          {x.rotulo}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Chave
                  ligada={atual.ligado}
                  rotulo={`Aviso ${a.titulo}`}
                  aoMudar={(l) => {
                    mudar(paraValor({ ...atual, ligado: l }));
                    // Ligar o alerta de gasto sem valor: a gaveta dos valores abre (com a sugestão) — sem valor ele não salva.
                    if (l && a.tipo === 'gasto_whatsapp' && !(atual.valores ?? []).length) setEditandoValores(a);
                  }}
                />
              </span>
            );
          },
        };
      }),
    }));
    const doGrupo: GrupoDeAjustes | null = !relatorios?.length ? null : {
      titulo: 'Relatórios',
      nota: (
        <span className={`text-sm ${texto2}`}>
          O resumo do dia e o da semana usam a IA: cada um soma no &quot;Uso da IA&quot;. O de fichas novas só conta: não usa a IA. O resumo chega pelo WhatsApp a
          quem ligou o próprio número em Pessoas. Quem não falou com o Mister nas últimas 24 horas recebe antes um convite pelo modelo de mensagem aprovado
          pela Meta, e o resumo é feito quando a pessoa toca em &quot;Ver resumo&quot;.
        </span>
      ),
      itens: relatorios.map((rel) => ({
        id: REL + rel.tipo,
        rotulo: rel.titulo,
        tipo: 'livre' as const,
        palavras: `${rel.descricao} resumo relatório`,
        ajuda: (
          <>
            <span className="block">{rel.descricao}</span>
            {rel.vaiPara && (
              <span className="mt-1 block text-xs" data-relatorio-vai-para>
                Vai para: {rel.vaiPara}.
              </span>
            )}
            {rel.ultimo && (
              <span className="mt-1 block text-xs">
                {rel.ultimo.situacao === 'enviado'
                  ? `Último: saiu em ${quandoFoi(rel.ultimo.em)}.`
                  : rel.ultimo.situacao === 'fazendo' || rel.ultimo.motivo === 'fazendo_no_toque'
                    ? 'Saindo agora.'
                    : rel.ultimo.motivo === 'convite_enviado'
                      ? `Último: em ${quandoFoi(rel.ultimo.em)} foi o convite pelo WhatsApp (fora das 24 horas). O resumo sai quando a pessoa tocar em "Ver resumo".`
                      : `Último: não saiu em ${quandoFoi(rel.ultimo.em)} — ${MOTIVO_DO_RELATORIO[rel.ultimo.motivo ?? ''] ?? 'não deu para fazer'}.`}
              </span>
            )}
          </>
        ),
        desenhar: (v: Valor, mudar: (x: Valor) => void) => {
          const atual = deValorDoRelatorio(v);
          return (
            <span className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
              {rel.tipo === 'resumo_semana' && (
                <label className="flex items-center gap-1 text-sm">
                  <span className="sr-only">Dia do {rel.titulo.toLowerCase()}</span>
                  <select
                    className="min-h-10 rounded-md border border-input bg-background px-2"
                    value={atual.diaSemana ?? 1}
                    onChange={(e) => mudar(paraValorDoRelatorio({ ...atual, diaSemana: Number(e.target.value) }))}
                  >
                    {DIAS_DA_SEMANA.map((d, i) => (
                      <option key={d} value={i + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-1 text-sm">
                <span className="sr-only">Horário do {rel.titulo.toLowerCase()}</span>
                <input
                  type="time"
                  className="min-h-10 rounded-md border border-input bg-background px-2"
                  value={atual.hora}
                  required
                  onChange={(e) => e.target.value && mudar(paraValorDoRelatorio({ ...atual, hora: e.target.value }))}
                />
              </label>
              <Chave ligada={atual.ligado} rotulo={rel.titulo} aoMudar={(l) => mudar(paraValorDoRelatorio({ ...atual, ligado: l }))} />
            </span>
          );
        },
      })).concat(
        // Versão 5, M5e (mig 462): "Como mandar o resumo" — guardado nos ajustes da conversa; só com eles lidos.
        conversa
          ? [
              {
                id: CONV_RESUMO,
                rotulo: 'Como mandar o resumo',
                tipo: 'livre' as const,
                palavras: 'resumo pdf link gráficos arquivo botões como mandar',
                ajuda: (
                  <>
                    <span className="block">
                      O texto vai sempre. Os botões trazem o PDF ou o link de visualização, que vale 7 dias e só mostra aquele resumo. O PDF e os gráficos só
                      saem para quem vê os relatórios de vendas; para os outros, só o texto.
                    </span>
                    {resumoLigado === false && (
                      <span className="mt-1 block" data-resumo-em-arquivo-desligado>
                        <Selo tom="info">ainda não ligado no Regem: o resumo segue só por escrito</Selo>
                      </span>
                    )}
                  </>
                ),
                desenhar: (v: Valor, mudar: (x: Valor) => void) => (
                  <label className="flex w-full items-center justify-start gap-1 text-sm md:justify-end">
                    <span className="sr-only">Como mandar o resumo</span>
                    <select className="min-h-10 max-w-full rounded-md border border-input bg-background px-2" value={formaDoResumo(v)} onChange={(e) => mudar(formaDoResumo(e.target.value))}>
                      {FORMAS_DO_RESUMO.map((f) => (
                        <option key={f.v} value={f.v}>
                          {f.rotulo}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              },
            ]
          : [],
      ),
    };
    // A conversa (versão 3, M3a parte 3): o primeiro ajuste é o dos documentos por foto.
    const daConversa: GrupoDeAjustes | null = !conversa
      ? null
      : {
          titulo: 'Conversa',
          nota: <span className={`text-sm ${texto2}`}>Como o Mister lê e responde.</span>,
          itens: [
            {
              id: CONV,
              rotulo: 'Lançar boletos por foto',
              tipo: 'livre' as const,
              palavras: 'boleto conta foto documento contas a pagar código de barras lançar',
              ajuda: (
                <>
                  <span className="block">
                    Mande a foto ou o PDF de um boleto ou de uma conta para o Mister: ele lê, confere pelo código de barras e lança nas contas a pagar.
                    Sozinho, só o boleto cujo código confere e de fornecedor já cadastrado, sempre com &quot;Desfazer&quot;; o resto ele pergunta antes.
                  </span>
                  <span className="mt-1 block text-xs">Por enquanto, só o presidente manda. Cada foto usa a IA e soma no &quot;Uso da IA&quot;.</span>
                  <span className="mt-1 block">
                    <Selo tom="info">a leitura da nota do fornecedor vem numa próxima entrega</Selo>
                  </span>
                </>
              ),
              desenhar: (v: Valor, mudar: (x: Valor) => void) => {
                const atual = deValorDaConversa(v);
                return (
                  <span className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                    <label className="flex items-center gap-1 text-sm">
                      <span className="sr-only">Como lançar o boleto</span>
                      <select
                        className="min-h-10 max-w-full rounded-md border border-input bg-background px-2"
                        value={atual.documentosModo}
                        onChange={(e) => mudar(paraValorDaConversa({ ...atual, documentosModo: e.target.value === 'perguntar' ? 'perguntar' : 'sozinho' }))}
                      >
                        {MODOS_DO_BOLETO.map((m) => (
                          <option key={m.v} value={m.v}>
                            {m.rotulo}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Chave ligada={atual.documentosLigado} rotulo="Lançar boletos por foto" aoMudar={(l) => mudar(paraValorDaConversa({ ...atual, documentosLigado: l }))} />
                  </span>
                );
              },
            },
            // Versão 5, M5c (mig 462): "Responder em áudio" — nasce desligado; a voz do Google pelo DMS Graph.
            {
              id: CONV_VOZ,
              rotulo: 'Responder em áudio',
              tipo: 'livre' as const,
              palavras: 'áudio voz nota de voz falar responder ouvir',
              ajuda: (
                <>
                  <span className="block">
                    Quando a pessoa manda áudio, o Mister responde em texto e também numa nota de voz com o principal (uns 40 segundos). A voz é a do Google,
                    pelo DMS Graph. Cada resposta em áudio conta uma na franquia de fotos e áudios do Graph.
                  </span>
                  {resumoLigado === false && (
                    <span className="mt-1 block" data-resposta-em-audio-desligada>
                      <Selo tom="info">ainda não ligado no Regem: a resposta segue só em texto</Selo>
                    </span>
                  )}
                </>
              ),
              desenhar: (v: Valor, mudar: (x: Valor) => void) => (
                <span className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  <Chave ligada={v === '1'} rotulo="Responder em áudio" aoMudar={(l) => mudar(l ? '1' : '0')} />
                </span>
              ),
            },
          ],
        };
    // Versão 7, V7e (V7-7, mig 490): "Análises mais profundas" — nasce desligada, com o preço ao lado.
    const dasAnalises: GrupoDeAjustes | null = !conversa
      ? null
      : {
          titulo: 'Análises',
          itens: [
            {
              id: CONV_ANALISES,
              rotulo: 'Análises mais profundas',
              tipo: 'livre' as const,
              palavras: 'análises profundas modelo maior bi semana pico fases do mês perdas',
              ajuda: (
                <>
                  <span className="block">Usa o modelo maior só para escrever as respostas de análise: semana, pico, fases do mês e perdas. O resto continua como hoje.</span>
                  <span className="mt-1 block text-xs font-semibold" data-preco-das-analises>
                    {PRECO_DAS_ANALISES}
                  </span>
                  <button type="button" className="inline-flex min-h-11 items-center text-sm font-semibold underline" onClick={() => setVendoAnalises(true)}>
                    Ver como funciona
                  </button>
                </>
              ),
              desenhar: (v: Valor, mudar: (x: Valor) => void) => (
                <span className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  <span className={`text-sm ${texto2}`}>{v === '1' ? 'Ligada' : 'Desligada'}</span>
                  <Chave ligada={v === '1'} rotulo="Análises mais profundas" aoMudar={(l) => mudar(l ? '1' : '0')} />
                </span>
              ),
            },
          ],
        };
    return [...dosAvisos, ...(doGrupo ? [doGrupo] : []), ...(daConversa ? [daConversa] : []), ...(dasAnalises ? [dasAnalises] : [])];
  }, [dados, valores, nomes, relatorios, conversa, resumoLigado]);

  const salvar = async () => {
    if (!dados) return;
    setSalvando(true);
    setErro('');
    try {
      const regras = dados.avisos.filter((a) => valores[a.tipo] !== salvos[a.tipo]).map((a) => ({ tipo: a.tipo, ...deValor(valores[a.tipo]) }));
      const rels = (relatorios ?? [])
        .filter((r) => valores[REL + r.tipo] !== salvos[REL + r.tipo])
        .map((r) => ({ tipo: r.tipo, ...deValorDoRelatorio(valores[REL + r.tipo]) }));
      // A conversa grava só o que mudou (o ausente mantém o salvo): os documentos por foto e/ou "Como mandar o resumo".
      const partesDaConversa = {
        ...(conversa && valores[CONV] !== salvos[CONV] ? deValorDaConversa(valores[CONV]) : {}),
        ...(conversa && valores[CONV_RESUMO] !== salvos[CONV_RESUMO] ? { resumoEntrega: formaDoResumo(valores[CONV_RESUMO]) } : {}),
        ...(conversa && valores[CONV_VOZ] !== salvos[CONV_VOZ] ? { responderAudio: valores[CONV_VOZ] === '1' } : {}),
        ...(conversa && valores[CONV_ANALISES] !== salvos[CONV_ANALISES] ? { analisesProfundas: valores[CONV_ANALISES] === '1' } : {}),
      };
      const conv = Object.keys(partesDaConversa).length ? partesDaConversa : null;
      if (regras.length) aplicar((await api.patch('/mister/avisos', { regras })) as DaTela);
      if (rels.length) aplicarRelatorios(((await api.patch('/mister/relatorios', { relatorios: rels })) as { relatorios: RelatorioNaTela[] }).relatorios);
      if (conv) {
        const r = (await api.patch('/mister/conversa', conv)) as { conversa: Conversa; disponivel?: { resumoEmArquivo?: boolean } };
        aplicarConversa(r.conversa, r.disponivel);
      }
      toast.success(
        regras.length ? 'Avisos do Mister salvos.' : rels.length ? 'Relatórios do Mister salvos.' : conv ? 'Ajustes da conversa salvos.' : 'Nada para salvar.',
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para salvar.');
    } finally {
      setSalvando(false);
    }
  };

  if (erroLeitura)
    return (
      <Card className="p-8 text-center">
        <p className="font-display text-lg font-semibold">Não consegui ler os avisos agora</p>
        <button type="button" className="mt-2 inline-flex min-h-11 items-center font-semibold underline" onClick={() => void ler()}>
          Tentar de novo
        </button>
      </Card>
    );
  if (!dados) return <SkeletonList rows={4} />;

  return (
    <div className="space-y-4">
      <Ajustes
        id="mister-avisos"
        titulo="Avisos e relatórios"
        grupos={grupos}
        valores={valores}
        salvos={salvos}
        aoMudar={(k: string, v: Valor) => setValores((x) => ({ ...x, [k]: v }))}
        aoSalvar={() => {
          if (conversa && valores[CONV_ANALISES] === '1' && salvos[CONV_ANALISES] !== '1') setConfirmandoCusto(true);
          else void salvar();
        }}
        aoDescartar={() => {
          setValores(salvos);
          setErro('');
        }}
        salvando={salvando}
        erro={erro}
        antes={
          <p className={`text-sm ${texto2}`}>
            Cada aviso vai para quem resolve: o que a equipe resolve aparece na tela da loja e no KDS; o que pede o gestor vai pelo WhatsApp do Mister; o técnico vai
            ao suporte da DMS. Os destinos abaixo são o ponto de partida e mudam em &quot;Mudar&quot;.
          </p>
        }
      />
      {vendoAnalises && <GavetaDasAnalises aoFechar={() => setVendoAnalises(false)} />}
      {confirmandoCusto && (
        <Dialogo
          titulo="Ligar e salvar?"
          aoFechar={() => setConfirmandoCusto(false)}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setConfirmandoCusto(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmandoCusto(false);
                  void salvar();
                }}
              >
                Ligar e salvar
              </Button>
            </>
          }
        >
          <p className="text-sm">Este ajuste passa a gastar a chave de IA da empresa:</p>
          <p className="mt-2 text-sm">
            <b>Análises mais profundas:</b> {PRECO_DAS_ANALISES.charAt(0).toLowerCase() + PRECO_DAS_ANALISES.slice(1)}.
          </p>
          <p className={`mt-2 text-xs ${texto2}`}>Você pode desligar quando quiser, aqui mesmo. A mudança fica na auditoria.</p>
        </Dialogo>
      )}
      {editandoValores && (
        <GavetaDosValores
          valores={deValor(valores[editandoValores.tipo]).valores ?? []}
          aoFechar={() => setEditandoValores(null)}
          aoAplicar={(v) => {
            setValores((x) => ({ ...x, [editandoValores.tipo]: paraValor({ ...deValor(x[editandoValores.tipo]), valores: v }) }));
            setEditandoValores(null);
          }}
        />
      )}
      {mudando && (
        <GavetaDoDestino
          aviso={mudando}
          regra={deValor(valores[mudando.tipo])}
          nomes={nomes}
          aoFechar={() => setMudando(null)}
          aoAplicar={(r) => {
            setValores((x) => ({ ...x, [mudando.tipo]: paraValor(r) }));
            setMudando(null);
          }}
        />
      )}
    </div>
  );
}
