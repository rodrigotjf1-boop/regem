'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';

// O CLIQUE REGEM → ORZUNI (mig 416; plano "Clique Regem → Orzuni", R2; mockup `mockups/regem-orzuni-clique.html`,
// aprovado em 13/11/2026): o cartão "Orzuni" na grade de Delivery › Configurações › Integrações e a janela dele. Só o
// presidente liga, pede mais e desliga (OZ-2); o gerente vê a situação. O cartão só aparece com o iFood pelo Orzuni
// liberado para a empresa (OZ-5, no piloto).

type Permissao = { id: string; frase: string; necessaria: boolean };
type Situacao = {
  liberado: boolean;
  naNuvem: boolean;
  podeLigar: boolean;
  loja: { id: string; nome: string } | null;
  escolherLoja: boolean;
  ligacao: null | {
    lojaIfood: string | null;
    lojaIfoodNome: string | null;
    origem: 'chave' | 'clique';
    desde: string;
    por: string | null;
    ultimoUso: string | null;
    permissoes: string[];
  };
  desligadaEm: string | null;
  permissoes: Permissao[];
};

const COR_ORZUNI = '#2B2F3A';
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function LogoOrzuni({ grande = false }: { grande?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-lg font-display font-bold ${grande ? 'h-20 w-20 text-2xl' : 'h-9 w-9 text-sm'}`}
      style={{ background: COR_ORZUNI, color: '#3DDC97' }}
    >
      OZ
    </span>
  );
}

function Selo({ ligado }: { ligado: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ligado ? 'bg-ok/15 text-ok' : 'bg-secondary text-muted-foreground'}`}>
      <span className={`h-2 w-2 rounded-full ${ligado ? 'bg-ok' : 'bg-muted-foreground/40'}`} />
      {ligado ? 'ligado' : 'não ligado'}
    </span>
  );
}

function Aviso({ tipo, titulo, children }: { tipo: 'info' | 'erro'; titulo: string; children?: React.ReactNode }) {
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2.5 text-sm ${tipo === 'erro' ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-foreground'}`}>
      <b className="block">{titulo}</b>
      {children}
    </div>
  );
}

/** A janela do Orzuni (o modelo da janela das outras integrações). Esc e o fundo fecham. */
function Janela({ s, onClose, onMudou }: { s: Situacao; onClose: () => void; onMudou: () => void }) {
  const [indo, setIndo] = useState(false);
  const [mais, setMais] = useState<string[]>([]);
  const [confirmarDesligar, setConfirmarDesligar] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function conectar(o: { mais?: boolean; opcionais?: string[] } = {}) {
    setIndo(true);
    try {
      const { url } = await api.orzuniCliqueIniciar(o);
      window.location.href = url; // a página do Orzuni; a volta é /integracoes/orzuni/volta
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível abrir o Orzuni agora.');
      setIndo(false);
    }
  }

  async function desligar() {
    setIndo(true);
    try {
      await api.orzuniCliqueDesligar();
      toast.success('Orzuni desligado desta loja. O preço e a pausa deixam de ir ao iFood.');
      setConfirmarDesligar(false);
      onMudou();
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível desligar agora.');
    } finally {
      setIndo(false);
    }
  }

  const l = s.ligacao;
  const tem = new Set(l?.permissoes ?? []);
  const opcionaisDeFora = s.permissoes.filter((p) => !p.necessaria && !tem.has(p.id));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Orzuni">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3" style={{ boxShadow: `inset 0 3px 0 ${COR_ORZUNI}` }}>
          <LogoOrzuni />
          <div className="font-display text-base font-bold">Orzuni</div>
          <Selo ligado={!!l} />
          <button type="button" onClick={onClose} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-4">
          {!s.naNuvem ? (
            <Aviso tipo="info" titulo="A ligação com o Orzuni se faz no Regem na nuvem">
              Abra o Regem em app.dmsregem.com, entre com a sua conta e volte a esta tela.
            </Aviso>
          ) : s.escolherLoja || !s.loja ? (
            <Aviso tipo="info" titulo="Escolha a loja no topo da tela">
              Cada loja do Regem se liga a uma loja do iFood. Escolha a loja e abra esta janela de novo.
            </Aviso>
          ) : (
            <>
              {!l && <p className="m-0">Com o Orzuni ligado, o preço e a pausa que você muda no Regem vão sozinhos ao cardápio do iFood.</p>}
              {s.desligadaEm && !l && (
                <Aviso tipo="erro" titulo={`A ligação foi desligada no Orzuni em ${quando(s.desligadaEm)}`}>
                  O preço e a pausa que você muda aqui não vão mais ao iFood. O cardápio do iFood ficou como estava.
                </Aviso>
              )}
              {l ? (
                <dl className="grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Loja do Regem</dt>
                  <dd className="m-0 min-w-0 break-words">{s.loja.nome}</dd>
                  <dt className="text-muted-foreground">Loja do iFood</dt>
                  <dd className="m-0 min-w-0 break-words">{l.lojaIfoodNome || l.lojaIfood || '—'}</dd>
                  <dt className="text-muted-foreground">Ligado</dt>
                  <dd className="m-0 min-w-0 break-words">
                    {l.origem === 'clique' ? `por ${l.por ?? 'presidente'}` : 'pela equipe, com a chave'} em {quando(l.desde)}
                  </dd>
                  <dt className="text-muted-foreground">Último uso</dt>
                  <dd className="m-0">{l.ultimoUso ? quando(l.ultimoUso) : 'ainda não usou'}</dd>
                </dl>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Loja do Regem: <b className="text-foreground">{s.loja.nome}</b> (a loja em uso)
                </div>
              )}

              <div className="rounded-lg border border-border p-3">
                <h3 className="mb-2 font-display text-sm font-semibold">{l ? 'O que está liberado' : 'O que o Regem vai pedir ao Orzuni'}</h3>
                <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                  {s.permissoes.map((p) => {
                    const liberada = tem.has(p.id);
                    const podeMarcar = !!l && l.origem === 'clique' && s.podeLigar && !p.necessaria && !liberada;
                    return (
                      <li key={p.id} className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          {l ? (liberada ? '✓ ' : '') : p.necessaria ? '✓ ' : '+ '}
                          {!l && !p.necessaria ? `Opcional: ${p.frase.charAt(0).toLowerCase()}${p.frase.slice(1)}` : p.frase}
                          {l && !liberada && <small className="block text-xs text-muted-foreground">Não liberado</small>}
                          {!l && !p.necessaria && <small className="block text-xs text-muted-foreground">Você decide na página do Orzuni.</small>}
                        </span>
                        {podeMarcar && (
                          <button
                            type="button"
                            aria-pressed={mais.includes(p.id)}
                            aria-label={`Pedir também: ${p.frase}`}
                            onClick={() => setMais((m) => (m.includes(p.id) ? m.filter((x) => x !== p.id) : [...m, p.id]))}
                            className={`relative h-6 w-11 flex-none rounded-full transition ${mais.includes(p.id) ? 'bg-ok' : 'bg-muted-foreground/30'}`}
                          >
                            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card transition-all ${mais.includes(p.id) ? 'left-[22px]' : 'left-0.5'}`} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {l && l.origem === 'clique' && s.podeLigar && opcionaisDeFora.length > 0 && (
                  <p className="mb-0 mt-2 text-xs text-muted-foreground">
                    Ligue o que quer pedir e use &quot;Pedir mais ao Orzuni&quot;: a página do Orzuni abre de novo só com o que é novo. Se você recusar lá, fica tudo como está.
                  </p>
                )}
              </div>

              {!s.podeLigar ? (
                <Aviso tipo="info" titulo="Só o dono da conta liga o Orzuni">
                  Peça a quem é presidente no Regem. Você vê aqui quando a loja estiver ligada.
                </Aviso>
              ) : confirmarDesligar && l ? (
                <div role="alertdialog" aria-label="Desligar o Orzuni" className="grid gap-2 rounded-lg border border-border p-3">
                  <b className="font-display">Desligar o Orzuni desta loja?</b>
                  <p className="m-0 text-sm text-muted-foreground">
                    O preço e a pausa que você mudar no Regem deixam de ir ao iFood. O cardápio do iFood fica como está agora. Para voltar, é só conectar de novo.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setConfirmarDesligar(false)} disabled={indo}>
                      Cancelar
                    </Button>
                    <Button variant="destructive" onClick={desligar} disabled={indo}>
                      {indo ? 'Desligando…' : 'Desligar'}
                    </Button>
                  </div>
                </div>
              ) : l ? (
                <div className="flex flex-wrap gap-2">
                  {l.origem === 'clique' ? (
                    <Button variant="outline" onClick={() => conectar({ mais: true, opcionais: mais })} disabled={indo || mais.length === 0}>
                      Pedir mais ao Orzuni
                    </Button>
                  ) : (
                    <Button onClick={() => conectar()} disabled={indo}>
                      {indo ? 'Abrindo o Orzuni…' : 'Conectar pelo clique'}
                    </Button>
                  )}
                  <Button variant="outline" className="text-destructive" onClick={() => setConfirmarDesligar(true)} disabled={indo}>
                    Desligar
                  </Button>
                  {l.origem === 'chave' && (
                    <p className="m-0 w-full text-xs text-muted-foreground">
                      Esta loja foi ligada pela equipe, com a chave. Conectando pelo clique, você mesmo autoriza no Orzuni e passa a controlar daqui.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-2">
                  <Button onClick={() => conectar()} disabled={indo} className="w-full">
                    {indo ? 'Abrindo o Orzuni…' : s.desligadaEm ? 'Conectar ao Orzuni de novo' : 'Conectar ao Orzuni'}
                  </Button>
                  <p className="m-0 text-xs text-muted-foreground">
                    Você vai para a página do Orzuni, confere o pedido, escolhe a loja do iFood e confirma com a senha do Orzuni. Ninguém copia chave.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** O cartão do Orzuni na grade das integrações (só com o iFood pelo Orzuni liberado) e a janela dele. */
export function OrzuniIntegracao() {
  const [s, setS] = useState<Situacao | null>(null);
  const [aberto, setAberto] = useState(false);
  const carregar = useCallback(() => {
    api
      .orzuniCliqueSituacao()
      .then((r: Situacao) => setS(r))
      .catch(() => setS(null)); // sem a situação, o cartão não aparece (o resto da grade segue)
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!s?.liberado) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Configurar Orzuni"
        className="group flex w-[200px] max-w-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-4 py-5 text-center transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      >
        <Selo ligado={!!s.ligacao} />
        <LogoOrzuni grande />
        <span className="text-center text-base font-semibold leading-tight">Orzuni</span>
        <small className="text-xs text-muted-foreground">Preço e pausa do Regem direto no cardápio do iFood</small>
      </button>
      {aberto && (
        <Janela
          s={s}
          onClose={() => setAberto(false)}
          onMudou={() => {
            carregar();
          }}
        />
      )}
    </>
  );
}

/** O atalho na Gestão do catálogo enquanto a loja não está ligada (OZ-1). Só para quem pode ligar. */
export function AtalhoOrzuni() {
  const [s, setS] = useState<Situacao | null>(null);
  useEffect(() => {
    api
      .orzuniCliqueSituacao()
      .then((r: Situacao) => setS(r))
      .catch(() => setS(null));
  }, []);
  if (!s?.liberado || !s.naNuvem || !s.podeLigar || s.ligacao || s.escolherLoja) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border border-l-4 border-border border-l-primary bg-card px-3 py-2.5">
      <LogoOrzuni />
      <div className="min-w-0 flex-[1_1_240px]">
        <b className="block text-sm">O iFood pelo Orzuni não está ligado nesta loja</b>
        <small className="text-xs text-muted-foreground">Sem ele, o preço e a pausa que você muda aqui não vão ao iFood.</small>
      </div>
      <Button size="sm" onClick={() => (window.location.href = '/delivery/configuracoes?aba=integracoes')}>
        Ligar o Orzuni
      </Button>
    </div>
  );
}
