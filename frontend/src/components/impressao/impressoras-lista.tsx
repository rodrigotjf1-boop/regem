'use client';

import { useId, useState } from 'react';
import { Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O que a impressora imprime. "Caixa e cozinha" é o papel múltiplo: definido em Equipamentos, aqui
// aparece (e se mantém) em vez de ser achatado para "Caixa".
const DIRECOES = [
  { v: 'cupom', rotulo: 'Caixa (cupom)' },
  { v: 'producao', rotulo: 'Cozinha (produção)' },
  { v: 'ambos', rotulo: 'Caixa e cozinha (cupom + produção)' },
  { v: 'etiqueta', rotulo: 'Etiqueta (validade)' },
];
// Pelo que a impressora FAZ (os três liga/desliga), não pelo `papel` antigo: o "Cupom do cliente" do
// Direcionamento desliga o cupom sem mexer no papel — e a impressora que não faz nada tem de aparecer assim.
const NENHUM = 'Nenhum (não imprime cupom nem produção)';
const direcaoDe = (i: any): string => (i.fazEtiqueta ? 'etiqueta' : i.fazCupom && i.fazProducao ? 'ambos' : i.fazProducao ? 'producao' : i.fazCupom ? 'cupom' : 'nenhum');
const rotuloDirecao = (i: any) => DIRECOES.find((d) => d.v === direcaoDe(i))?.rotulo ?? NENHUM;
const ehLocal = (i: any) => i.conexao === 'local';
const alvoDe = (i: any) => (ehLocal(i) ? i.dispositivo || '' : i.host ? `${i.host}${i.porta ? ` : ${i.porta}` : ''}` : '');
const conexaoDe = (i: any) => (ehLocal(i) ? 'Local (USB/Windows)' : 'Rede (IP)');
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Ativas', filtro: (i) => i.ativo !== false },
  { rotulo: 'Inativas', filtro: (i) => i.ativo === false },
  { rotulo: 'Sem destino', filtro: (i) => !alvoDe(i), tom: 'aviso' },
];
const ID_TITULO = 'impressoras-titulo';

// Impressoras e cupons → Impressoras (mockup `mockups/regem-configuracoes.html`): a lista das
// impressoras, com ativar na linha, "Imprimir teste" e a edição na gaveta. A edição manda só o que
// mudou: esta tela e a de Equipamentos editam a mesma impressora, com campos diferentes.
//
// `pode` = presidente/gerente. `peloServidorLocal` = a loja tem servidor local ativo: a configuração
// das impressoras é dele, e a nuvem recusa a edição — aqui fica só leitura, com o teste de impressão.
export function ImpressorasLista({
  impressoras, setores, pode, peloServidorLocal = false, recarregar,
}: { impressoras: any[]; setores: any[]; pode: boolean; peloServidorLocal?: boolean; recarregar: () => Promise<void> }) {
  const podeEditar = pode && !peloServidorLocal;
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroDirecao, setFiltroDirecao] = useState('');
  const [filtroConexao, setFiltroConexao] = useState('');
  const [filtroSetor, setFiltroSetor] = useState('');
  const [editando, setEditando] = useState<any | null>(null);
  const [excluindo, setExcluindo] = useState<any | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);

  // Setor só vale para quem imprime produção. Setor gravado que não está na lista (sem acesso aos
  // setores, ou setor de outra loja) não vira "Todos / geral": isso seria dizer outra coisa.
  const setorDe = (i: any) => {
    if (direcaoDe(i) !== 'producao' && direcaoDe(i) !== 'ambos') return '';
    if (!i.setorId) return 'Todos / geral';
    return setores.find((s) => s.id === i.setorId)?.nome ?? 'Setor fora da lista';
  };
  const b = semAcento(busca);
  const base = impressoras.filter(
    (i) =>
      (!b || semAcento(`${i.nome} ${alvoDe(i)}`).includes(b)) &&
      (!filtroDirecao || rotuloDirecao(i) === filtroDirecao) &&
      (!filtroConexao || conexaoDe(i) === filtroConexao) &&
      (!filtroSetor || setorDe(i) === filtroSetor),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroDirecao || filtroConexao || filtroSetor || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroDirecao(''); setFiltroConexao(''); setFiltroSetor(''); setSit(-1); };

  async function ativar(i: any, ativo: boolean) {
    setGravando(i.id);
    try {
      await api.salvarImpressora({ id: i.id, ativo }); // só a chave: o resto da impressora fica como está
      toast.success(ativo ? `${i.nome} ativada.` : `${i.nome} desativada.`);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setGravando(null);
    }
  }
  async function testar(i: any) {
    try {
      const r: any = await api.impressoraTeste(i.id);
      // Com servidor local ativo, quem imprime é ele — e a resposta diz isso.
      toast.success(r?.edge ? r.aviso || 'Impressão gerenciada pelo servidor local.' : 'Página de teste enviada. Se o servidor local estiver ativo, sai em segundos.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao enviar teste');
    }
  }

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Impressoras" total={impressoras.length} mostrando={linhas.length} um="impressora" varios="impressoras">
        {podeEditar && <Button type="button" onClick={() => setEditando({})}><Plus className="h-4 w-4" aria-hidden="true" /> Impressora</Button>}
      </TituloLista>
      {peloServidorLocal && (
        <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
          Esta loja tem <strong>servidor local (edge) ativo</strong> — a configuração de impressão é gerenciada por ele. Aqui na nuvem a lista fica{' '}
          <strong>somente leitura</strong>; edite as impressoras no servidor local da loja.
        </p>
      )}
      <p className={`max-w-3xl text-sm ${texto2}`}>
        Direcione a impressão: <strong>Caixa</strong> (cupom do cliente), <strong>Cozinha</strong> (produção, por setor) ou <strong>Etiqueta</strong>{' '}
        (etiquetas de validade). A conexão pode ser <strong>Rede</strong> (impressora com IP) ou <strong>Local</strong> (USB/instalada no Windows do PDV).
      </p>
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="impressoras-busca" valor={busca} aoMudar={setBusca} placeholder="Nome, IP ou nome no Windows" />
        <FiltroSelect id="impressoras-direcao" rotulo="Direcionamento" todos="Todos" opcoes={distintos(impressoras, rotuloDirecao)} valor={filtroDirecao} aoMudar={setFiltroDirecao} />
        <FiltroSelect id="impressoras-conexao" rotulo="Conexão" todos="Rede e local" opcoes={distintos(impressoras, conexaoDe)} valor={filtroConexao} aoMudar={setFiltroConexao} />
        <FiltroSelect id="impressoras-setor" rotulo="Setor" todos="Todos os setores" opcoes={distintos(impressoras, setorDe)} valor={filtroSetor} aoMudar={setFiltroSetor} />
      </Filtros>

      {impressoras.length === 0 ? (
        <Vazio>Nenhuma impressora cadastrada.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Impressoras"
          linhas={linhas}
          chave={(i) => i.id}
          nome={(i) => i.nome}
          colunas={[
            { titulo: 'Impressora', celula: (i) => <NomeComApoio nome={i.nome} apoio={<>{conexaoDe(i)} · <span className="font-mono">{alvoDe(i) || 'sem destino'}</span></>} /> },
            { titulo: 'Direcionamento', celula: (i) => rotuloDirecao(i) },
            { titulo: 'Setor', celula: (i) => setorDe(i) || '—' },
            { titulo: 'Vias (cupom / produção)', celula: (i) => <span className="whitespace-nowrap font-mono">{i.viasCliente ?? '—'} / {i.viasProducao ?? '—'}</span> },
            {
              titulo: 'Ativa',
              celula: (i) =>
                podeEditar ? <Chave ligada={i.ativo !== false} rotulo={`${i.nome} ativa`} ocupada={gravando === i.id} aoMudar={(v) => void ativar(i, v)} /> : i.ativo !== false ? 'sim' : 'não',
            },
          ]}
          acoes={() => [
            ...(pode ? [{ rotulo: 'Imprimir teste', icone: Printer, aoClicar: (i: any) => void testar(i) }] : []),
            ...(podeEditar
              ? [
                  { rotulo: 'Editar', icone: Pencil, aoClicar: setEditando },
                  { rotulo: 'Excluir', icone: Trash2, aoClicar: setExcluindo, tom: 'perigo' as const },
                ]
              : []),
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {editando && <ImpressoraForm item={editando} setores={setores} aoFechar={() => setEditando(null)} aoSalvar={async () => { setEditando(null); await recarregar(); }} />}
      {excluindo && (
        <ExcluirImpressora
          impressora={excluindo}
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

function ImpressoraForm({ item, setores, aoFechar, aoSalvar }: { item: any; setores: any[]; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const nova = !item.id;
  const inicial = {
    nome: item.nome ?? '',
    ativo: item.ativo !== false,
    direcao: nova ? 'cupom' : direcaoDe(item),
    setorId: item.setorId ?? '',
    linguagemEtiqueta: item.linguagemEtiqueta ?? 'escpos',
    conexao: ehLocal(item) ? 'local' : 'rede',
    host: item.host ?? '',
    porta: item.porta != null ? String(item.porta) : nova ? '9100' : '',
    dispositivo: item.dispositivo ?? '',
    viasCliente: item.viasCliente != null ? String(item.viasCliente) : '',
    viasProducao: item.viasProducao != null ? String(item.viasProducao) : '',
  };
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const muda = (campos: Partial<typeof inicial>) => setF((x) => ({ ...x, ...campos }));
  const local = f.conexao === 'local';
  const comSetor = f.direcao === 'producao' || f.direcao === 'ambos';

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (!f.nome.trim()) {
      setErro('Informe o nome da impressora.');
      document.getElementById('imp-nome')?.focus();
      return;
    }
    // Só o que mudou (no cadastro novo, tudo): o servidor mantém o campo que não veio, e a tela de
    // Equipamentos guarda nesta mesma impressora os acentos, o papel e os setores atendidos.
    const mudou = (k: keyof typeof inicial) => nova || f[k] !== inicial[k];
    const corpo: Record<string, unknown> = nova ? {} : { id: item.id };
    if (mudou('nome')) corpo.nome = f.nome.trim();
    if (mudou('ativo')) corpo.ativo = f.ativo;
    if (mudou('direcao'))
      Object.assign(corpo, f.direcao === 'etiqueta' ? { fazEtiqueta: true } : { fazEtiqueta: false, fazCupom: ['cupom', 'ambos'].includes(f.direcao), fazProducao: ['producao', 'ambos'].includes(f.direcao) });
    if (mudou('direcao') || mudou('setorId')) corpo.setorId = comSetor ? f.setorId || null : null;
    if (f.direcao === 'etiqueta' && (mudou('direcao') || mudou('linguagemEtiqueta'))) corpo.linguagemEtiqueta = f.linguagemEtiqueta;
    if (mudou('conexao') || mudou('host') || mudou('porta') || mudou('dispositivo')) {
      corpo.conexao = f.conexao;
      if (local) corpo.dispositivo = f.dispositivo.trim() || null;
      else Object.assign(corpo, { host: f.host.trim() || null, porta: f.porta ? Number(f.porta) : null });
    }
    if (mudou('viasCliente')) corpo.viasCliente = f.viasCliente === '' ? null : Number(f.viasCliente);
    if (mudou('viasProducao')) corpo.viasProducao = f.viasProducao === '' ? null : Number(f.viasProducao);
    if (!nova && Object.keys(corpo).length === 1) return aoFechar(); // nada mudou
    setErro('');
    setSalvando(true);
    try {
      await api.salvarImpressora(corpo);
      toast.success('Impressora salva.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }
  const opcao = (ligada: boolean) =>
    `min-h-11 border-r border-input px-2 text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
      ligada ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
    }`;

  return (
    <Gaveta
      titulo={nova ? 'Nova impressora' : `Editar ${item.nome}`}
      aoFechar={aoFechar}
      voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="imp-nome">Nome da impressora</Label>
          <Input id="imp-nome" data-foco-inicial value={f.nome} onChange={(e) => muda({ nome: e.target.value })} autoComplete="off" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Ativa</span>
          <Chave ligada={f.ativo} rotulo="Impressora ativa" aoMudar={(v) => muda({ ativo: v })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="imp-direcao">Direcionamento</Label>
          <Select id="imp-direcao" value={f.direcao} onChange={(e) => muda({ direcao: e.target.value })}>
            {DIRECOES.map((d) => <option key={d.v} value={d.v}>{d.rotulo}</option>)}
            {inicial.direcao === 'nenhum' && <option value="nenhum">{NENHUM}</option>}
          </Select>
        </div>
        {comSetor && (
          <div className="space-y-1.5">
            <Label htmlFor="imp-setor">Setor</Label>
            <Select id="imp-setor" value={f.setorId} onChange={(e) => muda({ setorId: e.target.value })}>
              <option value="">Todos / geral</option>
              {item.setorId && !setores.some((s) => s.id === item.setorId) && <option value={item.setorId}>Setor atual (fora da lista)</option>}
              {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </Select>
          </div>
        )}
        {f.direcao === 'etiqueta' && (
          <div className="space-y-1.5">
            <Label htmlFor="imp-modelo">Modelo da etiquetadora</Label>
            <Select id="imp-modelo" value={f.linguagemEtiqueta} onChange={(e) => muda({ linguagemEtiqueta: e.target.value })}>
              <option value="zpl">Etiquetadora ZPL (Zebra · Elgin L42 · Argox)</option>
              <option value="epl">Etiquetadora EPL / PPLB</option>
              <option value="escpos">Térmica de bobina (58/80mm)</option>
            </Select>
            <p className={`text-xs ${texto2}`}>O tamanho vem do modelo (aba Etiquetas → Modelo). Elgin L42Pro: ZPL (ou EPL).</p>
          </div>
        )}
        <div>
          <span className="mb-1 block text-sm font-medium">Conexão</span>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-input" role="group" aria-label="Conexão">
            <button type="button" aria-pressed={!local} className={opcao(!local)} onClick={() => muda({ conexao: 'rede' })}>Rede (IP)</button>
            <button type="button" aria-pressed={local} className={opcao(local)} onClick={() => muda({ conexao: 'local' })}>Local (USB/Windows)</button>
          </div>
        </div>
        {local ? (
          <div className="space-y-1.5">
            <Label htmlFor="imp-dispositivo">Nome no Windows</Label>
            <Input id="imp-dispositivo" value={f.dispositivo} onChange={(e) => muda({ dispositivo: e.target.value })} placeholder="Ex.: EPSON TM-T20" autoComplete="off" />
            <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-xs">
              <strong>Local (USB/Windows)</strong>: informe o <strong>nome exato</strong> da impressora como aparece no Windows (Painel de Controle →
              Dispositivos e Impressoras). A impressão local roda no <strong>servidor local (edge)</strong> — sem edge instalado, use uma impressora de rede.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="imp-host">IP</Label>
              <Input id="imp-host" value={f.host} onChange={(e) => muda({ host: e.target.value })} placeholder="192.168.0.50" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-porta">Porta</Label>
              <Input id="imp-porta" inputMode="numeric" value={f.porta} onChange={(e) => muda({ porta: e.target.value.replace(/\D/g, '') })} placeholder="9100" autoComplete="off" />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="imp-vias-cupom">Vias — cupom</Label>
            <Input id="imp-vias-cupom" inputMode="numeric" value={f.viasCliente} onChange={(e) => muda({ viasCliente: e.target.value.replace(/\D/g, '') })} placeholder="padrão" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-vias-prod">Vias — produção</Label>
            <Input id="imp-vias-prod" inputMode="numeric" value={f.viasProducao} onChange={(e) => muda({ viasProducao: e.target.value.replace(/\D/g, '') })} placeholder="padrão" autoComplete="off" />
          </div>
        </div>
        <p className={`text-xs ${texto2}`}>Vazio = usa o padrão de vias da impressora. Acentos, papel (58/80 mm) e setores atendidos ficam em Configurações → Equipamentos.</p>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

function ExcluirImpressora({ impressora, aoFechar, aoExcluir }: { impressora: any; aoFechar: () => void; aoExcluir: () => void }) {
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    if (apagando) return;
    setErro('');
    setApagando(true);
    try {
      await api.removerImpressora(impressora.id);
      toast.success('Impressora removida.');
      aoExcluir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover');
      setApagando(false);
    }
  }
  return (
    <Dialogo alerta titulo="Excluir impressora" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={apagando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={apagando}>{apagando ? 'Excluindo…' : 'Excluir impressora'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Excluir <b>{impressora.nome}</b>?</p>
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          A impressora é apagada do cadastro, e os produtos, complementos e setores direcionados a ela perdem esse destino. O perfil de cupom ou o
          terminal que apontava para ela volta a usar as impressoras de cupom padrão. Para só parar de imprimir, desligue a chave “Ativa”. Não dá
          para desfazer.
        </p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
