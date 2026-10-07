'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CreditCard, MessageCircle } from 'lucide-react';
import { ApiError, api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import { Selo, TituloLista, texto2, type Tom } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const WHATS = (process.env.NEXT_PUBLIC_WHATSAPP_SUPORTE || '').replace(/\D/g, '');
const CICLOS = [
  { key: 'mensal', label: 'Mensal' },
  { key: 'semestral', label: 'Semestral' },
  { key: 'anual', label: 'Anual' },
] as const;
type Ciclo = (typeof CICLOS)[number]['key'];
type Estado = { fase: 'carregando' } | { fase: 'so_nuvem' } | { fase: 'sem_acesso' } | { fase: 'erro'; mensagem: string } | { fase: 'pronto'; planos: any[]; status: any };
const ID_TITULO = 'planos-titulo';
const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/** O aviso do estado da conta — um texto para cada situação que o servidor devolve. */
function avisoDaConta(status: any, nomeDoPlano: string): { tom: Tom; texto: React.ReactNode } | null {
  switch (status?.tipo) {
    case 'trial':
      return { tom: 'aviso', texto: <>Seu teste grátis termina em <strong>{dias(Number(status.dias) || 0)}</strong>. Escolha um plano para continuar sem interrupção.</> };
    case 'trial_expirado':
      return { tom: 'critico', texto: 'Seu teste terminou. Assine para reativar as operações.' };
    case 'assinatura':
      return { tom: 'ok', texto: <>Assinatura ativa — seu plano: <strong>{nomeDoPlano}</strong>. Você pode trocar de plano abaixo quando quiser.</> };
    case 'assinatura_vencida':
      return { tom: 'critico', texto: 'Sua assinatura está vencida. Regularize para reativar as operações.' };
    case 'bloqueado':
      return { tom: 'critico', texto: 'Esta conta está bloqueada. Fale com a distribuição para regularizar.' };
    case 'sem_conta':
      return { tom: 'critico', texto: 'Não encontramos a conta desta empresa. Fale com a distribuição.' };
    default:
      return null; // conta ativa sem assinatura nem teste: nada a avisar
  }
}
const FUNDO: Record<Tom, string> = { ok: 'border-ok bg-ok/10', aviso: 'border-warn bg-warn/10', critico: 'border-destructive bg-destructive/10', info: 'border-info bg-info/10', neutro: 'border-border bg-secondary' };

// Configurações → Planos & assinatura (mockup `mockups/regem-configuracoes.html`): o estado da conta, o
// ciclo de cobrança e os planos, com a quantidade de módulos de cada um. Assinar ou trocar passa por um
// diálogo que avisa que a pessoa sai do Regem para pagar. Só existe na nuvem.
export default function PlanosPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [ciclo, setCiclo] = useState<Ciclo>('mensal');
  const [pedido, setPedido] = useState<any | null>(null);
  const [indo, setIndo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      // O estado da conta é complemento: se só ele falhar, os planos aparecem do mesmo jeito.
      const [planos, status] = await Promise.all([api.planos(), api.licencaStatus().catch(() => null)]);
      setEstado({ fase: 'pronto', planos: Array.isArray(planos) ? (planos as any[]) : [], status });
    } catch (e) {
      const st = e instanceof ApiError ? e.status : -1;
      if (st === 401) return;
      if (st === 404) setEstado({ fase: 'so_nuvem' });
      else if (st === 403) setEstado({ fase: 'sem_acesso' });
      else setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Não foi possível carregar os planos.' });
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (process.env.NEXT_PUBLIC_EDGE === '1') {
      setEstado({ fase: 'so_nuvem' });
      return;
    }
    void carregar();
  }, [router, carregar]);

  async function assinar(p: any) {
    // 1) tenta o checkout do Stripe.
    setIndo(true);
    try {
      const r: any = await api.assinaturaCheckout({ chave: p.chave, ciclo });
      if (r?.url) {
        window.location.href = r.url;
        return;
      }
    } catch {
      /* gateway ainda não configurado → cai no WhatsApp */
    }
    setIndo(false);
    setPedido(null);
    // 2) alternativa: WhatsApp da distribuição.
    const msg = `Olá! Quero assinar o plano ${p.nome} (${ciclo}) do Regem — R$ ${p[ciclo]}/mês.`;
    if (WHATS) window.open(`https://wa.me/${WHATS}?text=${encodeURIComponent(msg)}`, '_blank');
    else toast.error('Não foi possível abrir o pagamento agora. Fale com a distribuição para assinar.');
  }

  const aviso = (titulo: string, descricao: string, acao?: React.ReactNode) => (
    <Shell eyebrow="Configurações" title="Planos & assinatura">
      <EmptyState icon={<CreditCard className="h-6 w-6" aria-hidden="true" />} title={titulo} description={descricao} action={acao} />
    </Shell>
  );
  if (estado.fase === 'carregando')
    return (
      <Shell eyebrow="Configurações" title="Planos & assinatura">
        <SkeletonList rows={3} />
      </Shell>
    );
  if (estado.fase === 'so_nuvem') return aviso('Disponível pelo Regem na internet', 'Planos e assinatura são vistos em app.dmsregem.com. O servidor da loja não trata de cobrança.');
  if (estado.fase === 'sem_acesso') return aviso('Seu perfil não vê os planos', 'A assinatura é tratada por quem tem a permissão "Planos & assinatura".');
  if (estado.fase === 'erro')
    return aviso('Não deu para carregar os planos', estado.mensagem, <Button type="button" variant="outline" onClick={() => { setEstado({ fase: 'carregando' }); void carregar(); }}>Tentar de novo</Button>);

  const { planos, status } = estado;
  const assinante = status?.tipo === 'assinatura';
  const atual = assinante ? planos.find((p) => p.chave === status.plano) : null;
  const conta = avisoDaConta(status, atual?.nome ?? status?.plano ?? '—');
  const nomeDoCiclo = CICLOS.find((c) => c.key === ciclo)!.label.toLowerCase();

  return (
    <Shell eyebrow="Configurações" title="Planos & assinatura">
      <section className="space-y-4" aria-labelledby={ID_TITULO}>
        <TituloLista id={ID_TITULO} titulo="Planos & assinatura" total={planos.length} mostrando={planos.length} um="plano" varios="planos"
          extra={`${atual ? `seu plano: ${atual.nome} · ` : ''}ciclo ${nomeDoCiclo}`} />

        {conta && (
          <p className={`rounded-md border-l-4 px-3 py-2.5 text-sm ${FUNDO[conta.tom]}`} role={conta.tom === 'critico' ? 'alert' : 'status'}>{conta.texto}</p>
        )}

        <div>
          <span className="mb-1 block text-sm font-medium" id="planos-ciclo">Ciclo de cobrança</span>
          <div className="grid max-w-md grid-cols-3 overflow-hidden rounded-md border border-input" role="group" aria-labelledby="planos-ciclo">
            {CICLOS.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={ciclo === c.key}
                onClick={() => setCiclo(c.key)}
                className={`min-h-11 border-r border-input text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  ciclo === c.key ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {planos.length === 0 ? (
          <Card className={`p-8 text-center text-sm ${texto2}`}>Nenhum plano disponível no momento. Fale com a distribuição.</Card>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {planos.map((p) => {
              const ehAtual = atual?.chave === p.chave;
              const modulos: string[] = p.modulos ?? [];
              return (
                <li key={p.chave}>
                  <Card className={`flex h-full flex-col gap-3 p-5 ${ehAtual ? 'border-2 border-ok' : p.destaque ? 'border-2 border-primary' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-lg font-bold">{p.nome}</h3>
                      {ehAtual ? <Selo tom="ok">plano atual</Selo> : p.destaque ? <Selo tom="info">mais popular</Selo> : null}
                    </div>
                    <p className={`text-sm ${texto2}`}>{p.desc}</p>
                    <p>
                      <span className="font-mono text-3xl font-extrabold">R$ {p[ciclo]}</span>
                      <span className={`text-sm ${texto2}`}> /mês</span>
                      {ciclo !== 'mensal' && <span className={`block text-xs ${texto2}`}>cobrado {ciclo === 'semestral' ? 'a cada 6 meses' : 'anualmente'}</span>}
                    </p>
                    <div>
                      <p className={`mb-1.5 text-xs font-bold ${texto2}`}>{modulos.length} {modulos.length === 1 ? 'módulo' : 'módulos'}</p>
                      <ul className="flex flex-col gap-1.5 text-sm">
                        {modulos.map((m) => (
                          <li key={m} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 flex-none text-ok" aria-hidden="true" />{m}</li>
                        ))}
                      </ul>
                    </div>
                    <Button className="mt-auto" variant={ehAtual ? 'outline' : 'default'} onClick={() => setPedido(p)} disabled={ehAtual}>
                      {ehAtual ? 'Plano atual' : assinante ? `Trocar para ${p.nome}` : `Assinar ${p.nome}`}
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <p className={`flex flex-wrap items-center gap-2 text-sm ${texto2}`}>
          Dúvidas sobre qual plano escolher?{' '}
          {WHATS ? (
            <a className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-input bg-card px-3 font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={`https://wa.me/${WHATS}`} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> Fale com a gente no WhatsApp
            </a>
          ) : (
            'Fale com a gente no WhatsApp.'
          )}
        </p>
      </section>

      {pedido && (
        <Dialogo titulo={`${assinante ? 'Trocar para' : 'Assinar'} o plano ${pedido.nome}?`} aoFechar={() => (indo ? undefined : setPedido(null))} voltarPara={ID_TITULO}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setPedido(null)} disabled={indo}>Cancelar</Button>
              <Button type="button" onClick={() => void assinar(pedido)} disabled={indo}>{indo ? 'Abrindo…' : 'Ir para o pagamento'}</Button>
            </>
          }>
          <p className="text-sm">
            Você vai para a página de pagamento, fora do Regem, para concluir o plano <b>{pedido.nome}</b> no ciclo <b>{nomeDoCiclo}</b>:{' '}
            <span className="whitespace-nowrap font-mono">R$ {pedido[ciclo]}/mês</span>
            {ciclo !== 'mensal' && <>, cobrado {ciclo === 'semestral' ? 'a cada 6 meses' : 'anualmente'}</>}.
          </p>
        </Dialogo>
      )}
    </Shell>
  );
}
