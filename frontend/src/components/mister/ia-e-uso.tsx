'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Selo, hojeIso, type Tom } from '@/components/ui/lista';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';

// MISTER › IA E USO (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026; rotas da mig 415).
// A chave de IA da EMPRESA (o presidente cola, o servidor prova no provedor antes de guardar; ela nunca volta — só o
// provedor, os 4 últimos caracteres e a situação) e o medidor de uso com o custo estimado. Só o presidente, só na nuvem:
// quem decide se a tela aparece é a página (`app/mister/page.tsx`); aqui é só a tela.

type Situacao = 'ok' | 'chave_recusada' | 'sem_credito' | 'teto_atingido';
export type EstadoDaChave = {
  provedoresAceitos: string[];
  origem: 'propria' | 'incluida' | null;
  chave: { provedor: string; final: string; situacao: Situacao; conferidaEm: string | null; salvaEm: string | null } | null;
};
type Tokens = { entrada: number; cacheEscrita: number; cacheLeitura: number; saida: number };
type ItemDeUso = {
  recurso: string;
  provedor: string;
  modelo: string;
  origem: 'lojista' | 'distribuicao';
  chamadas: number;
  falhas: number;
  tokens: Tokens;
  custoEstimadoUsd: number | null;
};
type Uso = { de: string; ate: string; precosLidosEm: string; itens: ItemDeUso[]; custoEstimadoUsd: { lojista: number; distribuicao: number }; semPreco: string[] };

const PROVEDOR: Record<string, string> = { anthropic: 'Anthropic' };
// `mister_perguntas` = o agente que responde às perguntas pelo WhatsApp (o nome vem do `RECURSO_DAS_PERGUNTAS` do servidor).
const RECURSO: Record<string, string> = { copiloto: 'Copiloto do atendimento', prova: 'Teste da chave', mister_perguntas: 'Mister · perguntas' };
const MODELO: Record<string, string> = {
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
};
const SITUACAO: Record<Situacao, { tom: Tom; selo: string; fundo: string; texto: string; falha: string }> = {
  ok: { tom: 'ok', selo: 'funcionando', fundo: 'bg-ok/15', texto: '', falha: '' },
  sem_credito: {
    tom: 'aviso',
    selo: 'sem crédito',
    fundo: 'bg-warn/15',
    texto: 'A sua conta na Anthropic ficou sem crédito. Compre crédito no console dela e clique em "Testar conexão".',
    falha: 'a conta está sem crédito.',
  },
  teto_atingido: {
    tom: 'aviso',
    selo: 'teto de gasto atingido',
    fundo: 'bg-warn/15',
    texto: 'O limite de gasto que você definiu na Anthropic foi alcançado. Ele zera no dia 1º, ou você aumenta o limite no console dela.',
    falha: 'o teto de gasto da conta foi atingido.',
  },
  chave_recusada: {
    tom: 'critico',
    selo: 'recusada',
    fundo: 'bg-destructive/15',
    texto: 'A Anthropic não aceita mais esta chave. Confira no console dela se a chave está ativa, ou cadastre outra.',
    falha: 'a Anthropic recusou a chave.',
  },
};

/** "3,4 mi", "810 mil", "16": o tamanho do consumo sem encher a linha de dígitos. */
export function tokensCurtos(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`;
  return v.toLocaleString('pt-BR');
}
/** Custo em dólar (a conta do provedor é em dólar); sem preço na tabela = travessão. */
export function emDolar(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `US$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const menosDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
function diaEHora(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `${dia} às ${hora}`;
}
const mensagem = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

export function IaEUso() {
  return (
    <div className="space-y-5">
      <ChaveDeIa />
      <UsoDaIa />
    </div>
  );
}

// ───────────────────────────── a chave ─────────────────────────────

function ChaveDeIa() {
  const idProvedor = useId();
  const idChave = useId();
  const idAjuda = useId();
  const [estado, setEstado] = useState<EstadoDaChave | null>(null);
  const [erro, setErro] = useState(false);
  const [provedor, setProvedor] = useState('anthropic');
  const [chave, setChave] = useState('');
  const [ocupado, setOcupado] = useState<'salvar' | 'testar' | 'apagar' | null>(null);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guia, setGuia] = useState(false);
  const [apagando, setApagando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setEstado((await api.get('/ia/chave')) as EstadoDaChave);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    const valor = chave.trim();
    if (!valor) {
      toast.error('Cole a chave de IA.');
      return;
    }
    setOcupado('salvar');
    try {
      const r = (await api.post('/ia/chave', { provedor, chave: valor })) as EstadoDaChave;
      setEstado(r);
      setChave('');
      setTeste(null);
      const s = r.chave?.situacao ?? 'ok';
      if (s === 'ok') toast.success('Chave conferida e salva.');
      else toast.info(`Chave salva, mas ${SITUACAO[s].falha}`);
    } catch (e) {
      toast.error(mensagem(e, 'Não deu para salvar a chave agora.'));
    } finally {
      setOcupado(null);
    }
  }

  async function testar() {
    if (!estado?.chave) {
      setTeste({ ok: false, texto: 'Cole a chave e clique em "Salvar chave": ela é testada antes de ser guardada.' });
      return;
    }
    setOcupado('testar');
    try {
      const r = (await api.post('/ia/chave/testar', {})) as EstadoDaChave;
      setEstado(r);
      const s = r.chave?.situacao ?? 'ok';
      setTeste(s === 'ok' ? { ok: true, texto: 'Conectado ✓ — a chave e o crédito estão em ordem.' } : { ok: false, texto: `Falhou: ${SITUACAO[s].falha}` });
    } catch (e) {
      setTeste({ ok: false, texto: mensagem(e, 'Não deu para testar agora.') });
    } finally {
      setOcupado(null);
    }
  }

  async function apagar() {
    setOcupado('apagar');
    try {
      setEstado((await api.del('/ia/chave')) as EstadoDaChave);
      setTeste(null);
      setApagando(false);
      toast.success('Chave apagada.');
    } catch (e) {
      toast.error(mensagem(e, 'Não deu para apagar a chave agora.'));
    } finally {
      setOcupado(null);
    }
  }

  const salva = estado?.chave ?? null;
  const sit = salva ? SITUACAO[salva.situacao] ?? SITUACAO.ok : null;
  const aceitos = estado?.provedoresAceitos?.length ? estado.provedoresAceitos : ['anthropic'];

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-bold">Chave de IA</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        A IA do Mister roda na conta que você tem na empresa de IA, com os seus créditos. A chave é o que deixa o Regem usar essa conta.
      </p>

      {erro && (
        <div role="alert" className="mt-4 rounded-md bg-destructive/15 px-3 py-2 text-sm">
          Não consegui ler a situação da chave agora.{' '}
          <button type="button" className="inline-flex min-h-11 items-center font-semibold underline" onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      )}
      {!erro && !estado && <SkeletonList rows={1} className="mt-4" />}

      {estado && (
        <>
          <div role="status" className={`mt-4 rounded-md px-3 py-2 text-sm ${sit ? sit.fundo : estado.origem === 'incluida' ? 'bg-info/15' : 'bg-warn/15'}`}>
            {salva && sit ? (
              <>
                <span className="mr-2">
                  Chave salva · final <span className="font-mono font-semibold">{salva.final}</span>
                  {salva.conferidaEm ? ` · conferida em ${diaEHora(salva.conferidaEm)}` : ''}
                </span>
                <Selo tom={sit.tom}>{sit.selo}</Selo>
                {sit.texto && <span className="mt-1 block">{sit.texto}</span>}
              </>
            ) : estado.origem === 'incluida' ? (
              <>
                <strong>IA incluída pela Regem.</strong> Você não precisa de chave agora. Se cadastrar a sua, o Regem passa a usar a sua conta.
              </>
            ) : (
              <>
                <strong>Esta empresa está sem IA.</strong> Cadastre a chave da sua conta para o Mister responder e fazer relatórios.
              </>
            )}
          </div>

          <div className="mt-4 grid max-w-xl gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={idProvedor}>Empresa de IA</Label>
              <Select id={idProvedor} value={provedor} onChange={(e) => setProvedor(e.target.value)}>
                {aceitos.map((p) => (
                  <option key={p} value={p}>
                    {PROVEDOR[p] ?? p}
                  </option>
                ))}
                <option disabled>OpenAI (em teste, ainda não disponível)</option>
                <option disabled>Gemini (em teste, ainda não disponível)</option>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={idChave}>{salva ? 'Chave de API (salva)' : 'Chave de API'}</Label>
              <Input
                id={idChave}
                type="password"
                spellCheck={false}
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                aria-describedby={idAjuda}
                placeholder={salva ? '•••••• (mantém)' : 'cole a chave que começa com sk-ant-'}
              />
              <p id={idAjuda} className="text-sm text-muted-foreground">
                A chave fica cifrada, não aparece de novo e não vai para o servidor da loja. Só o presidente cadastra ou troca.
                {salva ? ' Deixe em branco para manter a que está salva.' : ''}
              </p>
            </div>
          </div>

          <p className="mt-1 text-sm">
            <button type="button" className="inline-flex min-h-11 items-center text-left font-semibold text-info underline underline-offset-2" onClick={() => setGuia(true)}>
              Como criar a chave, passo a passo
            </button>
          </p>
          <p className="text-sm text-muted-foreground">O teste faz uma chamada mínima na sua conta (fração de centavo) e confere a chave e o crédito.</p>
          {teste && (
            <p role="status" className={`mt-2 text-sm font-medium ${teste.ok ? 'text-ok' : 'text-destructive'}`}>
              {teste.texto}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void testar()} disabled={ocupado !== null}>
              {ocupado === 'testar' ? 'Testando…' : 'Testar conexão'}
            </Button>
            <Button type="button" onClick={() => void salvar()} disabled={ocupado !== null}>
              {ocupado === 'salvar' ? 'Conferindo a chave…' : 'Salvar chave'}
            </Button>
            {salva && (
              <Button type="button" variant="outline" className="border-destructive/40 text-destructive" onClick={() => setApagando(true)} disabled={ocupado !== null}>
                Apagar a chave
              </Button>
            )}
          </div>
        </>
      )}

      {apagando && (
        <Dialogo
          titulo="Apagar a chave de IA"
          aoFechar={() => setApagando(false)}
          alerta
          fecharNoFundo={false}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setApagando(false)} disabled={ocupado === 'apagar'}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void apagar()} disabled={ocupado === 'apagar'}>
                {ocupado === 'apagar' ? 'Apagando…' : 'Apagar a chave'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            A chave sai do Regem na hora. O que usa a IA desta empresa para de usar a sua conta. A chave continua valendo na Anthropic: para invalidar, apague lá também.
          </p>
        </Dialogo>
      )}

      {guia && (
        <Gaveta titulo="Como criar a chave na Anthropic" aoFechar={() => setGuia(false)} fecharNoFundo rodape={<Button type="button" onClick={() => setGuia(false)}>Fechar</Button>}>
          <GuiaDaChave />
        </Gaveta>
      )}
    </Card>
  );
}

function Fora({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-info underline underline-offset-2">
      {children}
    </a>
  );
}

/**
 * O passo a passo. O console da Anthropic aparece no idioma do navegador: os nomes daqui são os da versão em português,
 * conferidos nas telas do dono em 13/11/2026; entre parênteses, o nome em inglês (documentação oficial, 12/11/2026).
 */
function GuiaDaChave() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        O console da Anthropic aparece no idioma do seu navegador. Os nomes abaixo são os da versão em português; entre parênteses, o nome em inglês. Leva uns dez minutos.
      </p>
      <ol className="list-decimal space-y-4 pl-5">
        <li>
          <strong>Crie a conta.</strong> Abra <Fora href="https://platform.claude.com/">platform.claude.com</Fora> e crie a conta do Claude Console, com um e-mail da empresa. A chave fica
          ligada à pessoa que a criou.
        </li>
        <li>
          <strong>Ponha saldo.</strong> No <strong>Painel</strong>, no quadro “Créditos da organização”, clique em <strong>Adicionar saldo</strong> (Buy credits), cadastre o cartão,
          digite o valor e confirme. O mesmo quadro fica em <strong>Faturamento</strong> (Billing):{' '}
          <Fora href="https://platform.claude.com/settings/billing">platform.claude.com/settings/billing</Fora>. A cobrança é em dólar. O saldo vale na hora, vence um ano depois e não
          tem reembolso. Comece com um valor pequeno e deixe a recarga automática desligada.
        </li>
        <li>
          <strong>Crie uma área só para o Regem.</strong> No seletor de área de trabalho, no alto da tela, clique em <strong>Criar workspace</strong> (Create workspace). Dê o nome{' '}
          <span className="font-mono">Regem</span>, deixe o resto como está e conclua. Assim o gasto fica separado e ganha um teto só dele.
        </li>
        <li>
          <strong>Defina o teto de gasto.</strong> No mesmo seletor, clique em <strong>Gerenciar workspaces</strong>, depois na área <span className="font-mono">Regem</span> e em{' '}
          <strong>Limites de gastos</strong> (Spend limits). Em “Limite de gastos mensais”, clique em <strong>Ajustar limite</strong> e defina o máximo por mês: é o que garante que a
          conta nunca passa do valor que você escolheu. Em “Notificações por e-mail”, clique em <strong>Adicionar notificação</strong> para ser avisado um pouco antes do teto.
        </li>
        <li>
          <strong>Crie a chave.</strong> No menu, abra <strong>Chaves de API</strong> (API keys:{' '}
          <Fora href="https://platform.claude.com/settings/keys">platform.claude.com/settings/keys</Fora>) e clique em <strong>Criar chave</strong> (Create key). Se abrir uma janela
          sobre federação de identidade, clique em <strong>Continuar com uma chave de API</strong>. Nome: <span className="font-mono">regem</span>. Em <strong>Expira</strong>, troque
          “30 dias” por <strong>Nunca</strong> (Never) — com a validade de 30 dias, o Mister pararia de responder no mês que vem. Em <strong>Conta vinculada</strong> (Linked account),
          você mesmo. Em <strong>Escopo</strong>, a área <span className="font-mono">Regem</span>. Clique em <strong>Criar chave</strong> e copie a chave, que começa com{' '}
          <span className="font-mono">sk-ant-</span>. Ela só aparece nessa hora.
        </li>
        <li>
          <strong>Cole aqui e salve.</strong> Feche este guia, cole a chave no campo e clique em “Salvar chave”. O Regem testa antes de guardar.
        </li>
      </ol>
      <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
        Não mande a chave por WhatsApp, e-mail ou foto de tela. Se suspeitar de vazamento, abra <strong>Chaves de API</strong>, desative ou apague a chave (Disable ou Delete), crie
        outra e cole aqui.
      </p>
    </div>
  );
}

// ───────────────────────────── o uso ─────────────────────────────

const ATALHOS = [
  { rotulo: 'Hoje', dias: 0 },
  { rotulo: '7 dias', dias: 6 },
  { rotulo: '30 dias', dias: 29 },
] as const;

function UsoDaIa() {
  const idDe = useId();
  const idAte = useId();
  // A data de hoje fica fora do primeiro desenho da tela (V35): entra depois de montar.
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [uso, setUso] = useState<Uso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(true);

  useEffect(() => {
    const hoje = hojeIso();
    setAte(hoje);
    setDe(menosDias(hoje, 29));
  }, []);

  const invertido = !!de && !!ate && de > ate;
  const ler = useCallback(async () => {
    if (!de || !ate || de > ate) return;
    setLendo(true);
    setErro(null);
    try {
      setUso((await api.get(`/ia/uso?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`)) as Uso);
    } catch (e) {
      setUso(null);
      setErro(mensagem(e, 'Não consegui ler o uso agora.'));
    } finally {
      setLendo(false);
    }
  }, [de, ate]);
  useEffect(() => {
    void ler();
  }, [ler]);

  const hoje = ate ? hojeIso() : '';
  const atalho = (dias: number) => {
    const h = hojeIso();
    setAte(h);
    setDe(menosDias(h, dias));
  };

  const colunas: Column<ItemDeUso>[] = [
    {
      key: 'recurso',
      header: 'Recurso',
      render: (i) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <strong>{RECURSO[i.recurso] ?? i.recurso}</strong>
          {i.origem === 'distribuicao' && <Selo tom="info">IA incluída</Selo>}
          {i.falhas > 0 && <span className="text-xs text-muted-foreground">{i.falhas === 1 ? '1 falha' : `${i.falhas} falhas`}</span>}
        </span>
      ),
    },
    { key: 'modelo', header: 'Modelo', render: (i) => MODELO[i.modelo] ?? i.modelo },
    { key: 'chamadas', header: 'Chamadas', align: 'right', mono: true, render: (i) => i.chamadas.toLocaleString('pt-BR') },
    {
      key: 'tokens',
      header: 'Tokens (entrada · saída)',
      align: 'right',
      mono: true,
      render: (i) => `${tokensCurtos(i.tokens.entrada + i.tokens.cacheEscrita + i.tokens.cacheLeitura)} · ${tokensCurtos(i.tokens.saida)}`,
    },
    { key: 'custo', header: 'Custo estimado', align: 'right', mono: true, render: (i) => (i.custoEstimadoUsd === null ? 'sem preço' : emDolar(i.custoEstimadoUsd)) },
  ];
  const chamadas = uso?.itens.reduce((s, i) => s + i.chamadas, 0) ?? 0;

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-bold">Uso da IA</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Quanto cada parte gastou no período. É uma estimativa: a conta de verdade é a do console da empresa de IA.</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="grid w-full max-w-[11rem] gap-1.5">
          <Label htmlFor={idDe}>De</Label>
          <Input id={idDe} type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="grid w-full max-w-[11rem] gap-1.5">
          <Label htmlFor={idAte}>Até</Label>
          <Input id={idAte} type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Atalhos de período">
          {ATALHOS.map((a) => (
            <Button key={a.rotulo} type="button" variant="outline" aria-pressed={!!hoje && ate === hoje && de === menosDias(hoje, a.dias)} onClick={() => atalho(a.dias)}>
              {a.rotulo}
            </Button>
          ))}
        </div>
      </div>
      {invertido && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          A data inicial vem depois da final.
        </p>
      )}

      <div className="mt-4">
        {lendo && !invertido && <SkeletonList rows={2} />}
        {!lendo && erro && (
          <EmptyState
            icon="⚠️"
            title="Não consegui ler o uso agora."
            description={erro}
            action={
              <Button type="button" variant="outline" onClick={() => void ler()}>
                Tentar de novo
              </Button>
            }
          />
        )}
        {!lendo && !erro && uso && uso.itens.length === 0 && <EmptyState icon="📊" title="Nenhum uso de IA neste período." />}
        {!lendo && !erro && uso && uso.itens.length > 0 && (
          <>
            <ResponsiveTable
              caption="Uso da IA por recurso e modelo, com chamadas, tokens e custo estimado em dólar"
              columns={colunas}
              rows={uso.itens}
              rowKey={(i) => `${i.recurso}|${i.modelo}|${i.origem}`}
            />
            <p className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm font-semibold">
              <span>
                Total do período: <span className="font-mono">{chamadas.toLocaleString('pt-BR')}</span> chamadas
              </span>
              <span>
                Na sua chave: <span className="font-mono">{emDolar(uso.custoEstimadoUsd.lojista)}</span>
                {uso.custoEstimadoUsd.distribuicao > 0 && (
                  <>
                    {' '}
                    · IA incluída: <span className="font-mono">{emDolar(uso.custoEstimadoUsd.distribuicao)}</span>
                  </>
                )}
              </span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Preços da tabela pública da Anthropic lida em {uso.precosLidosEm.split('-').reverse().join('/')}.
              {uso.semPreco.length > 0 ? ` Sem preço na tabela (fora da soma): ${uso.semPreco.join(', ')}.` : ' Modelo que não está na tabela aparece sem preço.'}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
