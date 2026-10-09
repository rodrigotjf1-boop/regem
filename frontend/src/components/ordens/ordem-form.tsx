'use client';

import { useEffect, useId, useState } from 'react';
import { api, getUnidadeAtual } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { Input } from '@/components/ui/input';
import { SeletorDeUnidade } from '@/components/ui/seletor-de-unidade';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { hojeIso, texto2 } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Uma leitura do formulário: `null` = carregando; `erro` = não veio (e por quê). */
type Lista = { itens: any[]; erro?: string } | null;
const CANAIS = [
  { v: 'app', rotulo: 'App do colaborador' },
  { v: 'kds', rotulo: 'KDS/Quadro' },
  { v: 'linha_tempo', rotulo: 'Linha do tempo' },
  { v: 'impressao', rotulo: 'Impressão' },
];

// Nova ordem de produção, na gaveta. Cada lista do formulário (fichas, setores, insumos,
// impressoras) é lida por conta própria: só a das fichas é indispensável — as outras, se não
// vierem (o perfil pode não ter acesso), deixam o seu campo de fora e a ordem ainda se cria.
export function NovaOrdem({ gestao, voltarPara, aoFechar, aoSalvar }: { gestao: boolean; voltarPara: string; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const [fichas, setFichas] = useState<Lista>(null);
  const [setores, setSetores] = useState<Lista>(null);
  const [insumos, setInsumos] = useState<Lista>(null);
  const [impressoras, setImpressoras] = useState<Lista>(null);
  const [f, setF] = useState({
    fichaId: '', itemSaidaId: '', quantidadePlanejada: '1', unidade: 'unidade', dataProducao: hojeIso(), horaInicio: '', setorId: '',
    canais: ['linha_tempo'] as string[], impressoraId: '', recorrente: false,
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const muda = (campos: Partial<typeof f>) => setF((x) => ({ ...x, ...campos }));

  useEffect(() => {
    const ler = (pedido: Promise<unknown>, guardar: (l: Lista) => void) =>
      pedido.then((r) => guardar({ itens: Array.isArray(r) ? r : [] })).catch((e) => guardar({ itens: [], erro: e instanceof Error ? e.message : 'não carregou' }));
    void ler(api.fichasLista(), setFichas);
    void ler(api.setores(), setSetores);
    void ler(api.estoqueItens(), setInsumos);
    void ler(api.impressorasEstado(), setImpressoras);
  }, []);

  const ficha = fichas?.itens.find((x) => x.id === f.fichaId);
  const comPorcao = Number(ficha?.porcaoTamanho) > 0;
  // Imprimir ou não, e em qual impressora, vale para a ordem avulsa (a via sai ao criar) e para a
  // que se repete (a via de cada dia sai sozinha, uma vez — o servidor cuida de não repetir).
  const imprime = f.canais.includes('impressao');
  const alternarCanal = (c: string) => muda({ canais: f.canais.includes(c) ? f.canais.filter((x) => x !== c) : [...f.canais, c] });

  const falta = (msg: string, id: string) => {
    setErro(msg);
    document.getElementById(id)?.focus();
  };
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (!f.fichaId) return falta('Escolha a ficha técnica.', 'ordem-ficha');
    if (!(Number(f.quantidadePlanejada) > 0)) return falta('Informe a quantidade.', 'ordem-qtd');
    if (!f.recorrente && !f.dataProducao) return falta('Informe a data da produção.', 'ordem-data');
    // Sem impressora, o servidor guarda "Impressão" e não imprime nada.
    if (imprime && !f.impressoraId) return falta('Escolha a impressora da ordem (ou desmarque “Impressão”).', 'ordem-impressora');
    setErro('');
    setSalvando(true);
    try {
      const corpo = {
        fichaId: f.fichaId,
        itemSaidaId: f.itemSaidaId || undefined,
        quantidadePlanejada: Number(f.quantidadePlanejada),
        unidade: f.unidade.trim() || 'unidade',
        dataProducao: f.dataProducao,
        horaInicio: f.horaInicio || undefined,
        setorId: f.setorId || undefined,
        canais: f.canais,
        impressoraId: imprime ? f.impressoraId : undefined,
        liberar: true,
        titulo: ficha?.nome,
        // A loja em uso: quem tem loja fixa cria sempre na dele (o servidor ignora esta).
        unidadeId: getUnidadeAtual() ?? undefined,
      };
      if (f.recorrente) await api.ordemRecorrencia(corpo);
      else await api.criarOrdemProducao(corpo);
      toast.success(f.recorrente ? 'Ordem recorrente criada.' : 'Ordem criada.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }
  const semLista = (l: Lista) => !!l?.erro;

  return (
    <Gaveta
      titulo="Nova ordem de produção"
      aoFechar={aoFechar}
      voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando || !fichas || semLista(fichas)}>{salvando ? 'Salvando…' : 'Criar ordem'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4" noValidate>
        {semLista(fichas) && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">
            Não deu para carregar as fichas técnicas: {fichas?.erro}. Sem elas não dá para criar a ordem.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ordem-ficha">Ficha técnica</Label>
          <Select id="ordem-ficha" data-foco-inicial value={f.fichaId} onChange={(e) => muda({ fichaId: e.target.value })} disabled={semLista(fichas)} aria-busy={!fichas}>
            <option value="">{fichas ? '— escolha —' : 'Carregando…'}</option>
            {fichas?.itens.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </Select>
          {comPorcao && Number(ficha?.rendimento) > 0 && (
            <p className={`text-xs ${texto2}`}>1 ficha rende {Math.round(Number(ficha.rendimento) / Number(ficha.porcaoTamanho))} porções.</p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ordem-qtd">Quantidade</Label>
            <Input id="ordem-qtd" inputMode="decimal" value={f.quantidadePlanejada} onChange={(e) => muda({ quantidadePlanejada: e.target.value.replace(',', '.').replace(/[^\d.]/g, '') })} autoComplete="off" />
            {ficha && <p className={`text-xs ${texto2}`}>{comPorcao ? 'Em porções da ficha.' : 'Em fichas inteiras: 1 = a receita toda.'}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ordem-unidade">Unidade</Label>
            <SeletorDeUnidade id="ordem-unidade" value={f.unidade} onChange={(u) => muda({ unidade: u })} />
          </div>
        </div>
        {!semLista(insumos) ? (
          <div className="space-y-1.5">
            <Label htmlFor="ordem-saida">Insumo de saída (entra no estoque)</Label>
            <Select id="ordem-saida" value={f.itemSaidaId} onChange={(e) => muda({ itemSaidaId: e.target.value })} disabled={!insumos}>
              <option value="">{insumos ? '— nenhum (só baixa insumos) —' : 'Carregando…'}</option>
              {insumos?.itens.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </Select>
          </div>
        ) : (
          <p className={`text-xs ${texto2}`}>Insumo de saída: a lista do estoque não carregou ({insumos?.erro}). A ordem será criada sem ele — só baixa os insumos.</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ordem-data">Data</Label>
            <Input id="ordem-data" type="date" value={f.dataProducao} onChange={(e) => muda({ dataProducao: e.target.value })} disabled={f.recorrente} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ordem-hora">Hora início</Label>
            <Input id="ordem-hora" type="time" value={f.horaInicio} onChange={(e) => muda({ horaInicio: e.target.value })} />
          </div>
        </div>
        {!semLista(setores) ? (
          <div className="space-y-1.5">
            <Label htmlFor="ordem-setor">Setor responsável</Label>
            <Select id="ordem-setor" value={f.setorId} onChange={(e) => muda({ setorId: e.target.value })} disabled={!setores}>
              <option value="">{setores ? '— sem setor —' : 'Carregando…'}</option>
              {setores?.itens.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </Select>
          </div>
        ) : (
          <p className={`text-xs ${texto2}`}>Setor responsável: a lista de setores não carregou ({setores?.erro}). A ordem será criada sem setor.</p>
        )}
        <div>
          <span className="mb-1 block text-sm font-medium">Onde avisar</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Onde avisar">
            {CANAIS.map((c) => {
              const ligado = f.canais.includes(c.v);
              const semImpressoras = c.v === 'impressao' && (semLista(impressoras) || impressoras?.itens.length === 0);
              return (
                <button key={c.v} type="button" aria-pressed={ligado} disabled={semImpressoras && !ligado} onClick={() => alternarCanal(c.v)}
                  className={`inline-flex min-h-10 items-center gap-1 rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                    ligado ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-foreground hover:bg-secondary'
                  }`}>
                  {ligado && <span aria-hidden="true">✓</span>}
                  {c.rotulo}
                </button>
              );
            })}
          </div>
          {semLista(impressoras) && <p className={`mt-1 text-xs ${texto2}`}>Impressão: a lista de impressoras não carregou ({impressoras?.erro}).</p>}
          {impressoras && !impressoras.erro && impressoras.itens.length === 0 && <p className={`mt-1 text-xs ${texto2}`}>Impressão: nenhuma impressora ativa nesta loja.</p>}
        </div>
        {imprime && (
          <div className="space-y-1.5">
            <Label htmlFor="ordem-impressora">Impressora da ordem</Label>
            <Select id="ordem-impressora" value={f.impressoraId} onChange={(e) => muda({ impressoraId: e.target.value })}>
              <option value="">— escolha —</option>
              {impressoras?.itens.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
            </Select>
            <p className={`text-xs ${texto2}`}>
              {f.recorrente
                ? 'A via de cada dia sai sozinha nesta impressora, uma vez, com espaço para a assinatura. Se a loja estiver fechada quando a ordem do dia nascer, a via sai quando o computador da loja ligar.'
                : 'A ordem sai em papel nesta impressora ao ser criada, com espaço para a assinatura.'}
            </p>
          </div>
        )}
        {gestao && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Repetir todo dia (recorrente)</span>
              <Chave ligada={f.recorrente} rotulo="Repetir todo dia" aoMudar={(v) => muda({ recorrente: v })} />
            </div>
            {f.recorrente && (
              <p className={`mt-1 text-xs ${texto2}`}>
                A ordem de hoje é criada agora e a de cada dia nasce no próprio dia, na loja em uso. A data acima não é usada. Para sair em papel
                todo dia, marque “Impressão” em “Onde avisar” e escolha a impressora.
              </p>
            )}
          </div>
        )}
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}
