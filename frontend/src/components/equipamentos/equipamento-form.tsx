'use client';

import { useId, useState } from 'react';
import { api, getUnidadeAtual } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { ESCOPOS, ETAPAS, TIPOS, daLoja, ehGogem } from './equipamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Novo equipamento e "Configurar", na gaveta.
//  • Novo: os campos do tipo escolhido; o servidor devolve o token, mostrado uma vez pela tela.
//  • Configurar: o tipo e a unidade não mudam. Cada grupo de campos tem a sua rota no servidor (o
//    cadastro, a impressora de cupom do caixa, a impressão por etapa e o próximo KDS, a impressora);
//    um só "Salvar alterações" chama as que mudaram, e só com o que mudou.
export function EquipamentoForm({
  item, todos, unidades, setores, peloServidorLocal, voltarPara, aoFechar, aoCadastrar, aoSalvar,
}: {
  /** `null` = novo equipamento. */
  item: any | null;
  todos: any[];
  unidades: any[];
  setores: any[];
  /** A loja tem servidor local ativo: impressora e KDS são cadastrados nele (a nuvem recusa). */
  peloServidorLocal: boolean;
  voltarPara: string;
  aoFechar: () => void;
  aoCadastrar: (novo: { nome: string; token: string }, aviso: string) => void;
  /** `algo` = alguma parte foi gravada (mesmo que outra tenha falhado). */
  aoSalvar: () => void;
}) {
  const formId = useId();
  const novo = !item;
  const [inicial] = useState(() => ({
    tipo: (item?.tipo ?? 'terminal_ponto') as string,
    nome: (item?.nome ?? '') as string,
    unidadeId: (item ? item.unidadeId ?? '' : getUnidadeAtual() ?? '') as string,
    setorId: (item?.setorId ?? '') as string,
    escopo: (item?.escopo ?? 'producao') as string,
    impressoraPadraoId: (item?.impressoraPadraoId ?? '') as string,
    pdvMainId: (item?.pdvMainId ?? '') as string,
    imprimeAoAvancar: !!item?.imprimeAoAvancar,
    imprimeNoStatus: (item?.imprimeNoStatus ?? 'pronto') as string,
    impressoraDestinoId: (item?.impressoraDestinoId ?? '') as string,
    proximoKdsId: (item?.proximoKdsId ?? '') as string,
    fazCupom: item ? !!item.fazCupom : false,
    fazProducao: item ? !!item.fazProducao : true,
    conexao: (item?.conexao === 'local' ? 'local' : 'rede') as string,
    host: (item?.host ?? '') as string,
    porta: (item ? (item.porta != null ? String(item.porta) : '') : '9100') as string,
    dispositivo: (item?.dispositivo ?? '') as string,
    largura: String(item?.largura ?? 80),
    codepage: (item?.codepage ?? '') as string,
    setoresAtendidos: (item?.setoresAtendidos ?? []) as string[],
    padrao: !!item?.padrao,
  }));
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const muda = (campos: Partial<typeof inicial>) => setF((x) => ({ ...x, ...campos }));
  const mudou = (k: keyof typeof inicial) => JSON.stringify(f[k]) !== JSON.stringify(inicial[k]);

  const [pdv, salao, kds, imp] = [f.tipo === 'pdv', f.tipo === 'salao', f.tipo === 'kds', f.tipo === 'impressora'];
  const local = f.conexao === 'local';
  const etiqueta = !!item?.fazEtiqueta;
  const travadoPeloServidor = novo && peloServidorLocal && (kds || imp);
  const ativos = todos.filter((e) => e.ativo && e.id !== item?.id);
  const daUnidade = daLoja(f.unidadeId || null);
  const impressorasDeCupom = ativos.filter((e) => e.tipo === 'impressora' && e.fazCupom && daUnidade(e));
  const pdvs = ativos.filter((e) => e.tipo === 'pdv' && !ehGogem(e) && daUnidade(e));
  const impressoras = ativos.filter((e) => e.tipo === 'impressora');
  const outrosKds = ativos.filter((e) => e.tipo === 'kds');
  const alternarSetor = (id: string) => muda({ setoresAtendidos: f.setoresAtendidos.includes(id) ? f.setoresAtendidos.filter((s) => s !== id) : [...f.setoresAtendidos, id] });
  /** A opção gravada que não está mais na lista (equipamento revogado, de outra loja…) continua visível. */
  const foraDaLista = (id: string, lista: any[], rotulo: string) => (id && !lista.some((e) => e.id === id) ? <option value={id}>{rotulo}</option> : null);

  const falta = (msg: string, id: string) => {
    setErro(msg);
    document.getElementById(id)?.focus();
  };
  const conexaoParaSalvar = () => (local ? { conexao: 'local', dispositivo: f.dispositivo.trim() || null } : { conexao: 'rede', host: f.host.trim() || null, porta: f.porta ? Number(f.porta) : null });

  async function cadastrar() {
    const criado: any = await api.criarEquipamento({
      tipo: f.tipo,
      nome: f.nome.trim(),
      unidadeId: f.unidadeId || undefined,
      setorId: (kds || imp) && f.setorId ? f.setorId : undefined,
      escopo: kds ? f.escopo : undefined,
      imprimeAoAvancar: kds ? f.imprimeAoAvancar : undefined,
      imprimeNoStatus: kds && f.imprimeAoAvancar ? f.imprimeNoStatus : undefined,
      impressoraDestinoId: kds && f.imprimeAoAvancar && f.impressoraDestinoId ? f.impressoraDestinoId : undefined,
      fazCupom: imp ? f.fazCupom : undefined,
      fazProducao: imp ? f.fazProducao : undefined,
      conexao: imp ? f.conexao : undefined,
      host: imp && !local && f.host.trim() ? f.host.trim() : undefined,
      porta: imp && !local && f.porta ? Number(f.porta) : undefined,
      dispositivo: imp && local && f.dispositivo.trim() ? f.dispositivo.trim() : undefined,
      largura: imp ? Number(f.largura) : undefined,
      codepage: imp && f.codepage ? f.codepage : undefined,
      setoresAtendidos: imp && f.setoresAtendidos.length ? f.setoresAtendidos : undefined,
      padrao: imp ? f.padrao : undefined,
      impressoraPadraoId: pdv && f.impressoraPadraoId ? f.impressoraPadraoId : undefined,
      pdvMainId: salao && f.pdvMainId ? f.pdvMainId : undefined,
    });
    // O próximo KDS tem rota própria: se ela falhar, o equipamento JÁ existe e o token tem de aparecer.
    let aviso = '';
    if (kds && f.proximoKdsId) {
      try {
        await api.setProximoKds(criado.id, f.proximoKdsId);
      } catch (e) {
        aviso = `O KDS foi cadastrado, mas o próximo KDS não foi salvo: ${e instanceof Error ? e.message : 'erro'}. Ajuste em Configurar.`;
      }
    }
    aoCadastrar({ nome: criado.nome, token: criado.token }, aviso);
  }

  /** As rotas a chamar, cada uma só com o que mudou no seu grupo de campos. */
  function passosDeEdicao(): { nome: string; fazer: () => Promise<unknown> }[] {
    const passos: { nome: string; fazer: () => Promise<unknown> }[] = [];
    if (imp) {
      const c: Record<string, unknown> = {};
      if (mudou('nome')) c.nome = f.nome.trim();
      if (!etiqueta && (mudou('fazCupom') || mudou('fazProducao'))) Object.assign(c, { fazCupom: f.fazCupom, fazProducao: f.fazProducao });
      if (mudou('setorId')) c.setorId = f.setorId || null;
      if (mudou('conexao') || mudou('host') || mudou('porta') || mudou('dispositivo')) Object.assign(c, conexaoParaSalvar());
      if (mudou('largura')) c.largura = Number(f.largura);
      if (mudou('codepage')) c.codepage = f.codepage || null;
      if (mudou('setoresAtendidos')) c.setoresAtendidos = f.setoresAtendidos;
      if (mudou('padrao')) c.padrao = f.padrao;
      if (Object.keys(c).length) passos.push({ nome: 'a impressora', fazer: () => api.salvarImpressora({ id: item.id, ...c }) });
      return passos;
    }
    const c: Record<string, unknown> = {};
    if (mudou('nome')) c.nome = f.nome.trim();
    if (kds && mudou('setorId')) c.setorId = f.setorId || null;
    if (kds && mudou('escopo')) c.escopo = f.escopo;
    if (salao && mudou('pdvMainId')) c.pdvMainId = f.pdvMainId;
    if (Object.keys(c).length) passos.push({ nome: 'o cadastro', fazer: () => api.atualizarEquipamento(item.id, c) });
    if (pdv && mudou('impressoraPadraoId')) passos.push({ nome: 'a impressora de cupom', fazer: () => api.setTerminalImpressora(item.id, f.impressoraPadraoId || null) });
    if (kds && (mudou('imprimeAoAvancar') || mudou('imprimeNoStatus') || mudou('impressoraDestinoId')))
      passos.push({ nome: 'a impressão por etapa', fazer: () => api.setImpressaoEtapa(item.id, { imprimeAoAvancar: f.imprimeAoAvancar, imprimeNoStatus: f.imprimeNoStatus, impressoraDestinoId: f.impressoraDestinoId || null }) });
    if (kds && mudou('proximoKdsId')) passos.push({ nome: 'o próximo KDS', fazer: () => api.setProximoKds(item.id, f.proximoKdsId || null) });
    return passos;
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando || travadoPeloServidor) return;
    if (!f.nome.trim()) return falta('Informe o nome do equipamento.', 'eq-nome');
    if (salao && !f.pdvMainId) return falta('Escolha o PDV principal do salão.', 'eq-pdv-main');
    setErro('');
    setSalvando(true);
    try {
      if (novo) return await cadastrar();
      const passos = passosDeEdicao();
      if (!passos.length) return aoFechar();
      const feitos: string[] = [];
      for (const p of passos) {
        try {
          await p.fazer();
          feitos.push(p.nome);
        } catch (err) {
          // O que já foi gravado, foi: a tela diz o que ficou e o que não.
          setErro(`Não salvou ${p.nome}: ${err instanceof Error ? err.message : 'erro'}${feitos.length ? ` (já salvo: ${feitos.join(', ')})` : ''}`);
          setSalvando(false);
          return;
        }
      }
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
  const ficha = (ligada: boolean) =>
    `inline-flex min-h-10 items-center gap-1 rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ligada ? 'border-foreground bg-foreground text-background' : 'border-input bg-card text-foreground hover:bg-secondary'
    }`;
  const ajuda = `text-xs ${texto2}`;

  return (
    <Gaveta
      titulo={novo ? 'Novo equipamento' : `Configurar ${item.nome}`}
      aoFechar={aoFechar}
      voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando || travadoPeloServidor}>{salvando ? 'Salvando…' : novo ? 'Cadastrar equipamento' : 'Salvar alterações'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="eq-tipo">Tipo</Label>
          <Select id="eq-tipo" value={f.tipo} onChange={(e) => muda({ tipo: e.target.value })} disabled={!novo}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            {!TIPOS.some((t) => t.value === f.tipo) && <option value={f.tipo}>{f.tipo}</option>}
          </Select>
          {!novo && <p className={ajuda}>O tipo não muda depois do cadastro.</p>}
        </div>
        {travadoPeloServidor && (
          <p role="alert" className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm">
            Esta loja tem servidor local ativo: impressora e KDS são cadastrados nele, não aqui na nuvem.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="eq-nome">Nome</Label>
          <Input id="eq-nome" data-foco-inicial value={f.nome} maxLength={80} onChange={(e) => muda({ nome: e.target.value })} placeholder="Ex.: Terminal do balcão" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eq-unidade">Unidade</Label>
          <Select id="eq-unidade" value={f.unidadeId} onChange={(e) => muda({ unidadeId: e.target.value })} disabled={!novo}>
            <option value="">— sem unidade —</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            {foraDaLista(f.unidadeId, unidades, 'unidade atual (fora da lista)')}
          </Select>
          {!novo && <p className={ajuda}>A unidade não muda depois do cadastro.</p>}
        </div>

        {pdv && (!item || !ehGogem(item)) && (
          <div className="space-y-1.5">
            <Label htmlFor="eq-imp-cupom">Impressora de cupom{novo ? ' (opcional)' : ''}</Label>
            <Select id="eq-imp-cupom" value={f.impressoraPadraoId} onChange={(e) => muda({ impressoraPadraoId: e.target.value })}>
              <option value="">{novo ? '— definir depois —' : '— nenhuma —'}</option>
              {impressorasDeCupom.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
              {foraDaLista(f.impressoraPadraoId, impressorasDeCupom, 'impressora atual (fora da lista)')}
            </Select>
            <p className={ajuda}>O cupom (via do cliente) sai só nesta impressora deste caixa.</p>
          </div>
        )}

        {salao && (
          <div className="space-y-1.5">
            <Label htmlFor="eq-pdv-main">PDV principal (caixa)</Label>
            <Select id="eq-pdv-main" value={f.pdvMainId} onChange={(e) => muda({ pdvMainId: e.target.value })}>
              <option value="">— escolha o PDV principal —</option>
              {pdvs.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              {foraDaLista(f.pdvMainId, pdvs, 'PDV atual (fora da lista)')}
            </Select>
            <p className={ajuda}>O garçom lança na mesa por este ponto; só abre/fecha mesa com o caixa do PDV principal aberto, e o fechamento cai no caixa dele.</p>
          </div>
        )}

        {(kds || imp) && (
          <div className="space-y-1.5">
            <Label htmlFor="eq-setor">Setor de produção</Label>
            <Select id="eq-setor" value={f.setorId} onChange={(e) => muda({ setorId: e.target.value })}>
              <option value="">— sem setor —</option>
              {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              {foraDaLista(f.setorId, setores, 'setor atual (fora da lista)')}
            </Select>
          </div>
        )}

        {kds && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="eq-escopo">Escopo do KDS</Label>
              <Select id="eq-escopo" value={f.escopo} onChange={(e) => muda({ escopo: e.target.value })}>
                {ESCOPOS.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Imprimir ao avançar</span>
                <Chave ligada={f.imprimeAoAvancar} rotulo="Imprimir ao avançar" aoMudar={(v) => muda({ imprimeAoAvancar: v })} />
              </div>
              <p className={`mt-1 ${ajuda}`}>O ticket só sai quando o pedido avança para a etapa escolhida neste KDS.</p>
            </div>
            {f.imprimeAoAvancar && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="eq-etapa">Etapa que imprime</Label>
                  <Select id="eq-etapa" value={f.imprimeNoStatus} onChange={(e) => muda({ imprimeNoStatus: e.target.value })}>
                    {ETAPAS.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}
                    {!ETAPAS.some((x) => x.v === f.imprimeNoStatus) && <option value={f.imprimeNoStatus}>{f.imprimeNoStatus}</option>}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eq-imp-destino">Impressora de destino</Label>
                  <Select id="eq-imp-destino" value={f.impressoraDestinoId} onChange={(e) => muda({ impressoraDestinoId: e.target.value })}>
                    <option value="">— padrão do setor —</option>
                    {impressoras.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                    {foraDaLista(f.impressoraDestinoId, impressoras, 'impressora atual (fora da lista)')}
                  </Select>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="eq-proximo">Próximo KDS ao avançar</Label>
              <Select id="eq-proximo" value={f.proximoKdsId} onChange={(e) => muda({ proximoKdsId: e.target.value })}>
                <option value="">— nenhum (etapa final) —</option>
                {outrosKds.map((k) => <option key={k.id} value={k.id}>{k.nome}</option>)}
                {foraDaLista(f.proximoKdsId, outrosKds, 'KDS atual (fora da lista)')}
              </Select>
            </div>
          </>
        )}

        {imp && (
          <>
            {etiqueta ? (
              <p className={`rounded-md bg-secondary px-3 py-2 text-sm ${texto2}`}>Esta é uma impressora de <b>etiqueta de validade</b>. O uso dela se troca em Configurações → Impressoras e cupons.</p>
            ) : (
              <div>
                <span className="mb-1 block text-sm font-medium">O que esta impressora imprime</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="O que esta impressora imprime">
                  <button type="button" aria-pressed={f.fazCupom} className={ficha(f.fazCupom)} onClick={() => muda({ fazCupom: !f.fazCupom })}>
                    {f.fazCupom && <span aria-hidden="true">✓</span>}Cupom do cliente (com valores)
                  </button>
                  <button type="button" aria-pressed={f.fazProducao} className={ficha(f.fazProducao)} onClick={() => muda({ fazProducao: !f.fazProducao })}>
                    {f.fazProducao && <span aria-hidden="true">✓</span>}Produção (cozinha/bar — sem valores)
                  </button>
                </div>
                {!f.fazCupom && !f.fazProducao && <p role="status" className="mt-1 rounded-md border-l-4 border-warn bg-warn/10 px-3 py-1.5 text-sm">Marque ao menos um — senão nada será roteado para ela.</p>}
              </div>
            )}
            <div>
              <span className="mb-1 block text-sm font-medium">Conexão</span>
              <div className="grid grid-cols-1 overflow-hidden rounded-md border border-input sm:grid-cols-2" role="group" aria-label="Conexão">
                <button type="button" aria-pressed={!local} className={opcao(!local)} onClick={() => muda({ conexao: 'rede' })}>Rede (impressora com IP)</button>
                <button type="button" aria-pressed={local} className={opcao(local)} onClick={() => muda({ conexao: 'local' })}>Local (USB / instalada no Windows)</button>
              </div>
              <p className={`mt-1 ${ajuda}`}>
                {local ? 'A impressão local roda no servidor local (edge) ou no agente de impressão da máquina do caixa.' : 'Impressora de rede com IP fixo, alcançável na LAN da loja.'}
              </p>
            </div>
            {local ? (
              <div className="space-y-1.5">
                <Label htmlFor="eq-dispositivo">Nome no Windows</Label>
                <Input id="eq-dispositivo" value={f.dispositivo} onChange={(e) => muda({ dispositivo: e.target.value })} placeholder="Ex.: EPSON TM-T20" autoComplete="off" />
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="eq-host">IP da impressora</Label>
                  <Input id="eq-host" value={f.host} onChange={(e) => muda({ host: e.target.value })} placeholder="192.168.1.50" autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eq-porta">Porta</Label>
                  <Input id="eq-porta" inputMode="numeric" value={f.porta} onChange={(e) => muda({ porta: e.target.value.replace(/\D/g, '') })} placeholder="9100" autoComplete="off" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="eq-largura">Papel</Label>
                <Select id="eq-largura" value={f.largura} onChange={(e) => muda({ largura: e.target.value })}>
                  <option value="80">80 mm</option>
                  <option value="58">58 mm</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eq-acentos">Acentos no ticket</Label>
                <Select id="eq-acentos" value={f.codepage} onChange={(e) => muda({ codepage: e.target.value })}>
                  <option value="">Sem acento (funciona em qualquer impressora)</option>
                  <option value="cp860">Com acento — português (CP860)</option>
                  <option value="cp850">Com acento — multilíngue (CP850)</option>
                </Select>
              </div>
            </div>
            <p className={ajuda}>Imprima um teste depois de trocar os acentos. Se sair com símbolos estranhos, volte para “Sem acento”.</p>
            {f.fazProducao && !etiqueta && (
              <div>
                <span className="block text-sm font-medium">Setores atendidos</span>
                <p className={ajuda}>Marque os setores cujos itens saem nesta impressora. Vazio = usa o setor único acima.</p>
                <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Setores atendidos">
                  {setores.length === 0 && <span className={ajuda}>Nenhum setor na lista.</span>}
                  {setores.map((s) => {
                    const ligado = f.setoresAtendidos.includes(s.id);
                    return (
                      <button key={s.id} type="button" aria-pressed={ligado} className={ficha(ligado)} onClick={() => alternarSetor(s.id)}>
                        {ligado && <span aria-hidden="true">✓</span>}{s.nome}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Impressora padrão da unidade <span className={`font-normal ${texto2}`}>(recebe itens sem setor)</span></span>
                  <Chave ligada={f.padrao} rotulo="Impressora padrão da unidade" aoMudar={(v) => muda({ padrao: v })} />
                </div>
              </div>
            )}
          </>
        )}
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}
