'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff, Pause, Pencil, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';
import { PrecoNoLugar } from '@/components/catalogo/preco-no-lugar';
import { ChipPausa } from '@/components/catalogo/chip-pausa';
import { EditarComplemento } from '@/components/catalogo/editar-complemento';
import { UltimoEnvioIfood } from '@/components/produtos/ultimo-envio-ifood';
import {
  canaisPausados, gruposDaOpcao, informativa, opcaoPausadaEmAlgumCanal, opcaoPausadaNo, opcaoSemPrecoNa99, opcaoSemPrecoNoIfood,
  type GrupoDeComplementos, type OpcaoDoGrupo,
} from '@/lib/catalogo-gestao';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ID_TITULO = 'complementos-titulo';
type Linha = OpcaoDoGrupo & { chave: string; grupoId: string; grupoNome: string };
type Canal = 'regem' | 'ifood' | '99food';
const EM_FALTA = 'Em falta: pausado em todos os canais (muda em Cadastros › Cardápio › Opções)';
const NO: Record<Canal, string> = { regem: 'no Regem', ifood: 'no iFood', '99food': 'na 99' };

// DELIVERY › GESTÃO DO CATÁLOGO › "Produtos e preços" › COMPLEMENTOS (R3 F3a/F3b; protótipo `regem-conciliacao-ifood.html`,
// "Produtos | Complementos"): cada opção do catálogo dentro de cada grupo, com o preço do Regem NESSE grupo (o lápis) e a
// pausa do Regem (balcão e cardápio digital), e — com o iFood pelo Orzuni e a 99 ligados — o preço de cada app (um por
// código, em todos os grupos) e a pausa de lá. A opção sem código PDV é informativa. Criar opção, montar o grupo, o
// código e o "Em falta" ficam em Cadastros › Cardápio › Opções.
export function ComplementosGestao({ comIfood, com99 = false, podeMudarPreco }: { comIfood: boolean; com99?: boolean; podeMudarPreco: boolean }) {
  const [grupos, setGrupos] = useState<GrupoDeComplementos[] | null>(null);
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState('');
  const [sit, setSit] = useState(-1);
  const [editando, setEditando] = useState<Linha | null>(null);
  const [ocupado, setOcupado] = useState<Set<string>>(new Set());
  const [enviados, setEnviados] = useState<Set<string>>(new Set()); // opções com mudança ao iFood nesta visita
  const [enviados99, setEnviados99] = useState<Set<string>>(new Set()); // opções com mudança à 99 nesta visita
  const leitura = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++leitura.current; // só a leitura mais nova vale (V64)
    setErro('');
    try {
      const r = await api.complementosGestao();
      if (minha !== leitura.current) return;
      setGrupos(Array.isArray(r?.grupos) ? (r.grupos as GrupoDeComplementos[]) : []);
      setBloqueio(r?.pausaBloqueada ?? null);
    } catch (e) {
      if (minha !== leitura.current) return;
      setGrupos((g) => g ?? []);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os complementos.');
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const situacoes = useMemo<Situacao<Linha>[]>(
    () => [
      { rotulo: 'Pausados em algum canal', filtro: (o) => !informativa(o) && opcaoPausadaEmAlgumCanal(o, comIfood, com99), tom: 'aviso' },
      { rotulo: 'Em falta', filtro: (o) => o.esgotado === true, tom: 'aviso' },
      ...(comIfood ? [{ rotulo: 'Sem preço no iFood', filtro: opcaoSemPrecoNoIfood, tom: 'critico' as const }] : []),
      ...(com99 ? [{ rotulo: 'Sem preço na 99', filtro: opcaoSemPrecoNa99, tom: 'critico' as const }] : []),
      { rotulo: 'Informativos (sem código PDV)', filtro: (o: Linha) => informativa(o) },
    ],
    [comIfood, com99],
  );
  useEffect(() => {
    if (sit >= situacoes.length) setSit(-1);
  }, [sit, situacoes.length]);

  // Uma mudança de canal vale para a opção em TODOS os grupos: troca em todas as linhas dela.
  const trocarOpcao = (opcaoId: string, m: Partial<OpcaoDoGrupo>) =>
    setGrupos((gs) => (gs ?? []).map((g) => ({ ...g, opcoes: g.opcoes.map((o) => (o.opcaoId === opcaoId ? { ...o, ...m } : o)) })));
  const trocarNoGrupo = (grupoId: string, opcaoId: string, m: Partial<OpcaoDoGrupo>) =>
    setGrupos((gs) =>
      (gs ?? []).map((g) => (g.id !== grupoId ? g : { ...g, opcoes: g.opcoes.map((o) => (o.opcaoId === opcaoId ? { ...o, ...m } : o)) })),
    );
  const marcar = (k: string, sim: boolean) =>
    setOcupado((s) => {
      const n = new Set(s);
      if (sim) n.add(k);
      else n.delete(k);
      return n;
    });

  async function salvarPrecoNoGrupo(l: Linha, valor: string | null) {
    const r = await api.precoDaOpcaoNoGrupo(l.grupoId, l.opcaoId, valor ?? '0');
    trocarNoGrupo(l.grupoId, l.opcaoId, { preco: r.valor });
    toast.success(r.mudou ? `"${l.nome}" em "${l.grupoNome}": preço salvo (balcão e cardápio digital).` : 'O preço já era esse.');
  }
  async function salvarPrecoIfood(l: Linha, valor: string | null) {
    const r = await api.precoDaOpcaoNoCanal(l.opcaoId, 'ifood', valor);
    trocarOpcao(l.opcaoId, { precoIfood: r.valor });
    if (!r.mudou) return void toast.success('O preço já era esse.');
    setEnviados((s) => new Set(s).add(l.opcaoId));
    toast.success(
      valor === null
        ? `"${l.nome}": preço do iFood em branco — o Regem não mexe mais no preço de lá.`
        : `Preço no iFood de "${l.nome}" salvo: vai em instantes pelo Orzuni, em todos os grupos com o código ${l.codigoPdv}.`,
    );
  }
  async function salvarPreco99(l: Linha, valor: string | null) {
    const r = await api.precoDaOpcaoNoCanal(l.opcaoId, '99food', valor);
    trocarOpcao(l.opcaoId, { preco99: r.valor });
    if (!r.mudou) return void toast.success('O preço já era esse.');
    setEnviados99((s) => new Set(s).add(l.opcaoId));
    toast.success(
      valor === null
        ? `"${l.nome}": preço da 99 em branco — o Regem não mexe mais no preço de lá.`
        : `Preço na 99 de "${l.nome}" salvo: vai em instantes a cada grupo da 99 com o código ${l.codigoPdv}.`,
    );
  }
  async function pausar(l: Linha, canal: Canal, pausado: boolean, calado = false) {
    const k = `${l.opcaoId}|${canal}`;
    marcar(k, true);
    try {
      const r = await api.pausaDaOpcaoNoCanal(l.opcaoId, canal, pausado);
      trocarOpcao(l.opcaoId, { canaisPausados: r.canaisPausados, esgotado: r.esgotado });
      if (canal === 'ifood' && r.mudou) setEnviados((s) => new Set(s).add(l.opcaoId));
      if (canal === '99food' && r.mudou) setEnviados99((s) => new Set(s).add(l.opcaoId));
      if (!calado)
        toast.success(
          canal === 'regem'
            ? `"${l.nome}" ${pausado ? 'pausado no balcão e no cardápio digital' : 'de volta ao balcão e ao cardápio digital'}, em todos os grupos.`
            : canal === 'ifood'
              ? `"${l.nome}" ${pausado ? 'pausado' : 'reativado'} no iFood: vai em instantes pelo Orzuni.`
              : `"${l.nome}" ${pausado ? 'pausado' : 'reativado'} na 99: vai em instantes à 99.`,
        );
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível mudar a pausa.');
      return false;
    } finally {
      marcar(k, false);
    }
  }
  const canais: Canal[] = ['regem', ...(comIfood ? (['ifood'] as const) : []), ...(com99 ? (['99food'] as const) : [])];
  const pausadoNoCanal = (l: Linha, k: Canal) => canaisPausados(l).includes(k);
  const tudoPausado = (l: Linha) => canais.every((k) => pausadoNoCanal(l, k));
  async function pausarTudo(l: Linha) {
    const pausado = !tudoPausado(l);
    const oks = await Promise.all(canais.filter((k) => pausadoNoCanal(l, k) !== pausado).map((k) => pausar(l, k, pausado, true)));
    if (oks.every(Boolean)) {
      const onde = canais.map((k) => NO[k]);
      const lista = onde.length > 1 ? `${onde.slice(0, -1).join(', ')} e ${onde[onde.length - 1]}` : onde[0];
      toast.success(`"${l.nome}" ${pausado ? 'pausado' : 'reativado'} ${lista}, em todos os grupos.`);
    }
  }

  if (grupos === null) return <SkeletonList rows={5} />;

  const linhasTodas: Linha[] = grupos.flatMap((g) =>
    g.opcoes.map((o) => ({ ...o, chave: `${g.id}|${o.opcaoId}`, grupoId: g.id, grupoNome: g.nome })),
  );
  const b = semAcento(busca.trim());
  const base = linhasTodas.filter(
    (l) => (!b || semAcento(`${l.nome} ${l.codigoPdv ?? ''}`).includes(b)) && (!grupo || l.grupoId === grupo),
  );
  const linhas = sit < 0 || !situacoes[sit] ? base : base.filter(situacoes[sit].filtro);
  const filtrando = !!(busca.trim() || grupo || sit >= 0);
  const limpar = () => {
    setBusca('');
    setGrupo('');
    setSit(-1);
  };
  const nOpcoes = new Set(linhasTodas.map((l) => l.opcaoId)).size;
  const nPausados = new Set(linhasTodas.filter((l) => !informativa(l) && opcaoPausadaEmAlgumCanal(l, comIfood, com99)).map((l) => l.opcaoId)).size;
  const usadoEm = (g: GrupoDeComplementos) =>
    g.produtos.length ? `em ${g.produtos.slice(0, 3).map((p) => p.nome).join(', ')}${g.produtos.length > 3 ? ` e mais ${g.produtos.length - 3}` : ''}` : 'em nenhum produto';
  const grupoPorId = new Map(grupos.map((g) => [g.id, g]));
  const desligado = (l: Linha) => (l.esgotado ? EM_FALTA : bloqueio);

  const colunaRegem = (l: Linha) => {
    if (informativa(l)) return <span className={`text-xs ${texto2}`}>vai como observação, sem preço</span>;
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 xl:justify-start">
        <PrecoNoLugar valor={l.preco} qual={`em ${l.grupoNome}`} nome={l.nome} zeroVale podeEditar={podeMudarPreco} aoSalvar={(v) => salvarPrecoNoGrupo(l, v)} />
        <ChipPausa
          pausado={opcaoPausadaNo(l, 'regem')}
          onde="no Regem"
          nome={l.nome}
          ocupado={ocupado.has(`${l.opcaoId}|regem`)}
          desligado={desligado(l)}
          aoMudar={() => void pausar(l, 'regem', !pausadoNoCanal(l, 'regem'))}
        />
      </span>
    );
  };
  const colunaIfood = (l: Linha) => {
    if (informativa(l)) return <span className={`text-xs ${texto2}`}>sem código PDV: não liga ao iFood</span>;
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 xl:justify-start">
        <PrecoNoLugar valor={l.precoIfood} qual="no iFood" nome={l.nome} permiteVazio zeroVale podeEditar={podeMudarPreco} aoSalvar={(v) => salvarPrecoIfood(l, v)} />
        <ChipPausa
          pausado={opcaoPausadaNo(l, 'ifood')}
          onde="no iFood"
          nome={l.nome}
          ocupado={ocupado.has(`${l.opcaoId}|ifood`)}
          desligado={desligado(l)}
          aoMudar={() => void pausar(l, 'ifood', !pausadoNoCanal(l, 'ifood'))}
        />
        {enviados.has(l.opcaoId) && (
          <span className="block w-full min-w-0 text-left">
            <UltimoEnvioIfood alvo="opcao" id={l.opcaoId} />
          </span>
        )}
      </span>
    );
  };
  const coluna99 = (l: Linha) => {
    if (informativa(l)) return <span className={`text-xs ${texto2}`}>sem código PDV: não liga à 99</span>;
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 xl:justify-start">
        <PrecoNoLugar valor={l.preco99} qual="na 99" nome={l.nome} permiteVazio zeroVale podeEditar={podeMudarPreco} aoSalvar={(v) => salvarPreco99(l, v)} />
        <ChipPausa
          pausado={opcaoPausadaNo(l, '99food')}
          onde="na 99"
          nome={l.nome}
          ocupado={ocupado.has(`${l.opcaoId}|99food`)}
          desligado={desligado(l)}
          aoMudar={() => void pausar(l, '99food', !pausadoNoCanal(l, '99food'))}
        />
        {enviados99.has(l.opcaoId) && (
          <span className="block w-full min-w-0 text-left">
            <UltimoEnvioIfood alvo="opcao" id={l.opcaoId} canal="99food" />
          </span>
        )}
      </span>
    );
  };
  const apps = [comIfood && 'iFood', com99 && '99'].filter(Boolean) as string[];

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista
        id={ID_TITULO}
        titulo="Complementos"
        total={linhasTodas.length}
        mostrando={linhas.length}
        um="complemento"
        varios="complementos"
        extra={`${nOpcoes} opç${nOpcoes === 1 ? 'ão' : 'ões'} em ${grupos.length} grupo${grupos.length === 1 ? '' : 's'} · ${nPausados} pausada${nPausados === 1 ? '' : 's'} em algum canal`}
      />
      <p className={`text-sm ${texto2}`}>
        O preço do Regem é o de cada grupo; {apps.length ? `o ${apps.length > 1 ? 'do iFood e o da 99 são' : apps[0] === '99' ? 'da 99 é' : 'do iFood é'} um por código, em todos os grupos. ` : ''}A pausa vale em todos os grupos.
        Criar opção, montar o grupo, o código PDV e o &quot;Em falta&quot;: em Cadastros › Cardápio › Opções.
      </p>
      {bloqueio && (
        <p role="status" className="rounded-md border border-warn bg-warn/10 px-3 py-2 text-sm">
          {bloqueio}
        </p>
      )}
      {erro ? (
        <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
          <span role="alert">{erro}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
        </Card>
      ) : (
        <>
          <Situacoes base={base} opcoes={situacoes} valor={sit} aoMudar={setSit} />
          <Filtros>
            <FiltroBusca id="complementos-busca" valor={busca} aoMudar={setBusca} placeholder="Nome ou código" />
            <FiltroSelect
              id="complementos-grupo"
              rotulo="Grupo"
              todos="Todos"
              opcoes={grupos.map((g) => ({ v: g.id, rotulo: g.nome }))}
              valor={grupo}
              aoMudar={setGrupo}
            />
          </Filtros>
          {linhasTodas.length === 0 ? (
            <Vazio>Nenhum complemento ainda. Crie as opções e os grupos em Cadastros › Cardápio › Opções.</Vazio>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={limpar} />
          ) : (
            <ListaDados
              legenda={`Complementos por grupo, com o preço e a pausa no Regem${comIfood ? (com99 ? ', no iFood e na 99' : ' e no iFood') : com99 ? ' e na 99' : ''}`}
              linhas={linhas}
              chave={(l) => l.chave}
              nome={(l) => l.nome}
              grupoDe={(l) => {
                const g = grupoPorId.get(l.grupoId);
                return g ? `${g.nome} · ${usadoEm(g)}` : l.grupoNome;
              }}
              colunas={[
                {
                  titulo: 'Complemento',
                  celula: (l) => (
                    <span className="flex min-w-0 items-start gap-2.5">
                      {l.imagemRef ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.imagemRef} alt="" className="h-11 w-11 flex-none rounded-md object-cover" loading="lazy" />
                      ) : (
                        <span className="grid h-11 w-11 flex-none place-items-center rounded-md bg-secondary" title="Sem foto">
                          <ImageOff className={`h-4 w-4 ${texto2}`} aria-hidden="true" />
                          <span className="sr-only">Sem foto</span>
                        </span>
                      )}
                      <span className="min-w-0">
                        <NomeComApoio
                          nome={l.nome}
                          apoio={`${informativa(l) ? 'sem código PDV · informativo' : `código ${l.codigoPdv}`} · em ${gruposDaOpcao(grupos, l.opcaoId).length} grupo${gruposDaOpcao(grupos, l.opcaoId).length === 1 ? '' : 's'}`}
                        >
                          {l.esgotado && <Selo tom="aviso">Em falta</Selo>}
                        </NomeComApoio>
                      </span>
                    </span>
                  ),
                },
                { titulo: 'Regem', celula: colunaRegem },
                ...(comIfood ? [{ titulo: 'iFood', celula: colunaIfood }] : []),
                ...(com99 ? [{ titulo: '99', celula: coluna99 }] : []),
              ]}
              acoes={(l) =>
                informativa(l)
                  ? []
                  : [
                      { rotulo: 'Editar', icone: Pencil, aoClicar: setEditando, tom: 'primaria' as const },
                      {
                        rotulo: tudoPausado(l) ? 'Reativar em todos' : 'Pausar em todos',
                        icone: tudoPausado(l) ? Play : Pause,
                        aoClicar: (r: Linha) => void pausarTudo(r),
                        ocupada: (r: Linha) => !!desligado(r) || canais.some((k) => ocupado.has(`${r.opcaoId}|${k}`)),
                      },
                    ]
              }
            />
          )}
          {filtrando && linhas.length > 0 && (
            <p>
              <Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button>
            </p>
          )}
        </>
      )}

      {editando && (
        <EditarComplemento
          opcao={editando}
          grupos={gruposDaOpcao(grupos, editando.opcaoId)}
          comIfood={comIfood}
          com99={com99}
          podeMudarPreco={podeMudarPreco}
          bloqueio={bloqueio}
          voltarPara={ID_TITULO}
          aoFechar={() => setEditando(null)}
          aoSalvar={(fechar, foiAoIfood, foiA99) => {
            if (foiAoIfood) setEnviados((s) => new Set(s).add(editando.opcaoId));
            if (foiA99) setEnviados99((s) => new Set(s).add(editando.opcaoId));
            if (fechar) setEditando(null);
            void carregar();
          }}
        />
      )}
    </section>
  );
}
