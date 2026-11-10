'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { Input } from '@/components/ui/input';
import { texto2 } from '@/components/ui/lista';
import { DIA_ROTULO, DIAS, type PaginaPublica } from '@/lib/vagas-ficha';
import { Capa } from '../publico/capa';
import { varsDoTema } from '../publico/tema';
import '../publico/vagas.css';

// Pessoas › Candidatos › aba Página de vagas: o que o candidato vê (e o que o robô vai explicar na F3). Modelo de ajustes
// do Regem (grupos, "N alterações ainda não salvas"). Ao lado, a prévia no formato de celular — a MESMA capa da página
// pública, montada com o que está na tela. A logo é a de Configurações › Loja ("Logo da loja"): trocou lá, muda aqui.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AjustesDaLoja {
  codigo: string | null;
  criada: boolean;
  pagina: any;
  loja: { nome: string; logoRef: string | null; logoEmoji: string | null; corPrimaria: string | null };
}
interface Funcao { codigo: string; nome: string; salario: string; lideranca: boolean; aberta: boolean }

const PERGUNTAS: [string, string][] = [
  ['cnh', 'CNH A e moto (para quem marca delivery)'],
  ['feriados', 'Feriados e datas de movimento'],
  ['ja_trabalhou', 'Já trabalhou aqui'],
  ['indicacao', 'Quem indicou'],
  ['sobre', '"Conte algo sobre você"'],
];

function paraValores(p: any): Valores {
  const h = p.horarios;
  const v: Valores = {
    ligada: !!p.ligada, titulo: p.titulo ?? '', frase: p.frase ?? '',
    corPrincipal: p.corPrincipal ?? '', corDestaque: p.corDestaque ?? '',
    funcoes: JSON.stringify(p.funcoes ?? []), beneficios: (p.beneficios ?? []).join('\n'),
    vagaFixa: !!p.vagaFixa, horista: !!p.horista,
    h12_ativa: !!h['12x36'].ativa, h12_inicio: h['12x36'].inicio, h12_fim: h['12x36'].fim,
    h5_ativa: !!h['5x2'].ativa, h5_inicio: h['5x2'].inicio, h5_fim: h['5x2'].fim,
    hh_inicio: h.horista.inicio, hh_fim: h.horista.fim, hh_dias: (h.horista.dias ?? []).join(','),
    idadeMinima: String(p.idadeMinima), guardaMeses: String(p.guardaMeses),
  };
  for (const [k] of PERGUNTAS) v[`p_${k}`] = p.perguntas?.[k] !== false;
  return v;
}
function lerFuncoes(v: Valor): Funcao[] {
  try {
    const a = JSON.parse(String(v || '[]'));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function paraCorpo(v: Valores): Record<string, unknown> {
  const dias = String(v.hh_dias || '').split(',').filter(Boolean);
  return {
    ligada: !!v.ligada, titulo: String(v.titulo), frase: String(v.frase),
    corPrincipal: String(v.corPrincipal) || null, corDestaque: String(v.corDestaque) || null,
    funcoes: lerFuncoes(v.funcoes),
    beneficios: String(v.beneficios).split('\n').map((x) => x.trim()).filter(Boolean),
    vagaFixa: !!v.vagaFixa, horista: !!v.horista,
    horarios: {
      '12x36': { ativa: !!v.h12_ativa, inicio: String(v.h12_inicio), fim: String(v.h12_fim) },
      '5x2': { ativa: !!v.h5_ativa, inicio: String(v.h5_inicio), fim: String(v.h5_fim) },
      horista: { ativa: !!v.horista, inicio: String(v.hh_inicio), fim: String(v.hh_fim), dias },
    },
    idadeMinima: Number(v.idadeMinima), guardaMeses: Number(v.guardaMeses),
    perguntas: Object.fromEntries(PERGUNTAS.map(([k]) => [k, !!v[`p_${k}`]])),
  };
}

/** A página como o candidato a veria, com o que está na tela agora (para a prévia). */
function paginaDaPrevia(v: Valores, loja: AjustesDaLoja['loja']): PaginaPublica {
  const c = paraCorpo(v) as any;
  return {
    loja: { nome: loja.nome, logoRef: loja.logoRef, logoEmoji: loja.logoEmoji },
    cores: { principal: c.corPrincipal ?? loja.corPrimaria, destaque: c.corDestaque },
    pagina: { ...c, funcoes: c.funcoes.filter((f: Funcao) => f.aberta && f.nome.trim()) },
    termos: { guarda: '', comunicacao: { resumo: '', texto: [] } },
  };
}

function Hora({ v, m, id }: { v: Valor; m: (x: Valor) => void; id: string }) {
  return <Input id={id} type="time" value={String(v ?? '')} onChange={(e) => m(e.target.value)} className="w-36" />;
}
function Cor({ v, m, id, padrao }: { v: Valor; m: (x: Valor) => void; id: string; padrao: string }) {
  const atual = String(v || '');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        id={id}
        type="color"
        aria-label="Escolher a cor"
        className="h-11 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
        value={/^#[0-9a-f]{6}$/i.test(atual) ? atual : padrao}
        onChange={(e) => m(e.target.value.toUpperCase())}
      />
      <Input aria-label="Cor em #RRGGBB" className="w-32 font-mono" maxLength={7} value={atual} placeholder="vazio" onChange={(e) => m(e.target.value.trim())} />
      {atual && (
        <Button type="button" size="sm" variant="outline" onClick={() => m('')}>
          Usar a do cardápio
        </Button>
      )}
    </div>
  );
}
// Cada função num cartão: nome e base salarial lado a lado quando cabem (a quebra é pela largura do cartão, `flex-wrap`,
// não pela da tela — o cartão mora numa linha de ajuste), e embaixo as duas chaves com o nome escrito.
function EditorDeFuncoes({ v, m }: { v: Valor; m: (x: Valor) => void }) {
  const fs = lerFuncoes(v);
  const gravar = (n: Funcao[]) => m(JSON.stringify(n));
  const mudar = (i: number, d: Partial<Funcao>) => gravar(fs.map((x, j) => (j === i ? { ...x, ...d } : x)));
  return (
    <div className="space-y-2">
      {fs.map((f, i) => (
        <fieldset key={`${f.codigo}-${i}`} className={`m-0 min-w-0 space-y-3 rounded-lg border border-border p-3 ${f.aberta ? 'bg-card' : 'bg-secondary/60'}`}>
          <legend className="sr-only">{`Função ${i + 1}: ${f.nome || 'sem nome'}`}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-[1.3_1_13rem] space-y-1">
              <label htmlFor={`fn-nome-${i}`} className="block text-xs font-bold">
                Função
              </label>
              <Input id={`fn-nome-${i}`} value={f.nome} maxLength={60} onChange={(e) => mudar(i, { nome: e.target.value })} />
            </div>
            <div className="min-w-0 flex-[1_1_13rem] space-y-1">
              <label htmlFor={`fn-sal-${i}`} className="block text-xs font-bold">
                Base salarial
              </label>
              <Input id={`fn-sal-${i}`} value={f.salario} maxLength={60} placeholder="Ex.: R$ 1.900,00" onChange={(e) => mudar(i, { salario: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <Chave id={`fn-aberta-${i}`} comTexto={false} ligada={f.aberta} rotulo={`Vaga aberta: ${f.nome}`} aoMudar={(b) => mudar(i, { aberta: b })} />
              <label htmlFor={`fn-aberta-${i}`} className="cursor-pointer text-sm font-semibold">
                {f.aberta ? 'Vaga aberta' : 'Vaga fechada (não aparece)'}
              </label>
            </span>
            <span className="inline-flex items-center gap-2">
              <Chave id={`fn-lid-${i}`} comTexto={false} ligada={f.lideranca} rotulo={`Cargo de liderança: ${f.nome}`} aoMudar={(b) => mudar(i, { lideranca: b })} />
              <label htmlFor={`fn-lid-${i}`} className="cursor-pointer text-sm font-semibold">
                Cargo de liderança
              </label>
            </span>
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => gravar(fs.filter((_, j) => j !== i))} aria-label={`Tirar a função ${f.nome}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Tirar
            </Button>
          </div>
        </fieldset>
      ))}
      <p className={`text-xs ${texto2}`}>
        A base salarial é o texto que o candidato lê. &quot;Cargo de liderança&quot; faz a ficha pedir a experiência de liderança; vaga fechada
        some da página sem apagar a função.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fs.length >= 20}
        onClick={() => gravar([...fs, { codigo: '', nome: 'Nova função', salario: '', lideranca: false, aberta: true }])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar função
      </Button>
    </div>
  );
}
function Dias({ v, m }: { v: Valor; m: (x: Valor) => void }) {
  const ds = String(v || '').split(',').filter(Boolean);
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Dias do horista">
      {DIAS.map((d) => (
        <Button
          key={d}
          type="button"
          size="sm"
          variant={ds.includes(d) ? 'default' : 'outline'}
          aria-pressed={ds.includes(d)}
          onClick={() => m(DIAS.filter((x) => (x === d ? !ds.includes(d) : ds.includes(x))).join(','))}
        >
          {DIA_ROTULO[d]}
        </Button>
      ))}
    </div>
  );
}

export function AjustesDaPagina({ dados, aoSalvo, aoPendentes }: { dados: AjustesDaLoja; aoSalvo: (d: AjustesDaLoja) => void; aoPendentes: (n: number) => void }) {
  const inicial = useMemo(() => paraValores(dados.pagina), [dados]);
  const [salvos, setSalvos] = useState<Valores>(inicial);
  const [valores, setValores] = useState<Valores>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setSalvos(inicial);
    setValores(inicial);
  }, [inicial]);

  const link = dados.codigo && typeof window !== 'undefined' ? `${window.location.origin}/v/${dados.codigo}` : '';
  const grupos: GrupoDeAjustes[] = [
    {
      titulo: 'Página',
      nota: 'Desligada, o link e os QR codes respondem "página de vagas não encontrada".',
      itens: [
        { id: 'ligada', rotulo: 'Página de vagas ligada', tipo: 'chave' },
        { id: 'titulo', rotulo: 'Título', tipo: 'texto', maximo: 80 },
        { id: 'frase', rotulo: 'Frase de apresentação', tipo: 'texto', maximo: 160, opcional: true },
      ],
      depois: link ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="break-all rounded bg-secondary px-2 py-1 font-mono text-xs">{link}</code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copiado.'), () => toast.error('Não deu para copiar.'))}
          >
            Copiar link
          </Button>
        </div>
      ) : (
        <p className={`text-sm ${texto2}`}>O endereço da página aparece depois de salvar pela primeira vez.</p>
      ),
    },
    {
      titulo: 'Identidade da página',
      nota: (
        <>
          A logo vem de <Link className="underline" href="/loja">Configurações › Loja</Link> (&quot;Logo da loja&quot;). As cores: vazias, vale a cor do cardápio online.
        </>
      ),
      itens: [
        { id: 'corPrincipal', rotulo: 'Cor principal (fundo da capa e botões)', tipo: 'livre', desenhar: (v, m) => <Cor id="cor-principal" v={v} m={m} padrao={dados.loja.corPrimaria ?? '#0F6647'} /> },
        { id: 'corDestaque', rotulo: 'Cor de destaque (selo e botão de começar)', tipo: 'livre', desenhar: (v, m) => <Cor id="cor-destaque" v={v} m={m} padrao="#E8A845" /> },
      ],
      depois: dados.loja.logoRef ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dados.loja.logoRef} alt={`Logo de ${dados.loja.nome}`} className="h-20 w-auto rounded-md border border-border bg-secondary p-1" />
      ) : (
        <p className={`text-sm ${texto2}`}>A loja ainda não tem logo: a página mostra as iniciais.</p>
      ),
    },
    {
      titulo: 'Funções e salários',
      nota: 'Só as funções abertas aparecem para o candidato.',
      itens: [{ id: 'funcoes', rotulo: 'Funções', tipo: 'livre', largo: true, desenhar: (v, m) => <EditorDeFuncoes v={v} m={m} /> }],
    },
    { titulo: 'Benefícios', itens: [{ id: 'beneficios', rotulo: 'Benefícios (um por linha)', tipo: 'area', opcional: true, placeholder: 'Vale-refeição: R$ 150,00' }] },
    {
      titulo: 'Vagas e horários',
      nota: 'O horário sai da escala: o candidato escolhe a escala e já vê o horário dela.',
      itens: [
        { id: 'vagaFixa', rotulo: 'Vaga fixa (carteira, com escala)', tipo: 'chave' },
        { id: 'h12_ativa', rotulo: 'Escala 12x36', tipo: 'chave' },
        { id: 'h12_inicio', rotulo: '12x36 — começa', tipo: 'livre', desenhar: (v, m) => <Hora id="h12-ini" v={v} m={m} /> },
        { id: 'h12_fim', rotulo: '12x36 — termina', tipo: 'livre', desenhar: (v, m) => <Hora id="h12-fim" v={v} m={m} /> },
        { id: 'h5_ativa', rotulo: 'Escala 5x2', tipo: 'chave' },
        { id: 'h5_inicio', rotulo: '5x2 — começa', tipo: 'livre', desenhar: (v, m) => <Hora id="h5-ini" v={v} m={m} /> },
        { id: 'h5_fim', rotulo: '5x2 — termina', tipo: 'livre', desenhar: (v, m) => <Hora id="h5-fim" v={v} m={m} /> },
        { id: 'horista', rotulo: 'Vaga de horista', tipo: 'chave' },
        { id: 'hh_inicio', rotulo: 'Horista — começa', tipo: 'livre', desenhar: (v, m) => <Hora id="hh-ini" v={v} m={m} /> },
        { id: 'hh_fim', rotulo: 'Horista — termina', tipo: 'livre', desenhar: (v, m) => <Hora id="hh-fim" v={v} m={m} /> },
        { id: 'hh_dias', rotulo: 'Dias com mais vagas de horista', tipo: 'livre', desenhar: (v, m) => <Dias v={v} m={m} /> },
      ],
    },
    {
      titulo: 'Perguntas extras',
      nota: 'Cada pergunta a mais diminui quem termina a ficha. Estudos, cursos, transporte e valor da condução são fixos.',
      itens: PERGUNTAS.map(([k, rotulo]) => ({ id: `p_${k}`, rotulo, tipo: 'chave' as const })),
    },
    {
      titulo: 'Regras',
      itens: [
        {
          id: 'idadeMinima',
          rotulo: 'Idade mínima',
          tipo: 'selecao',
          opcoes: [{ v: '16', rotulo: '16 anos' }, { v: '18', rotulo: '18 anos' }, { v: '21', rotulo: '21 anos' }],
          ajuda: 'Turno depois das 22h não pode para menor de 18 (CLT art. 404); entrega de moto pede 21 (Lei 12.009/2009).',
        },
        {
          id: 'guardaMeses',
          rotulo: 'Guardar as fichas não contratadas por',
          tipo: 'selecao',
          opcoes: [{ v: '6', rotulo: '6 meses' }, { v: '12', rotulo: '12 meses' }, { v: '24', rotulo: '24 meses' }],
          ajuda: 'Depois disso a ficha se apaga sozinha (LGPD). O candidato lê esse prazo antes de enviar.',
        },
      ],
    },
  ];

  const pendentes = alterados(grupos, valores, salvos).length;
  useEffect(() => aoPendentes(pendentes), [pendentes, aoPendentes]);

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const r = (await api.vagasSalvarAjustes(paraCorpo(valores))) as AjustesDaLoja;
      toast.success(dados.criada ? 'Página de vagas salva.' : 'Página de vagas criada. O link e os QR codes já existem.');
      aoSalvo(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const previa = paginaDaPrevia(valores, dados.loja);
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <Ajustes
          id="vagas"
          titulo="Página de vagas"
          grupos={grupos}
          valores={valores}
          salvos={salvos}
          aoMudar={(k: string, v: Valor) => setValores((x) => ({ ...x, [k]: v }))}
          aoSalvar={() => void salvar()}
          aoDescartar={() => {
            setValores(salvos);
            setErro('');
          }}
          salvando={salvando}
          erro={erro}
        />
      </div>
      <aside className="min-w-0 xl:sticky xl:top-4" aria-label="Prévia da página do candidato">
        <p className={`mb-1 text-xs font-bold ${texto2}`}>Prévia — como o candidato vê</p>
        <div className="mx-auto max-h-[680px] max-w-[360px] overflow-y-auto overflow-x-hidden rounded-[30px] border-[10px] border-foreground">
          <div className="vg-root" style={{ ...varsDoTema(previa.cores), minHeight: 0, boxShadow: 'none' }}>
            <Capa p={previa} aoComecar={() => toast.info('Na página de verdade, aqui começa a ficha.')} />
          </div>
        </div>
      </aside>
    </div>
  );
}
