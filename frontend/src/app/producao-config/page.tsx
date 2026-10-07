'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import { Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Parte = 'ajustes' | 'setores';
const PERIODOS_SENHA = [
  { v: 'diario', rotulo: 'Diário' },
  { v: 'semanal', rotulo: 'Semanal' },
  { v: 'nunca', rotulo: 'Sem reset' },
];
const CHAVES_DO_KDS = ['verdeAteMin', 'amareloAteMin', 'usaPreparo', 'usaEntregue'];
const tipoDe = (e: any) => (e.tipo === 'impressora' ? 'Impressora' : 'KDS');
const ID_SETORES = 'setores-titulo';

// Configurações → Produção & KDS (mockup `mockups/regem-configuracoes.html`). Duas partes:
//  • Ajustes do KDS — cores por tempo, etapas, reinício da senha e momento da impressão. Um só
//    "Salvar alterações": cada grupo grava na sua rota, e só o que mudou.
//  • Destino por setor — para onde vai a produção de cada setor (lista; edição na gaveta).
export default function ProducaoConfigPage() {
  const router = useRouter();
  const [parte, setParte] = useState<Parte>('ajustes');
  const [setores, setSetores] = useState<any[] | null>(null);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [destinosPorSetor, setDestinosPorSetor] = useState<Record<string, string[]>>({});
  const [salvos, setSalvos] = useState<Valores>({});
  const [valores, setValores] = useState<Valores>({});
  const [erroCarga, setErroCarga] = useState('');
  // Quais leituras de ajuste deram certo (cada grupo tem a sua rota, com a sua permissão).
  const [fontes, setFontes] = useState({ cores: false, senha: false, delivery: false });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState<any | null>(null);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroTipo, setFiltroTipo] = useState('');

  const reload = useCallback(async () => {
    setErroCarga('');
    try {
      // Leitura de ajuste que falha NÃO vira valor padrão: um padrão na tela seria salvo por cima
      // do que está gravado. O grupo dela simplesmente não aparece (ver `fontes`).
      const naoVeio = Symbol('nao veio');
      const ler = (x: Promise<unknown>) => x.catch(() => naoVeio);
      const [ss, eq, cor, sc, dc] = await Promise.all([
        api.setores(),
        api.equipamentos().catch(() => []),
        ler(api.kdsCores()),
        ler(api.senhaConfig()),
        ler(api.deliveryConfig()),
      ]);
      const r: Valores = {};
      if (cor !== naoVeio) {
        r.verdeAteMin = (cor as any)?.verdeAteMin ?? 5;
        r.amareloAteMin = (cor as any)?.amareloAteMin ?? 10;
        r.usaPreparo = (cor as any)?.usaPreparo ?? true;
        r.usaEntregue = (cor as any)?.usaEntregue ?? true;
      }
      if (sc !== naoVeio) r.periodo = (sc as any)?.periodo ?? 'diario';
      if (dc !== naoVeio) r.adiarProducaoAteKds = !!(dc as any)?.adiarProducaoAteKds;
      setFontes({ cores: cor !== naoVeio, senha: sc !== naoVeio, delivery: dc !== naoVeio });
      setSalvos(r);
      setValores(r);
      setEquipamentos((eq as any[]).filter((e) => e.tipo === 'kds' || e.tipo === 'impressora'));
      const mapa: Record<string, string[]> = {};
      await Promise.all(
        (ss as any[]).map(async (s) => {
          const d: any = await api.destinosSetor(s.id).catch(() => []);
          mapa[s.id] = (d as any[]).map((x) => x.equipamentoId);
        }),
      );
      setDestinosPorSetor(mapa);
      setSetores(ss as any[]);
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    void reload();
  }, [reload, router]);

  const verde = Number(valores.verdeAteMin);
  const amarelo = Number(valores.amareloAteMin);
  const faixasOk = Number.isFinite(verde) && Number.isFinite(amarelo) && verde >= 0 && verde < amarelo;
  const todosOsGrupos: (GrupoDeAjustes & { fonte: keyof typeof fontes })[] = [
    {
      fonte: 'cores',
      titulo: 'Cores do KDS por tempo',
      nota: 'Limiares em minutos desde a chegada do pedido: até verde, até amarelo, acima disso vermelho.',
      itens: [
        { id: 'verdeAteMin', rotulo: 'Verde até', tipo: 'numero', sufixo: 'min' },
        { id: 'amareloAteMin', rotulo: 'Amarelo até', tipo: 'numero', sufixo: 'min' },
      ],
      depois: (
        <div className="flex flex-wrap items-center gap-2" aria-label="Prévia das faixas de cor">
          <Selo tom="ok">0–{String(valores.verdeAteMin)} min</Selo>
          <Selo tom="aviso">{String(valores.verdeAteMin)}–{String(valores.amareloAteMin)} min</Selo>
          <Selo tom="critico">acima de {String(valores.amareloAteMin)} min</Selo>
          {!faixasOk && <span className="text-sm font-semibold" role="alert">O verde precisa terminar antes do amarelo.</span>}
        </div>
      ),
    },
    {
      fonte: 'cores',
      titulo: 'Etapas do pedido',
      nota: 'A etapa “pronto” é sempre usada.',
      itens: [
        { id: 'usaPreparo', rotulo: 'Usar “em preparo”', tipo: 'chave' },
        { id: 'usaEntregue', rotulo: 'Usar “entregue”', tipo: 'chave' },
      ],
    },
    {
      fonte: 'senha',
      titulo: 'Senha de atendimento',
      itens: [{ id: 'periodo', rotulo: 'Quando a numeração da senha reinicia', tipo: 'selecao', opcoes: PERIODOS_SENHA }],
    },
    {
      fonte: 'delivery',
      titulo: 'Impressão da produção',
      itens: [
        {
          id: 'adiarProducaoAteKds',
          rotulo: 'Imprimir a produção só ao avançar no KDS',
          ajuda: 'Por padrão a via de produção sai ao registrar o pedido. Ligado, ela sai apenas quando o pedido avança no KDS que imprime na etapa (ex.: só no despacho). Se nenhum KDS estiver com “imprimir ao avançar”, a via sai no registro mesmo (não perde o ticket).',
          tipo: 'chave',
        },
      ],
    },
  ];
  const grupos: GrupoDeAjustes[] = todosOsGrupos.filter((g) => fontes[g.fonte]);
  const semLeitura = todosOsGrupos.filter((g) => !fontes[g.fonte]).map((g) => g.titulo);

  async function salvarAjustes() {
    if (salvando) return;
    const chaves = alterados(grupos, valores, salvos);
    if (!chaves.length) return;
    if (chaves.some((k) => k === 'verdeAteMin' || k === 'amareloAteMin') && !faixasOk) {
      setErro('o verde precisa terminar antes do amarelo.');
      return;
    }
    setErro('');
    setSalvando(true);
    // Cada grupo tem a sua rota; grava só as que mudaram e guarda como salvo o que deu certo —
    // se uma falhar, só ela continua pendente.
    const feito: Valores = {};
    const falhas: string[] = [];
    const tentar = async (nome: string, chavesDoGrupo: string[], gravar: () => Promise<unknown>) => {
      if (!chaves.some((k) => chavesDoGrupo.includes(k))) return;
      try {
        await gravar();
        for (const k of chavesDoGrupo) feito[k] = valores[k];
      } catch (e) {
        falhas.push(`${nome} (${e instanceof Error ? e.message : 'erro'})`);
      }
    };
    await tentar('cores e etapas', CHAVES_DO_KDS, () =>
      api.setKdsCores({ verdeAteMin: verde, amareloAteMin: amarelo, usaPreparo: !!valores.usaPreparo, usaEntregue: !!valores.usaEntregue }));
    await tentar('reinício da senha', ['periodo'], () => api.setSenhaPeriodo(String(valores.periodo)));
    // Só o campo desta tela: a configuração do delivery tem dezenas de outros, de outra tela.
    await tentar('impressão da produção', ['adiarProducaoAteKds'], () => api.setDeliveryConfig({ adiarProducaoAteKds: !!valores.adiarProducaoAteKds }));
    setSalvos((s) => ({ ...s, ...feito }));
    setSalvando(false);
    if (falhas.length) {
      setErro(falhas.join('; '));
    } else {
      toast.success('Configuração do KDS salva.');
      document.getElementById('kds-titulo')?.focus(); // a barra de salvar (e o botão) sai da tela
    }
  }

  if (erroCarga)
    return (
      <Shell eyebrow="Configurações" title="Produção & KDS">
        <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
          <span role="alert">{erroCarga}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>Tentar de novo</Button>
        </Card>
      </Shell>
    );
  if (setores === null)
    return (
      <Shell eyebrow="Configurações" title="Produção & KDS">
        <SkeletonList rows={5} />
      </Shell>
    );

  // ── parte "Destino por setor" ──
  const nomeDe = (id: string) => equipamentos.find((e) => e.id === id);
  const destinosDe = (s: any) => (destinosPorSetor[s.id] ?? []).map(nomeDe).filter(Boolean) as any[];
  const SITUACOES: Situacao<any>[] = [
    { rotulo: 'Com destino', filtro: (s) => destinosDe(s).length > 0 },
    { rotulo: 'Sem destino', filtro: (s) => destinosDe(s).length === 0, tom: 'aviso' },
  ];
  const b = semAcento(busca);
  const base = setores.filter((s) => (!b || semAcento(s.nome).includes(b)) && (!filtroTipo || destinosDe(s).some((e) => tipoDe(e) === filtroTipo)));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroTipo || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroTipo(''); setSit(-1); };
  const pendentes = alterados(grupos, valores, salvos).length;

  return (
    <Shell eyebrow="Configurações" title="Produção & KDS">
      <div className="space-y-4">
        <Partes
          rotulo="Partes de Produção & KDS"
          ativa={parte}
          aoEscolher={(p) => {
            // Trocar de parte com ajuste pendente perderia a barra de salvar de vista: avisa e fica.
            if (parte === 'ajustes' && p !== 'ajustes' && pendentes > 0) return toast.error('Salve ou descarte as alterações antes de trocar de parte.');
            setParte(p);
          }}
          partes={[
            { key: 'ajustes', label: 'Ajustes do KDS', conta: grupos.reduce((n, g) => n + g.itens.length, 0) },
            { key: 'setores', label: 'Destino por setor', conta: setores.length },
          ]}
        />

        {parte === 'ajustes' && (
          <Ajustes
            id="kds"
            titulo="Ajustes do KDS"
            grupos={grupos}
            valores={valores}
            salvos={salvos}
            aoMudar={(k: string, v: Valor) => setValores((x) => ({ ...x, [k]: v }))}
            aoSalvar={() => void salvarAjustes()}
            aoDescartar={() => { setValores(salvos); setErro(''); document.getElementById('kds-titulo')?.focus(); }}
            salvando={salvando}
            erro={erro}
            antes={
              semLeitura.length > 0 && (
                <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
                  Não deu para carregar: <b>{semLeitura.join(', ')}</b>. Esses ajustes ficam de fora desta tela (seu perfil pode não ter acesso a eles).
                </p>
              )
            }
          />
        )}

        {parte === 'setores' && (
          <section className="space-y-3" aria-labelledby={ID_SETORES}>
            <TituloLista id={ID_SETORES} titulo="Destino padrão de cada setor" total={setores.length} mostrando={linhas.length} um="setor" varios="setores" />
            <p className={`max-w-3xl text-sm ${texto2}`}>
              Para onde vai a produção de cada setor: um <strong>KDS</strong> (tela) ou uma <strong>impressora</strong> (via automática,
              cadastrada pelo servidor edge). A venda continua com <strong>1 senha</strong>; os itens do setor aparecem no destino escolhido.
            </p>
            {equipamentos.length === 0 && setores.length > 0 && (
              <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm">
                Nenhum KDS/impressora. Cadastre em Configurações → Equipamentos (as impressoras do sistema são registradas pelo servidor edge).
              </p>
            )}
            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="setores-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do setor" />
              <FiltroSelect id="setores-tipo" rotulo="Tipo de destino" todos="KDS e impressora" opcoes={['KDS', 'Impressora']} valor={filtroTipo} aoMudar={setFiltroTipo} />
            </Filtros>
            {setores.length === 0 ? (
              <Vazio>Nenhum setor cadastrado.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Destino padrão de cada setor"
                linhas={linhas}
                chave={(s) => s.id}
                nome={(s) => s.nome}
                colunas={[
                  { titulo: 'Setor', celula: (s) => <span className="font-bold">{s.nome}</span> },
                  {
                    titulo: 'Destinos',
                    celula: (s) =>
                      destinosDe(s).length ? (
                        <span className="flex flex-wrap justify-end gap-1.5 xl:justify-start">{destinosDe(s).map((e) => <Selo key={e.id} tom="info">{e.nome}</Selo>)}</span>
                      ) : (
                        <Selo tom="aviso">sem destino</Selo>
                      ),
                  },
                  { titulo: 'Quantidade', celula: (s) => <span className="font-mono">{destinosDe(s).length}</span> },
                ]}
                acoes={() => (equipamentos.length ? [{ rotulo: 'Destinos', icone: Pencil, aoClicar: setEditando, tom: 'primaria' as const }] : [])}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
          </section>
        )}
      </div>

      {editando && (
        <DestinosDoSetor
          setor={editando}
          equipamentos={equipamentos}
          marcados={destinosPorSetor[editando.id] ?? []}
          aoFechar={() => setEditando(null)}
          aoSalvar={(ids) => {
            setDestinosPorSetor((m) => ({ ...m, [editando.id]: ids }));
            setEditando(null);
          }}
        />
      )}
    </Shell>
  );
}

function DestinosDoSetor({ setor, equipamentos, marcados, aoFechar, aoSalvar }: { setor: any; equipamentos: any[]; marcados: string[]; aoFechar: () => void; aoSalvar: (ids: string[]) => void }) {
  const formId = useId();
  const [ids, setIds] = useState<string[]>(marcados);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const trocar = (id: string) => setIds((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    setErro('');
    setSalvando(true);
    try {
      await api.setDestinosSetor(setor.id, ids);
      toast.success('Direcionamento do setor salvo.');
      aoSalvar(ids);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={`Destinos do setor ${setor.nome}`}
      aoFechar={aoFechar}
      voltarPara={ID_SETORES}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar setor'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-3">
        <p className={`text-sm ${texto2}`} role="status">
          Marque os KDS e as impressoras que recebem a produção deste setor. {ids.length} de {equipamentos.length} marcados.
        </p>
        <ul className="overflow-hidden rounded-md border border-border">
          {equipamentos.map((e, i) => (
            <li key={e.id} className="border-b border-border last:border-b-0">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-secondary/60">
                <input type="checkbox" className="h-5 w-5 flex-none accent-primary" checked={ids.includes(e.id)} onChange={() => trocar(e.id)} data-foco-inicial={i === 0 ? '' : undefined} />
                <span className="min-w-0 flex-1 font-semibold">{e.nome}</span>
                <Selo tom="neutro">{tipoDe(e)}</Selo>
              </label>
            </li>
          ))}
        </ul>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}
