'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const WHATS = (process.env.NEXT_PUBLIC_WHATSAPP_SUPORTE || '').replace(/\D/g, '');
const CICLOS = [
  { key: 'mensal', label: 'Mensal' },
  { key: 'semestral', label: 'Semestral' },
  { key: 'anual', label: 'Anual' },
] as const;
type Ciclo = (typeof CICLOS)[number]['key'];

export default function PlanosPage() {
  const router = useRouter();
  const [planos, setPlanos] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [ciclo, setCiclo] = useState<Ciclo>('mensal');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    api.planos().then((p) => setPlanos(p as any[])).catch(() => {});
    api.licencaStatus().then(setStatus).catch(() => {});
  }, [router]);

  const [indo, setIndo] = useState<string | null>(null);

  async function assinar(p: any) {
    // 1) tenta o checkout do Stripe.
    setIndo(p.chave);
    try {
      const r: any = await api.assinaturaCheckout({ chave: p.chave, ciclo });
      if (r?.url) {
        window.location.href = r.url;
        return;
      }
    } catch {
      /* gateway ainda não configurado → cai no WhatsApp */
    } finally {
      setIndo(null);
    }
    // 2) fallback: WhatsApp da distribuição.
    const preco = p[ciclo];
    const msg = `Olá! Quero assinar o plano ${p.nome} (${ciclo}) do Regem — R$ ${preco}/mês.`;
    if (WHATS) window.open(`https://wa.me/${WHATS}?text=${encodeURIComponent(msg)}`, '_blank');
    else alert('Fale com a distribuição para assinar.');
  }

  return (
    <Shell eyebrow="Assinatura" title="Planos">
      {status?.tipo === 'trial' && (
        <Card className="mb-4 p-3 text-sm">
          Seu teste grátis termina em <strong>{status.dias} dias</strong>. Escolha um plano para continuar sem interrupção.
        </Card>
      )}
      {status && !status.ativa && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Seu teste terminou. Assine para reativar as operações.
        </Card>
      )}
      {status?.tipo === 'assinatura' && (
        <Card className="mb-4 border-ok/40 bg-ok/5 p-3 text-sm">
          <span className="font-semibold text-ok">✓ Assinatura ativa</span> — seu plano:{' '}
          <strong>{planos.find((p) => p.chave === status.plano)?.nome ?? status.plano ?? '—'}</strong>
          {status.ate && <> · renova em {new Date(status.ate).toLocaleDateString('pt-BR')}</>}. Você pode
          trocar de plano abaixo quando quiser.
        </Card>
      )}

      <div className="mb-5 inline-flex rounded-lg border border-border p-1">
        {CICLOS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCiclo(c.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              ciclo === c.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {planos.map((p) => {
          const ehAtual = status?.tipo === 'assinatura' && status.plano === p.chave;
          return (
          <Card key={p.chave} className={`flex flex-col p-5 ${ehAtual ? 'border-ok ring-1 ring-ok/40' : p.destaque ? 'border-primary ring-1 ring-primary/30' : ''}`}>
            {ehAtual ? (
              <span className="mb-2 w-fit rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ok">
                Plano atual
              </span>
            ) : p.destaque ? (
              <span className="mb-2 w-fit rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                Mais popular
              </span>
            ) : null}
            <h3 className="font-display text-lg font-bold">{p.nome}</h3>
            <p className="text-sm text-muted-foreground">{p.desc}</p>
            <div className="my-4">
              <span className="font-mono text-3xl font-extrabold">R$ {p[ciclo]}</span>
              <span className="text-sm text-muted-foreground">/mês</span>
              {ciclo !== 'mensal' && (
                <p className="text-xs text-muted-foreground">
                  cobrado {ciclo === 'semestral' ? 'a cada 6 meses' : 'anualmente'}
                </p>
              )}
            </div>
            <ul className="mb-5 flex flex-col gap-1.5 text-sm">
              {(p.modulos ?? []).map((m: string) => (
                <li key={m} className="flex gap-2">
                  <span className="text-ok">✓</span>
                  {m}
                </li>
              ))}
            </ul>
            <Button
              className="mt-auto"
              variant={ehAtual ? 'outline' : 'default'}
              onClick={() => assinar(p)}
              disabled={indo === p.chave || ehAtual}
            >
              {ehAtual
                ? '✓ Plano atual'
                : indo === p.chave
                  ? 'Abrindo…'
                  : status?.tipo === 'assinatura'
                    ? `Trocar para ${p.nome}`
                    : `Assinar ${p.nome}`}
            </Button>
          </Card>
          );
        })}
      </div>

      <p className="mt-5 text-xs text-muted-foreground">
        Dúvidas sobre qual plano escolher? Fale com a gente no WhatsApp.
      </p>
    </Shell>
  );
}
