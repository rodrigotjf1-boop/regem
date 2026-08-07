'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TIPOS = [
  { value: 'pdv', label: 'Terminal de PDV (caixa)' },
  { value: 'salao', label: 'Sub-PDV Salão (garçom)' },
  { value: 'terminal_ponto', label: 'Terminal de Ponto' },
  { value: 'kds', label: 'KDS (cozinha)' },
  { value: 'impressora', label: 'Impressora térmica' },
  { value: 'servidor_local', label: 'Servidor local (edge)' },
];
const TIPO_LABEL: Record<string, string> = {
  pdv: 'Terminal de PDV',
  salao: 'Sub-PDV Salão',
  terminal_ponto: 'Terminal de Ponto',
  kds: 'KDS',
  impressora: 'Impressora',
  servidor_local: 'Servidor local',
};
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export default function EquipamentosPage() {
  const router = useRouter();
  const [lista, setLista] = useState<any[] | null>(null);
  const [unidades, setUnidades] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const [erro, setErro] = useState('');

  const [tipo, setTipo] = useState('terminal_ponto');
  const [nome, setNome] = useState('');
  const [unidadeId, setUnidadeId] = useState('');
  const [setorId, setSetorId] = useState('');
  const [escopo, setEscopo] = useState('producao');
  // Papel múltiplo (mig 167): a impressora pode servir cupom E/OU produção.
  const [fazCupom, setFazCupom] = useState(false);
  const [fazProducao, setFazProducao] = useState(true);
  const [conexao, setConexao] = useState('rede'); // 'rede' | 'local' (USB/Windows)
  const [host, setHost] = useState('');
  const [porta, setPorta] = useState('9100');
  const [dispositivo, setDispositivo] = useState('');
  const [largura, setLargura] = useState('80');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [setoresAtendidos, setSetoresAtendidos] = useState<string[]>([]);
  const [padrao, setPadrao] = useState(false);
  const [impressoraPadraoId, setImpressoraPadraoId] = useState('');
  const [pdvMainId, setPdvMainId] = useState(''); // sub-PDV salão → PDV main
  const [salvando, setSalvando] = useState(false);
  const [fila, setFila] = useState<any[] | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [publicando, setPublicando] = useState(false);
  const [codigo, setCodigo] = useState<{ nome: string; codigo: string } | null>(null);
  const [tokenNovo, setTokenNovo] = useState<{ nome: string; token: string } | null>(
    null,
  );
  const [copiado, setCopiado] = useState(false);
  const [retarget, setRetarget] = useState<Record<string, string>>({}); // job → impressora escolhida (override)
  // Impressora só tem "alvo" imprimível: rede → tem IP; local → tem nome no Windows.
  const alvoValido = (e: any) => (e.conexao === 'local' ? !!e.dispositivo : !!e.host);

  const reload = useCallback(async () => {
    try {
      const [eqs, unis, sets, f] = await Promise.all([
        api.equipamentos(),
        api.unidades(),
        api.setores().catch(() => []),
        api.impressaoFila().catch(() => []),
      ]);
      setLista(eqs);
      setUnidades(unis);
      setSetores(sets as any[]);
      setFila(f as any[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  function limparForm() {
    setNome('');
    setSetoresAtendidos([]);
    setPadrao(false);
    setConexao('rede');
    setHost('');
    setPorta('9100');
    setDispositivo('');
    setLargura('80');
    setFazCupom(false);
    setFazProducao(true);
    setEditandoId(null);
  }

  // Carrega uma impressora já cadastrada no formulário para editar/configurar.
  function editarImpressora(eq: any) {
    setEditandoId(eq.id);
    setTipo('impressora');
    setNome(eq.nome ?? '');
    setUnidadeId(eq.unidadeId ?? '');
    setSetorId(eq.setorId ?? '');
    // Papel múltiplo (mig 167): usa os flags; se vierem vazios (registro antigo), deriva do papel.
    setFazCupom(eq.fazCupom ?? eq.papel === 'cupom');
    setFazProducao(eq.fazProducao ?? (eq.papel === 'producao' || eq.papel == null));
    setConexao(eq.conexao ?? 'rede');
    setHost(eq.host ?? '');
    setPorta(String(eq.porta ?? 9100));
    setDispositivo(eq.dispositivo ?? '');
    setLargura(String(eq.largura ?? 80));
    setSetoresAtendidos(eq.setoresAtendidos ?? []);
    setPadrao(!!eq.padrao);
    setTokenNovo(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    const local = conexao === 'local';
    try {
      if (editandoId) {
        // Edição de impressora já cadastrada (não gera token novo).
        await api.salvarImpressora({
          id: editandoId,
          nome,
          fazCupom,
          fazProducao,
          setorId: setorId || null,
          conexao,
          host: local ? null : host || null,
          porta: local ? null : porta ? Number(porta) : null,
          dispositivo: local ? dispositivo || null : null,
          largura: Number(largura),
          setoresAtendidos,
          padrao,
        });
        setAviso('Impressora atualizada.');
        limparForm();
        await reload();
        return;
      }
      const novo: any = await api.criarEquipamento({
        tipo,
        nome,
        unidadeId: unidadeId || undefined,
        setorId: (tipo === 'kds' || tipo === 'impressora') && setorId ? setorId : undefined,
        escopo: tipo === 'kds' ? escopo : undefined,
        fazCupom: tipo === 'impressora' ? fazCupom : undefined,
        fazProducao: tipo === 'impressora' ? fazProducao : undefined,
        conexao: tipo === 'impressora' ? conexao : undefined,
        host: tipo === 'impressora' && !local && host ? host : undefined,
        porta: tipo === 'impressora' && !local && porta ? Number(porta) : undefined,
        dispositivo: tipo === 'impressora' && local && dispositivo ? dispositivo : undefined,
        largura: tipo === 'impressora' ? Number(largura) : undefined,
        setoresAtendidos:
          tipo === 'impressora' && setoresAtendidos.length ? setoresAtendidos : undefined,
        padrao: tipo === 'impressora' ? padrao : undefined,
        impressoraPadraoId:
          tipo === 'pdv' && impressoraPadraoId ? impressoraPadraoId : undefined,
        pdvMainId: tipo === 'salao' && pdvMainId ? pdvMainId : undefined,
      });
      setTokenNovo({ nome: novo.nome, token: novo.token });
      setCopiado(false);
      limparForm();
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao cadastrar');
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(id: string, nome: string) {
    if (!confirm(`Revogar "${nome}"? O device perde o acesso imediatamente.`)) return;
    try {
      await api.revogarEquipamento(id);
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao revogar');
    }
  }

  // Código de 6 dígitos para o PC parear (mig 142) — fácil de ditar no suporte.
  async function gerarCodigo(id: string, nome: string) {
    try {
      const r: any = await api.gerarCodigoTerminal(id);
      setCodigo({ nome, codigo: r.codigo });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao gerar o código');
    }
  }

  // Salva a config de impressão por etapa do KDS (mig 129) e recarrega a lista.
  async function salvarImpressaoEtapa(eq: any, patch: Record<string, unknown>) {
    try {
      await api.setImpressaoEtapa(eq.id, {
        imprimeAoAvancar: eq.imprimeAoAvancar ?? false,
        imprimeNoStatus: eq.imprimeNoStatus ?? 'pronto',
        impressoraDestinoId: eq.impressoraDestinoId ?? null,
        ...patch,
      } as any);
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar a impressão por etapa');
    }
  }

  // Fase E — define o próximo KDS da cadeia (ao avançar o card migra para ele).
  async function salvarProximoKds(eq: any, proximoKdsId: string | null) {
    try {
      await api.setProximoKds(eq.id, proximoKdsId);
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar o próximo KDS');
    }
  }

  async function bindImpressora(id: string, impressoraId: string) {
    setErro('');
    try {
      await api.setTerminalImpressora(id, impressoraId || null);
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao vincular impressora');
    }
  }

  async function imprimirTeste(id: string) {
    setAviso('');
    setErro('');
    setTestando(id);
    try {
      await api.impressoraTeste(id);
      setAviso('Página de teste enviada. Se o servidor local estiver ativo, sai em segundos.');
      const f = await api.impressaoFila().catch(() => []);
      setFila(f as any[]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar teste');
    } finally {
      setTestando(null);
    }
  }

  async function reimprimir(id: string, equipamentoId?: string | null) {
    setErro('');
    try {
      await api.reimprimir(id, equipamentoId ?? null);
      const f = await api.impressaoFila().catch(() => []);
      setFila(f as any[]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao reimprimir');
    }
  }

  async function publicarGogem() {
    setAviso('');
    setErro('');
    setPublicando(true);
    try {
      const r: any = await api.post('/integracoes/gogem/publicar', {});
      setAviso(
        r?.alterados != null
          ? `Publicado no GoGeM: ${r.alterados} produto(s) sincronizado(s).`
          : 'Publicado no GoGeM.',
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao publicar no GoGeM');
    } finally {
      setPublicando(false);
    }
  }

  const toggleSetor = (id: string) =>
    setSetoresAtendidos((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  const nomeUnidade = (id: string | null) =>
    unidades.find((u) => u.id === id)?.nome ?? '—';

  return (
    <Shell eyebrow="Gestão" title="Equipamentos & Apps">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Registre os apps satélites (KDS e Terminal de Ponto) que se conectam ao
          Regem. Cada device recebe um token único usado no pareamento.
        </p>

        {/* Integração GoGeM (autoatendimento): empurra pausas/edições na hora */}
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="font-semibold">Integração GoGeM (autoatendimento)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pausou ou editou um produto? Publique para o GoGeM refletir na hora
              (preço, nome e disponibilidade dos itens linkados).
            </p>
          </div>
          <Button type="button" onClick={publicarGogem} disabled={publicando}>
            {publicando ? 'Publicando…' : 'Publicar no GoGeM'}
          </Button>
        </Card>

        {/* Código de pareamento do PC (mig 142) — curto, expira em 15 min */}
        {codigo && (
          <Card className="border-primary/40 bg-primary/5 p-4">
            <h2 className="font-semibold">Código de “{codigo.nome}”</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No computador do caixa, abra o PDV e digite este código. Vale por{' '}
              <strong>15 minutos</strong> e só pode ser usado <strong>uma vez</strong>.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <code className="rounded-md bg-secondary px-4 py-2 font-mono text-2xl tracking-[0.3em]">
                {codigo.codigo}
              </code>
              <Button type="button" variant="outline" onClick={() => setCodigo(null)}>
                Fechar
              </Button>
            </div>
          </Card>
        )}

        {/* Token recém-criado — exibido UMA vez */}
        {tokenNovo && (
          <Card className="border-primary/40 bg-primary/5 p-4">
            <h2 className="font-semibold">Token de “{tokenNovo.nome}”</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Guarde agora — por segurança, ele <strong>não será exibido de novo</strong>.
              Use no pareamento do device.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-md bg-secondary px-3 py-2 font-mono text-sm">
                {tokenNovo.token}
              </code>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(tokenNovo.token);
                  setCopiado(true);
                }}
              >
                {copiado ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setTokenNovo(null)}
              className="mt-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Já guardei, fechar
            </button>
          </Card>
        )}

        {aviso && (
          <Card className="border-emerald-500/40 bg-emerald-500/5 p-3">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{aviso}</p>
          </Card>
        )}

        {/* Cadastro */}
        <Card className="p-4">
          <h2 className="mb-3 font-display text-lg font-semibold">
            {editandoId ? 'Editar impressora' : 'Novo equipamento'}
          </h2>
          <form onSubmit={cadastrar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <select
                id="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                disabled={!!editandoId}
                className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60"
              >
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Terminal do balcão"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unidade">Unidade</Label>
              <select
                id="unidade"
                value={unidadeId}
                onChange={(e) => setUnidadeId(e.target.value)}
                className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">— sem unidade —</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* PDV: impressora de cupom (via do cliente) amarrada ao terminal */}
            {tipo === 'pdv' && (
              <div className="space-y-1.5">
                <Label htmlFor="imp-pdv">Impressora de cupom (opcional)</Label>
                <select
                  id="imp-pdv"
                  value={impressoraPadraoId}
                  onChange={(e) => setImpressoraPadraoId(e.target.value)}
                  className={selectCls}
                >
                  <option value="">— definir depois —</option>
                  {(lista ?? [])
                    .filter((e: any) => e.tipo === 'impressora' && e.fazCupom && e.ativo)
                    .map((imp: any) => (
                      <option key={imp.id} value={imp.id}>{imp.nome}</option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  O cupom (via do cliente) sai só nesta impressora deste caixa.
                </p>
              </div>
            )}

            {/* Sub-PDV salão: atrela a um PDV main (caixa principal) */}
            {tipo === 'salao' && (
              <div className="space-y-1.5">
                <Label htmlFor="pdv-main">PDV principal (caixa)</Label>
                <select
                  id="pdv-main"
                  value={pdvMainId}
                  onChange={(e) => setPdvMainId(e.target.value)}
                  className={selectCls}
                  required
                >
                  <option value="">— escolha o PDV main —</option>
                  {(lista ?? [])
                    .filter((e: any) => e.tipo === 'pdv' && e.ativo)
                    .map((p: any) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  O garçom lança na mesa por este ponto; só abre/fecha mesa com o caixa
                  do PDV principal aberto, e o fechamento cai no caixa dele.
                </p>
              </div>
            )}

            {/* KDS/impressora: setor de produção */}
            {(tipo === 'kds' || tipo === 'impressora') && (
              <div className="space-y-1.5">
                <Label htmlFor="setor">Setor de produção</Label>
                <select id="setor" value={setorId} onChange={(e) => setSetorId(e.target.value)} className={selectCls}>
                  <option value="">— sem setor —</option>
                  {setores.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
            )}

            {/* KDS: escopo (produção / entrega / só avisos) */}
            {tipo === 'kds' && (
              <div className="space-y-1.5">
                <Label htmlFor="escopo">Escopo do KDS</Label>
                <select id="escopo" value={escopo} onChange={(e) => setEscopo(e.target.value)} className={selectCls}>
                  <option value="producao">Produção (pedidos)</option>
                  <option value="entrega">Entrega (retirada por senha)</option>
                  <option value="avisos">Só avisos (tarefas/picos)</option>
                </select>
              </div>
            )}

            {/* Impressora: papel + host + porta */}
            {tipo === 'impressora' && (
              <>
                <div className="space-y-1.5">
                  <Label>O que esta impressora imprime</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={fazCupom}
                        onChange={(e) => setFazCupom(e.target.checked)}
                      />
                      <span>Cupom do cliente <span className="text-muted-foreground">(com valores)</span></span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={fazProducao}
                        onChange={(e) => setFazProducao(e.target.checked)}
                      />
                      <span>Produção <span className="text-muted-foreground">(cozinha/bar — sem valores)</span></span>
                    </label>
                  </div>
                  {!fazCupom && !fazProducao && (
                    <p className="text-xs text-destructive">Marque ao menos um — senão nada será roteado para ela.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conexao">Conexão</Label>
                  <select id="conexao" value={conexao} onChange={(e) => setConexao(e.target.value)} className={selectCls}>
                    <option value="rede">Rede (impressora com IP)</option>
                    <option value="local">Local (USB / instalada no Windows)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {conexao === 'local'
                      ? 'A impressão local roda no servidor local (edge) ou no agente de impressão da máquina do caixa.'
                      : 'Impressora de rede com IP fixo, alcançável na LAN da loja.'}
                  </p>
                </div>
                {conexao === 'local' ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="dispositivo">Nome no Windows</Label>
                      <Input id="dispositivo" value={dispositivo} onChange={(e) => setDispositivo(e.target.value)} placeholder="Ex.: EPSON TM-T20" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="largura">Papel</Label>
                      <select id="largura" value={largura} onChange={(e) => setLargura(e.target.value)} className={selectCls} title="Largura do papel">
                        <option value="80">80 mm</option>
                        <option value="58">58 mm</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="host">IP da impressora</Label>
                      <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="porta">Porta</Label>
                      <Input id="porta" type="number" value={porta} onChange={(e) => setPorta(e.target.value)} placeholder="9100" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="largura">Papel</Label>
                      <select id="largura" value={largura} onChange={(e) => setLargura(e.target.value)} className={selectCls} title="Largura do papel">
                        <option value="80">80 mm</option>
                        <option value="58">58 mm</option>
                      </select>
                    </div>
                  </div>
                )}
                {/* Produção: setores que a impressora atende (cozinha, bar…) */}
                {fazProducao && (
                  <div className="space-y-1.5">
                    <Label>Setores atendidos</Label>
                    <p className="text-xs text-muted-foreground">
                      Marque os setores cujos itens saem nesta impressora. Vazio = usa o setor único acima.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {setores.length === 0 && (
                        <span className="text-xs text-muted-foreground">Nenhum setor cadastrado.</span>
                      )}
                      {setores.map((s) => {
                        const on = setoresAtendidos.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleSetor(s.id)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                              on
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/50'
                            }`}
                          >
                            {s.nome}
                          </button>
                        );
                      })}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={padrao}
                        onChange={(e) => setPadrao(e.target.checked)}
                        className="h-4 w-4 rounded border-input"
                      />
                      Impressora padrão da unidade (recebe itens sem setor)
                    </label>
                  </div>
                )}
              </>
            )}
            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Cadastrar equipamento'}
              </Button>
              {editandoId && (
                <Button type="button" variant="ghost" onClick={limparForm} disabled={salvando}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </Card>

        {/* Lista */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Equipamentos {lista ? `(${lista.length})` : ''}
          </p>
          {!lista && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {lista && lista.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum equipamento cadastrado ainda.
            </p>
          )}
          <div className="space-y-2">
            {lista?.map((eq) => (
              <div
                key={eq.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{eq.nome}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                      {TIPO_LABEL[eq.tipo] ?? eq.tipo}
                    </span>
                    {eq.padrao && eq.tipo === 'terminal_ponto' && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                        REP-Software
                      </span>
                    )}
                    {!eq.ativo && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                        Revogado
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {nomeUnidade(eq.unidadeId)}
                    {eq.tipo === 'impressora' && eq.conexao === 'local'
                      ? ` · USB: ${eq.dispositivo || '(sem nome)'}`
                      : eq.tipo === 'impressora' && eq.host
                        ? ` · ${eq.host}:${eq.porta ?? 9100}`
                        : eq.tipo === 'impressora'
                          ? ' · sem destino'
                          : ''}
                    {eq.tipo === 'impressora' ? ` · ${eq.largura ?? 80}mm` : ''}
                    {eq.tipo === 'impressora' && (eq.setoresAtendidos?.length ?? 0) > 0
                      ? ` · ${eq.setoresAtendidos.length} setor(es)`
                      : ''}
                    {eq.tipo === 'impressora' && eq.padrao ? ' · padrão' : ''}
                    {eq.tipo === 'kds' && eq.escopo === 'avisos' ? ' · só avisos' : ''}
                    {eq.tipo === 'salao' && eq.pdvMainId
                      ? ` · main: ${(lista ?? []).find((x: any) => x.id === eq.pdvMainId)?.nome ?? '—'}`
                      : ''}
                    {eq.ultimoPing
                      ? ` · último acesso ${new Date(eq.ultimoPing).toLocaleString('pt-BR')}`
                      : ' · nunca conectou'}
                  </div>
                  {eq.tipo === 'pdv' && eq.ativo && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Impressora de cupom:</span>
                      <select
                        aria-label={`Impressora de cupom do terminal ${eq.nome}`}
                        value={eq.impressoraPadraoId ?? ''}
                        onChange={(e) => bindImpressora(eq.id, e.target.value)}
                        className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                      >
                        <option value="">— nenhuma —</option>
                        {(lista ?? [])
                          .filter((p: any) => p.tipo === 'impressora' && p.fazCupom && p.ativo)
                          .map((p: any) => (
                            <option key={p.id} value={p.id}>{p.nome}</option>
                          ))}
                      </select>
                    </div>
                  )}
                  {/* KDS — impressão guiada por etapa (mig 129): o ticket só sai
                      quando o pedido AVANÇA para a etapa escolhida neste KDS. */}
                  {eq.tipo === 'kds' && eq.ativo && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-primary"
                          checked={!!eq.imprimeAoAvancar}
                          onChange={(e) => salvarImpressaoEtapa(eq, { imprimeAoAvancar: e.target.checked })}
                        />
                        <span>Imprimir ao avançar</span>
                      </label>
                      {eq.imprimeAoAvancar && (
                        <>
                          <select
                            aria-label={`Etapa que dispara a impressão no ${eq.nome}`}
                            value={eq.imprimeNoStatus ?? 'pronto'}
                            onChange={(e) => salvarImpressaoEtapa(eq, { imprimeNoStatus: e.target.value })}
                            className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                          >
                            <option value="preparo">ao iniciar preparo</option>
                            <option value="pronto">ao ficar pronto</option>
                            <option value="entregue">ao despachar/entregar</option>
                          </select>
                          <select
                            aria-label={`Impressora de destino do ${eq.nome}`}
                            value={eq.impressoraDestinoId ?? ''}
                            onChange={(e) => salvarImpressaoEtapa(eq, { impressoraDestinoId: e.target.value || null })}
                            className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                          >
                            <option value="">— padrão do setor —</option>
                            {(lista ?? [])
                              .filter((p: any) => p.tipo === 'impressora' && p.ativo)
                              .map((p: any) => (
                                <option key={p.id} value={p.id}>{p.nome}</option>
                              ))}
                          </select>
                        </>
                      )}
                    </div>
                  )}
                  {eq.tipo === 'kds' && eq.ativo && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Próximo KDS ao avançar:</span>
                      <select
                        aria-label={`Próximo KDS da cadeia após o ${eq.nome}`}
                        value={eq.proximoKdsId ?? ''}
                        onChange={(e) => salvarProximoKds(eq, e.target.value || null)}
                        className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                      >
                        <option value="">— nenhum (etapa final) —</option>
                        {(lista ?? [])
                          .filter((k: any) => k.tipo === 'kds' && k.ativo && k.id !== eq.id)
                          .map((k: any) => (
                            <option key={k.id} value={k.id}>{k.nome}</option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
                {eq.tipo === 'impressora' && eq.ativo && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => editarImpressora(eq)}
                  >
                    Configurar
                  </Button>
                )}
                {eq.tipo === 'impressora' && eq.ativo && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={testando === eq.id}
                    onClick={() => imprimirTeste(eq.id)}
                  >
                    {testando === eq.id ? 'Enviando…' : 'Imprimir teste'}
                  </Button>
                )}
                {eq.ativo && ['pdv', 'salao'].includes(eq.tipo) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => gerarCodigo(eq.id, eq.nome)}
                  >
                    Gerar código de pareamento
                  </Button>
                )}
                {eq.ativo && !eq.padrao && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => revogar(eq.id, eq.nome)}
                    className="text-destructive"
                  >
                    Revogar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Fila de impressão (status + reimpressão de falhas) */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Fila de impressão {fila ? `(${fila.length})` : ''}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => setFila((await api.impressaoFila().catch(() => [])) as any[])}
            >
              Atualizar
            </Button>
          </div>
          {fila && fila.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma impressão ainda. Confirme um pedido ou use “Imprimir teste”.
            </p>
          )}
          <div className="space-y-1.5">
            {fila?.map((j) => (
              <div
                key={j.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span
                  className={`h-2 w-2 flex-none rounded-full ${
                    j.status === 'impresso'
                      ? 'bg-emerald-500'
                      : j.status === 'erro'
                        ? 'bg-red-500'
                        : 'bg-amber-500 animate-pulse'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{j.impressora ?? '—'}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                      {j.via}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {j.status === 'impresso'
                        ? 'impresso'
                        : j.status === 'erro'
                          ? `falhou (${j.tentativas}x)`
                          : 'na fila'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(j.criadoEm).toLocaleString('pt-BR')}
                    {j.status === 'erro' && j.erro ? ` · ${j.erro}` : ''}
                  </div>
                </div>
                {j.status === 'erro' && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label="Imprimir em (outra impressora)"
                      value={retarget[j.id] ?? ''}
                      onChange={(e) => setRetarget((r) => ({ ...r, [j.id]: e.target.value }))}
                      className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                      title="Imprimir em outra impressora"
                    >
                      <option value="">mesma impressora</option>
                      {(lista ?? [])
                        .filter((e: any) => e.tipo === 'impressora' && e.ativo && alvoValido(e))
                        .map((e: any) => (
                          <option key={e.id} value={e.id}>{e.nome}</option>
                        ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => reimprimir(j.id, retarget[j.id] || null)}
                    >
                      Reimprimir
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
