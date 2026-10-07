'use client';

import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Régua de tamanhos REAIS da térmica (a impressora só amplia em passos inteiros; não há pt livre).
// Combina a fonte pequena embutida (Font B = `mini`) com a ampliação (`escala`). `pt` é aproximado
// (rótulo); `px` é o tamanho na prévia.
const NIVEIS_FONTE = [
  { i: 0, label: 'Pequena', pt: 9, mini: true, escala: 1, px: 11 },
  { i: 1, label: 'Normal', pt: 12, mini: false, escala: 1, px: 13 },
  { i: 2, label: 'Média', pt: 18, mini: true, escala: 2, px: 18 },
  { i: 3, label: 'Grande', pt: 24, mini: false, escala: 2, px: 24 },
  { i: 4, label: 'Enorme', pt: 36, mini: false, escala: 3, px: 34 },
];
// Índice do nível a partir do campo (aceita o legado tamanho='grande' == 2×).
function nivelDe(c: any): number {
  const mag = c?.escala >= 3 ? 3 : c?.escala >= 2 ? 2 : c?.tamanho === 'grande' ? 2 : 1;
  const mini = !!c?.mini;
  const m = NIVEIS_FONTE.find((n) => n.mini === mini && n.escala === mag);
  return m ? m.i : mag >= 3 ? 4 : mag === 2 ? (mini ? 2 : 3) : mini ? 0 : 1;
}

// Valores fictícios por campo, só para a prévia.
const CUPOM_MOCK: Record<string, string[]> = {
  senha: ['SENHA 12'],
  tipoFiscal: ['*** NAO FISCAL ***'],
  nomeLoja: ['REGEM'],
  dataHora: ['02/08/2026 20:15'],
  ticket: ['Ticket #A1B2'],
  vendaBalcao: ['Venda balcao'],
  operador: ['Operador: Ana'],
  itens: ['1x X-Burger', '   + bacon extra', '   OBS: sem cebola'],
  subtotal: ['Subtotal: R$ 28,00'],
  desconto: ['Desconto: -R$ 2,00'],
  totalGeral: ['TOTAL: R$ 32,00'],
  pagamento: ['Pagamento: Dinheiro', 'Troco para R$ 50,00'],
  avisoFiscal: ['Sem valor fiscal'],
  plataforma: ['iFood - pedido #4521'],
  pedidoRegem: ['Pedido Regem #101'],
  cliente: ['Joao Silva'],
  endereco: ['Rua X, 123 - Centro', 'Ap 42 - perto da praca'],
  telefone: ['(11) 90000-0000'],
  taxaEntrega: ['Entrega: R$ 6,00'],
  cobrarCliente: ['COBRAR R$ 32,00'],
  bandeiras: ['Bandeira: Visa'],
  qrcode: ['[   QR CODE   ]'],
  // campos de produção / totem / caixa
  origemPedido: ['Totem - autoatendimento'],
  mesa: ['MESA 4'],
  emitidoDe: ['Emitido: Salao 2'],
  tipoMovimento: ['*** SANGRIA ***'],
  valorMovimento: ['Valor: R$ 100,00'],
  motivo: ['Motivo: troco'],
  autorizadoPor: ['Autorizado: Gerente'],
  turno: ['Turno 1'],
  terminal: ['PDV Caixa 1'],
  aberturaValor: ['Abertura: R$ 150,00'],
  totalPorForma: ['Dinheiro: R$ 500,00', 'Cartao: R$ 800,00', 'Pix: R$ 300,00'],
  sangriasTotal: ['Sangrias: -R$ 200,00'],
  suprimentosTotal: ['Suprimentos: +R$ 50,00'],
  esperado: ['Esperado: R$ 1.300,00'],
  informado: ['Informado: R$ 1.290,00'],
  diferenca: ['Diferenca: -R$ 10,00'],
  assinatura: ['______________________'],
};

const GRUPOS: Record<string, string> = { cliente: 'Cliente', producao: 'Produção', caixa: 'Caixa' };
const grupoDe = (p: any) => GRUPOS[p.grupo] ?? 'Cliente';
const ehPseudo = (c: any) => c.key === '_espaco' || c.key === '_tracejado';
const nomeDoCampo = (c: any) => (c.key === '_espaco' ? 'Linha em branco' : c.key === '_tracejado' ? 'Linha divisória' : c.label);
const ID_TITULO = 'perfis-titulo';

/** O perfil no formato que o servidor guarda. */
function camposParaSalvar(campos: any[]) {
  return campos.map((c) => {
    const n = NIVEIS_FONTE[nivelDe(c)];
    return {
      key: c.key, visivel: c.visivel, negrito: c.negrito, alinhamento: c.alinhamento,
      ...(n.escala >= 2 ? { escala: n.escala } : {}),
      ...(n.mini ? { mini: true } : {}),
      ...(c.comp ? { comp: c.comp } : {}),
      ...(c.obs ? { obs: c.obs } : {}),
      ...(c.agrupado ? { agrupado: true } : {}),
    };
  });
}
// Impressoras do perfil: só vai quando há alguma marcada — sem nenhuma, o perfil volta ao
// roteamento padrão (as impressoras de cupom).
const padraoParaSalvar = (p: any) => ({ campos: camposParaSalvar(p.campos), ...(Array.isArray(p.impressoras) && p.impressoras.length ? { impressoras: p.impressoras } : {}) });
const customParaSalvar = (p: any) => ({ id: p.id, nome: p.nome, descricao: p.descricao, grupo: p.grupo, ...padraoParaSalvar(p) });

// Grava UM perfil. O padrão tem a sua chave no servidor, que mescla por perfil — os outros não
// são tocados. Os personalizados moram numa lista só (`_custom`): relê a lista do servidor na hora
// e troca nela apenas este perfil, para não regravar por cima o que outra pessoa acabou de salvar.
async function gravarPerfil(p: any, excluir = false) {
  if (!p.custom) {
    await api.setDeliveryConfig({ cupomPerfis: { [p.id]: padraoParaSalvar(p) } });
    return;
  }
  const fresco: any = await api.cupomPerfis();
  const atuais: any[] = (fresco?.perfis ?? []).filter((x: any) => x.custom);
  const lista = excluir ? atuais.filter((x) => x.id !== p.id) : atuais.some((x) => x.id === p.id) ? atuais.map((x) => (x.id === p.id ? p : x)) : [...atuais, p];
  await api.setDeliveryConfig({ cupomPerfis: { _custom: lista.map(customParaSalvar) } });
}

// Impressoras e cupons → Perfis de cupom (mockup `mockups/regem-configuracoes.html`): o que cada
// cupom imprime, em que ordem e em quais impressoras. Lista dos perfis; a edição (campos, ordem,
// tamanho, impressoras) é na gaveta larga, com a prévia ao lado, e grava só o perfil editado.
export function PerfisCupom({
  perfis, catalogo, impressoras, pode, recarregar,
}: {
  perfis: any[];
  /** Todos os campos que um perfil personalizado pode puxar. */
  catalogo: { key: string; label: string; grupo: string }[];
  /** `null` = a lista de impressoras não carregou: a tela conta as do perfil, sem dizer o nome. */
  impressoras: any[] | null;
  pode: boolean;
  recarregar: () => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroGrupo, setFiltroGrupo] = useState('');
  const [editando, setEditando] = useState<any | null>(null);
  const [excluindo, setExcluindo] = useState<any | null>(null);
  const [duplicando, setDuplicando] = useState<string | null>(null);

  // Impressora marcada no perfil que não existe mais não conta: o servidor a ignora e o cupom
  // volta às impressoras de cupom padrão. Sem a lista (não carregou), vale o que está gravado.
  const nomesDe = (p: any): string[] => (p.impressoras ?? []).map((id: string) => impressoras?.find((i) => i.id === id)?.nome).filter(Boolean);
  const proprias = (p: any): number => (impressoras ? nomesDe(p).length : (p.impressoras ?? []).length);
  const SITUACOES: Situacao<any>[] = [
    { rotulo: 'Padrão', filtro: (p) => !p.custom },
    { rotulo: 'Personalizados', filtro: (p) => !!p.custom },
    { rotulo: 'Com impressora própria', filtro: (p) => proprias(p) > 0 },
    { rotulo: 'No roteamento padrão', filtro: (p) => proprias(p) === 0 },
  ];
  const b = semAcento(busca);
  const base = perfis.filter((p) => (!b || semAcento(`${p.nome} ${p.descricao ?? ''}`).includes(b)) && (!filtroGrupo || grupoDe(p) === filtroGrupo));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroGrupo || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroGrupo(''); setSit(-1); };

  const novoId = () => 'custom_' + Date.now().toString(36);
  const novo = () => setEditando({ id: novoId(), nome: '', descricao: 'Cupom personalizado', grupo: 'cliente', custom: true, campos: [], _novo: true });
  async function duplicar(p: any) {
    if (duplicando) return;
    setDuplicando(p.id);
    try {
      const copia = { id: novoId(), nome: `${p.nome} (cópia)`.slice(0, 40), descricao: p.descricao, grupo: p.grupo, custom: true, campos: p.campos.map((c: any) => ({ ...c, fixo: false })), impressoras: p.impressoras };
      await gravarPerfil(copia);
      toast.success(`"${p.nome}" duplicado — abra a cópia para ajustar.`);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao duplicar');
    } finally {
      setDuplicando(null);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Perfis de cupom" total={perfis.length} mostrando={linhas.length} um="perfil" varios="perfis" extra="o que imprime, em que ordem e em quais impressoras">
        {pode && <Button type="button" onClick={novo}><Plus className="h-4 w-4" aria-hidden="true" /> Novo perfil</Button>}
      </TituloLista>
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="perfis-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do perfil" />
        <FiltroSelect id="perfis-grupo" rotulo="Grupo" todos="Todos os grupos" opcoes={distintos(perfis, grupoDe)} valor={filtroGrupo} aoMudar={setFiltroGrupo} />
      </Filtros>

      {linhas.length === 0 ? (
        <Vazio aoLimpar={filtrando ? limpar : undefined}>Nenhum perfil de cupom.</Vazio>
      ) : (
        <ListaDados
          legenda="Perfis de cupom"
          linhas={linhas}
          chave={(p) => p.id}
          nome={(p) => p.nome}
          colunas={[
            { titulo: 'Perfil', celula: (p) => <NomeComApoio nome={p.nome} apoio={p.descricao}>{p.custom && <Selo tom="info">personalizado</Selo>}</NomeComApoio> },
            { titulo: 'Grupo', celula: grupoDe },
            {
              titulo: 'Impressoras',
              celula: (p) => {
                if (!proprias(p)) return <span className={`text-xs ${texto2}`}>impressoras de cupom padrão</span>;
                if (!impressoras) return <Selo>{proprias(p) === 1 ? '1 impressora' : `${proprias(p)} impressoras`}</Selo>;
                return <span className="inline-flex flex-wrap justify-end gap-1 xl:justify-start">{nomesDe(p).map((n) => <Selo key={n}>{n}</Selo>)}</span>;
              },
            },
            {
              titulo: 'Campos no cupom',
              celula: (p) => {
                const dados = p.campos.filter((c: any) => !ehPseudo(c));
                return <span className="whitespace-nowrap font-mono">{dados.filter((c: any) => c.visivel).length} de {dados.length}</span>;
              },
            },
          ]}
          acoes={(p) =>
            pode
              ? [
                  { rotulo: 'Duplicar', icone: Copy, aoClicar: (x: any) => void duplicar(x), ocupada: () => duplicando !== null },
                  { rotulo: 'Editar', icone: Pencil, aoClicar: setEditando },
                  ...(p.custom ? [{ rotulo: 'Excluir', icone: Trash2, aoClicar: setExcluindo, tom: 'perigo' as const }] : []),
                ]
              : [{ rotulo: 'Ver', icone: Eye, aoClicar: setEditando }]
          }
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {editando && (
        <EditorPerfil perfil={editando} catalogo={catalogo} impressoras={impressoras ?? []} pode={pode} aoFechar={() => setEditando(null)}
          aoSalvar={async () => { setEditando(null); await recarregar(); }} />
      )}
      {excluindo && (
        <ExcluirPerfil
          perfil={excluindo}
          aoFechar={() => setExcluindo(null)}
          aoExcluir={async () => {
            setExcluindo(null);
            await recarregar();
            document.getElementById(ID_TITULO)?.focus(); // a linha (e o botão que abriu) saiu da lista
          }}
        />
      )}
    </section>
  );
}

const CONTROLE = 'h-10 rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
const MARCA = 'inline-flex min-h-10 items-center gap-1.5 text-sm';
const BOTAO_ICONE =
  'grid h-10 w-10 flex-none place-items-center rounded-md border border-input bg-card text-secondary-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

function EditorPerfil({
  perfil, catalogo, impressoras, pode, aoFechar, aoSalvar,
}: { perfil: any; catalogo: { key: string; label: string }[]; impressoras: any[]; pode: boolean; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const [p, setP] = useState<any>(() => ({ ...perfil, campos: perfil.campos.map((c: any) => ({ ...c })), impressoras: [...(perfil.impressoras ?? [])] }));
  const [sujo, setSujo] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [arrastando, setArrastando] = useState<number | null>(null);
  const custom = !!p.custom;
  const novo = !!perfil._novo;

  const mudar = (fn: (x: any) => any) => { setP(fn); setSujo(true); setSaindo(false); };
  const mudarCampo = (idx: number, patch: any) => mudar((x) => ({ ...x, campos: x.campos.map((c: any, i: number) => (i === idx ? { ...c, ...patch } : c)) }));
  // Estilo da sublinha do campo "itens" (complementos/observação). Ao mexer pela 1ª vez, herda o
  // estilo do campo e aplica a mudança.
  const mudarSub = (idx: number, qual: 'comp' | 'obs', patch: any) =>
    mudar((x) => ({
      ...x,
      campos: x.campos.map((c: any, i: number) => (i === idx ? { ...c, [qual]: { ...(c[qual] ?? { negrito: c.negrito, escala: c.escala, mini: c.mini }), ...patch } } : c)),
    }));
  const mover = (de: number, para: number) =>
    mudar((x) => {
      if (para < 0 || para >= x.campos.length || de === para) return x;
      const cs = [...x.campos];
      const [item] = cs.splice(de, 1);
      cs.splice(para, 0, item);
      return { ...x, campos: cs };
    });
  const incluir = (campo: any) => mudar((x) => ({ ...x, campos: [...x.campos, campo] }));
  const incluirPseudo = (key: '_espaco' | '_tracejado') =>
    incluir({ key, label: key === '_espaco' ? 'Linha em branco' : 'Linha divisória', visivel: true, negrito: false, alinhamento: key === '_espaco' ? 'esquerda' : 'centro' });
  const incluirCampo = (key: string) => {
    const c = catalogo.find((x) => x.key === key);
    if (c) incluir({ key, label: c.label, visivel: true, negrito: false, alinhamento: 'esquerda' });
  };
  const remover = (idx: number) => mudar((x) => ({ ...x, campos: x.campos.filter((_: any, i: number) => i !== idx) }));
  const alternarImpressora = (id: string) => mudar((x) => ({ ...x, impressoras: x.impressoras.includes(id) ? x.impressoras.filter((y: string) => y !== id) : [...x.impressoras, id] }));
  const disponiveis = catalogo.filter((c) => !p.campos.some((x: any) => x.key === c.key));

  // Fechar com alteração pendente pede uma segunda confirmação, no rodapé da própria gaveta.
  const pedirFechar = () => (sujo && !saindo && !salvando ? setSaindo(true) : aoFechar());

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando || !pode) return;
    if (custom && !String(p.nome).trim()) {
      setErro('Informe o nome do perfil.');
      document.getElementById('perfil-nome')?.focus();
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      await gravarPerfil({ ...p, nome: String(p.nome).trim() });
      toast.success('Perfil de cupom salvo.');
      aoSalvar();
    } catch (err) {
      // O aviso de pendente continua: nada foi gravado.
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  const previa = (() => {
    // Cada linha guarda o texto cru + estilo; alinhamento e quebra ficam no CSS da prévia.
    const out: { txt: string; bold: boolean; lvl: number; align: string; dir?: string }[] = [];
    for (const c of p.campos) {
      if (!c.visivel) continue;
      const mock = c.key === '_espaco' ? [''] : c.key === '_tracejado' ? ['-'.repeat(24)] : CUPOM_MOCK[c.key] ?? [c.label];
      // Itens: complemento/observação podem ter estilo próprio (herdam o do campo se não tiverem).
      if (c.key === 'itens') {
        const proprio = { negrito: c.negrito, escala: c.escala, mini: c.mini };
        for (const t of mock) {
          const s = t.startsWith('   OBS:') ? c.obs ?? proprio : t.startsWith('   ') ? c.comp ?? proprio : proprio;
          out.push({ txt: t, bold: !!s.negrito, lvl: nivelDe(s), align: c.alinhamento });
        }
        continue;
      }
      // Junto do de cima: divide a linha com o campo anterior (esquerda | direita).
      if (c.agrupado && out.length && mock.length === 1) {
        const anterior = out[out.length - 1];
        anterior.dir = mock[0];
        anterior.bold = anterior.bold || c.negrito;
        continue;
      }
      for (const t of mock) out.push({ txt: t, bold: c.negrito, lvl: nivelDe(c), align: c.alinhamento });
    }
    return out;
  })();

  const seletorTamanho = (rotulo: string, nivel: number, aoMudar: (n: (typeof NIVEIS_FONTE)[number]) => void) => (
    <select aria-label={rotulo} title="Tamanho da fonte" value={nivel} onChange={(e) => aoMudar(NIVEIS_FONTE[Number(e.target.value)])} className={CONTROLE}>
      {NIVEIS_FONTE.map((n) => <option key={n.i} value={n.i}>{n.label} ({n.pt})</option>)}
    </select>
  );

  return (
    <Gaveta
      larga
      titulo={novo ? 'Novo perfil de cupom' : `${pode ? 'Editar' : 'Ver'} perfil — ${perfil.nome}`}
      aoFechar={pedirFechar}
      voltarPara={ID_TITULO}
      rodape={
        !pode ? (
          <Button type="button" variant="outline" onClick={aoFechar}>Fechar</Button>
        ) : saindo ? (
          <>
            <span role="alert" className="mr-auto self-center text-sm font-medium">Há alterações ainda não salvas neste perfil.</span>
            <Button type="button" variant="outline" data-continuar onClick={() => setSaindo(false)}>Continuar editando</Button>
            <Button type="button" variant="destructive" onClick={aoFechar}>Sair sem salvar</Button>
          </>
        ) : (
          <>
            <span role="status" className={`mr-auto self-center text-sm ${texto2}`}>{sujo ? 'alterações ainda não salvas' : 'nenhuma alteração'}</span>
            <Button type="button" variant="outline" onClick={pedirFechar} disabled={salvando}>Cancelar</Button>
            <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar perfil'}</Button>
          </>
        )
      }
    >
      <form id={formId} onSubmit={salvar} noValidate className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <fieldset disabled={!pode} className="min-w-0 space-y-4">
          <legend className="sr-only">Perfil de cupom</legend>
          {custom ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="perfil-nome">Nome do perfil</Label>
                <Input id="perfil-nome" data-foco-inicial value={p.nome} maxLength={40} onChange={(e) => mudar((x) => ({ ...x, nome: e.target.value }))} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perfil-grupo">Grupo</Label>
                <Select id="perfil-grupo" value={p.grupo} onChange={(e) => mudar((x) => ({ ...x, grupo: e.target.value }))}>
                  {Object.entries(GRUPOS).map(([v, rotulo]) => <option key={v} value={v}>{rotulo}</option>)}
                </Select>
              </div>
            </div>
          ) : (
            <p className={`text-sm ${texto2}`}>{p.descricao ? `${String(p.descricao).replace(/\.\s*$/, '')}. ` : ''}Perfil padrão: o nome e o grupo não mudam.</p>
          )}

          {impressoras.length > 0 && (
            <div>
              <span className="text-sm font-medium">Impressoras deste cupom</span>
              <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Impressoras deste cupom">
                {impressoras.map((imp) => {
                  const marcada = p.impressoras.includes(imp.id);
                  const vias = imp.viasCliente ?? imp.vias;
                  return (
                    <button key={imp.id} type="button" aria-pressed={marcada} onClick={() => alternarImpressora(imp.id)}
                      className={`inline-flex min-h-10 items-center gap-1 rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        marcada ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-foreground hover:bg-secondary'
                      }`}>
                      {marcada && <span aria-hidden="true">✓</span>}
                      {imp.nome}
                      {vias ? <span className="font-mono text-xs">({vias}×)</span> : null}
                    </button>
                  );
                })}
              </div>
              <p className={`mt-1 text-xs ${texto2}`}>
                Marque em quais impressoras este cupom sai. Nenhuma marcada = usa as impressoras de cupom padrão. As vias saem da configuração de cada impressora.
              </p>
            </div>
          )}

          <div>
            <span className="text-sm font-medium">Campos do cupom, na ordem em que saem</span>
            <p className={`text-xs ${texto2}`}>Suba e desça com as setas (ou arraste pela alça). O cabeçalho e o rodapé ficam na parte “Cabeçalho e rodapé”.</p>
            {p.campos.length === 0 && <p className={`mt-2 rounded-md border border-dashed border-input px-3 py-4 text-center text-sm ${texto2}`}>Nenhum campo — adicione abaixo.</p>}
            <ol className="mt-2 space-y-1.5" aria-label="Campos do cupom">
              {p.campos.map((c: any, i: number) => {
                const nome = nomeDoCampo(c);
                const pseudo = ehPseudo(c);
                const podeRemover = custom || pseudo;
                return (
                  <li key={`${c.key}-${i}`} data-campo={c.key} onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (arrastando !== null) mover(arrastando, i); setArrastando(null); }}
                    className={`rounded-md border px-2 py-1.5 ${pseudo ? 'border-dashed border-input' : 'border-border'} ${arrastando === i ? 'opacity-50' : ''}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span draggable={pode} onDragStart={() => setArrastando(i)} onDragEnd={() => setArrastando(null)} title="Arraste para reordenar" aria-hidden="true"
                        className={`hidden flex-none cursor-grab lg:inline-flex ${texto2}`}>
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <span className={`min-w-[9rem] flex-1 text-sm ${pseudo ? `italic ${texto2}` : 'font-semibold'} ${c.visivel ? '' : 'line-through decoration-1'}`}>
                        {pseudo ? `— ${nome.toLowerCase()} —` : nome}
                        {c.fixo && <span className={`ml-1 text-xs font-normal ${texto2}`}>(sempre)</span>}
                      </span>
                      {!pseudo && (
                        <>
                          <label className={MARCA}>
                            <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!c.visivel} disabled={!!c.fixo} onChange={(e) => mudarCampo(i, { visivel: e.target.checked })} aria-label={`Mostrar ${nome} no cupom`} />
                            Mostrar
                          </label>
                          <label className={MARCA}>
                            <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!c.negrito} onChange={(e) => mudarCampo(i, { negrito: e.target.checked })} aria-label={`${nome} em negrito`} />
                            Negrito
                          </label>
                          <label className={MARCA} title="Divide a linha com o campo de cima (esquerda | direita)">
                            <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!c.agrupado} disabled={i === 0} onChange={(e) => mudarCampo(i, { agrupado: e.target.checked })} aria-label={`${nome} na mesma linha do campo de cima`} />
                            Junto do de cima
                          </label>
                          {seletorTamanho(`Tamanho da fonte de ${nome}`, nivelDe(c), (n) => mudarCampo(i, { mini: n.mini || undefined, escala: n.escala, tamanho: undefined }))}
                          <select aria-label={`Alinhamento de ${nome}`} title="Alinhamento" value={c.alinhamento} onChange={(e) => mudarCampo(i, { alinhamento: e.target.value })} className={CONTROLE}>
                            <option value="esquerda">Esquerda</option>
                            <option value="centro">Centro</option>
                            <option value="direita">Direita</option>
                          </select>
                        </>
                      )}
                      <span className="ml-auto flex gap-1">
                        <button type="button" className={BOTAO_ICONE} aria-label={`Subir ${nome}`} title="Subir" disabled={i === 0} onClick={() => mover(i, i - 1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                        <button type="button" className={BOTAO_ICONE} aria-label={`Descer ${nome}`} title="Descer" disabled={i === p.campos.length - 1} onClick={() => mover(i, i + 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                        {podeRemover && (
                          <button type="button" className={BOTAO_ICONE} aria-label={`Tirar ${nome} do cupom`} title="Tirar do cupom" onClick={() => remover(i)}><X className="h-4 w-4" aria-hidden="true" /></button>
                        )}
                      </span>
                    </div>
                    {/* Itens: estilo próprio de complementos e observação (destaque na cozinha) */}
                    {c.key === 'itens' && (
                      <div className="mt-1.5 space-y-1 border-t border-border pt-1.5">
                        {(['comp', 'obs'] as const).map((qual) => {
                          const est = c[qual] ?? { negrito: c.negrito, escala: c.escala, mini: c.mini };
                          const sub = qual === 'comp' ? 'Complementos' : 'Observação';
                          return (
                            <div key={qual} className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:pl-7">
                              <span className={`min-w-[9rem] flex-1 text-sm ${texto2}`}>{sub}</span>
                              <label className={MARCA}>
                                <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!est.negrito} onChange={(e) => mudarSub(i, qual, { negrito: e.target.checked })} aria-label={`${sub} em negrito`} />
                                Negrito
                              </label>
                              {seletorTamanho(`Tamanho da fonte de ${sub.toLowerCase()}`, nivelDe(est), (n) => mudarSub(i, qual, { mini: n.mini || undefined, escala: n.escala }))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {pode && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => incluirPseudo('_espaco')}><Plus className="h-4 w-4" aria-hidden="true" /> Linha em branco</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => incluirPseudo('_tracejado')}><Plus className="h-4 w-4" aria-hidden="true" /> Linha divisória</Button>
                {custom && (
                  <select aria-label="Adicionar campo" value="" onChange={(e) => { if (e.target.value) incluirCampo(e.target.value); }} className={`${CONTROLE} h-11 min-w-0 flex-1`}>
                    <option value="">＋ Adicionar campo…</option>
                    {disponiveis.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>
          {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
        </fieldset>

        {/* Prévia ao vivo — o papel da bobina: alinhamento por CSS e quebra de linha como no papel. */}
        <div className="min-w-0 lg:sticky lg:top-0">
          <p className="mb-1 font-display text-sm font-bold">Prévia</p>
          <div data-previa className="min-h-[240px] rounded-md border border-border bg-white p-3 font-mono text-[13px] leading-snug text-black">
            {previa.map((l, i) => {
              const estilo = { fontWeight: l.bold ? 700 : 400, fontSize: `${NIVEIS_FONTE[l.lvl]?.px ?? 13}px` };
              if (l.dir !== undefined)
                return (
                  <div key={i} className="flex justify-between gap-3" style={estilo}>
                    <span className="whitespace-pre-wrap break-words">{l.txt}</span>
                    <span className="whitespace-pre-wrap break-words text-right">{l.dir}</span>
                  </div>
                );
              return (
                <div key={i} className="whitespace-pre-wrap break-words" style={{ ...estilo, textAlign: l.align === 'centro' ? 'center' : l.align === 'direita' ? 'right' : 'left' }}>
                  {l.txt || ' '}
                </div>
              );
            })}
            {previa.length === 0 && <div>—</div>}
          </div>
          <p className={`mt-1 text-xs ${texto2}`}>Dados de exemplo.</p>
        </div>
      </form>
    </Gaveta>
  );
}

function ExcluirPerfil({ perfil, aoFechar, aoExcluir }: { perfil: any; aoFechar: () => void; aoExcluir: () => void }) {
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    if (apagando) return;
    setErro('');
    setApagando(true);
    try {
      await gravarPerfil(perfil, true);
      toast.success('Perfil excluído.');
      aoExcluir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir');
      setApagando(false);
    }
  }
  return (
    <Dialogo alerta titulo="Excluir perfil de cupom" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={apagando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={apagando}>{apagando ? 'Excluindo…' : 'Excluir perfil'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Excluir o perfil personalizado <b>{perfil.nome}</b>?</p>
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">O perfil sai da lista com os campos e as impressoras que estavam marcados nele. Não dá para desfazer.</p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
