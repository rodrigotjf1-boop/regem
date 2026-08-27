'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Escolha do provedor de WhatsApp da loja (F2c).
//
// O texto dos termos NÃO está escrito aqui: vem do backend no mesmo objeto que a
// gravação do aceite usa. Assim o que o gestor lê é literalmente o que fica na
// auditoria — se estivesse duplicado no front, um deploy poderia deixar os dois
// diferentes e o aceite não provaria nada.

type Estado = {
  provedor: 'evolution' | 'cloud';
  termo: { versao: string; evolution: string; cloud: string };
  evolution: { vinculado: boolean; instancia: string | null; numero: string | null };
  cloud: { vinculado: boolean; phoneNumberId: string | null; wabaId: string | null; numero: string | null };
};

const OPCOES = [
  {
    id: 'evolution' as const,
    titulo: 'Conexão por QR Code',
    selo: 'Grátis',
    seloClasse: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    resumo: 'Você aponta o celular para um QR, como no WhatsApp Web. Sem custo por mensagem.',
  },
  {
    id: 'cloud' as const,
    titulo: 'API oficial da Meta',
    selo: 'Pago por mensagem',
    seloClasse: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    resumo: 'Conexão homologada pela Meta. A cobrança vai direto para a conta da sua empresa.',
  },
];

export function ProvedorWhatsapp({ pode, onEstado }: { pode: boolean; onEstado?: (e: Estado) => void }) {
  const [est, setEst] = useState<Estado | null>(null);
  const [escolha, setEscolha] = useState<'evolution' | 'cloud' | null>(null);
  const [aceite, setAceite] = useState(false);
  const [phoneId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [numero, setNumero] = useState('');
  const [busy, setBusy] = useState(false);
  const [conf, setConf] = useState<any>(null);
  const [confBusy, setConfBusy] = useState(false);

  // Confere na Meta de qual numero e o id digitado. Evita o erro silencioso de
  // vincular o numero errado e so descobrir quando a mensagem nao chega.
  async function conferir() {
    setConfBusy(true);
    setConf(null);
    try {
      setConf(await api.whatsappCloudVerificarNumero(phoneId.trim()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não consegui conferir.');
    } finally {
      setConfBusy(false);
    }
  }

  async function carregar() {
    try {
      const e: any = await api.whatsappProvedor();
      setEst(e);
      onEstado?.(e);
      setEscolha(e?.provedor ?? 'evolution');
      setPhoneId(e?.cloud?.phoneNumberId ?? '');
      setWabaId(e?.cloud?.wabaId ?? '');
      setNumero(e?.cloud?.numero ?? '');
    } catch {
      /* a tela do robô continua útil mesmo sem este bloco */
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  if (!est) return null;

  const mudou = escolha !== est.provedor;
  // Trocar de provedor exige aceitar de novo; só preencher o número da API oficial
  // (sem mudar de provedor) não precisa.
  const precisaAceite = mudou;
  const podeSalvar = pode && !busy && (mudou || (escolha === 'cloud' && phoneId !== (est.cloud.phoneNumberId ?? ''))) && (!precisaAceite || aceite);

  async function salvar() {
    if (!escolha) return;
    setBusy(true);
    try {
      const e: any = await api.whatsappProvedorDefinir({
        provedor: escolha,
        aceite: true,
        termoVersao: est!.termo.versao,
        waCloudPhoneId: escolha === 'cloud' ? phoneId.trim() : undefined,
        waCloudWabaId: escolha === 'cloud' ? wabaId.trim() : undefined,
        waCloudNumero: escolha === 'cloud' ? numero.trim() : undefined,
      });
      setEst(e);
      onEstado?.(e);
      setAceite(false);
      toast.success('Provedor de WhatsApp atualizado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function desvincular() {
    if (!confirm('Desvincular o número da API oficial desta loja?')) return;
    setBusy(true);
    try {
      const e: any = await api.whatsappCloudDesvincular();
      setEst(e);
      onEstado?.(e);
      setPhoneId('');
      setWabaId('');
      setNumero('');
      toast.success('Número desvinculado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível desvincular.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Como esta loja se conecta ao WhatsApp</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Escolha um dos dois. Só um fica ativo por vez — dois ao mesmo tempo fariam o cliente receber
        resposta em dobro.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPCOES.map((o) => {
          const ativo = escolha === o.id;
          const atual = est.provedor === o.id;
          const vinculado = o.id === 'evolution' ? est.evolution.vinculado : est.cloud.vinculado;
          return (
            <button
              key={o.id}
              type="button"
              disabled={!pode}
              aria-pressed={ativo}
              onClick={() => {
                setEscolha(o.id);
                setAceite(false);
              }}
              className={`rounded-lg border p-3 text-left transition ${
                ativo ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40'
              } ${pode ? '' : 'cursor-not-allowed opacity-60'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{o.titulo}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${o.seloClasse}`}>
                  {o.selo}
                </span>
                {atual && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    em uso
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{o.resumo}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {vinculado ? '● número vinculado' : '○ nenhum número vinculado'}
              </p>
            </button>
          );
        })}
      </div>

      {escolha && (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            O que você está aceitando
          </p>
          <p className="mt-1 text-xs leading-relaxed">{est.termo[escolha]}</p>
        </div>
      )}

      {escolha === 'cloud' && pode && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Identificação do número</Label>
            <Input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder="Phone Number ID" />
          </div>
          <div>
            <Label className="text-xs">Conta do WhatsApp Business</Label>
            <Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="WABA ID" />
          </div>
          <div>
            <Label className="text-xs">Número (só para exibir)</Label>
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="5521999999999" />
          </div>
          <div className="sm:col-span-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!phoneId.trim() || confBusy}
              onClick={conferir}
            >
              {confBusy ? 'Conferindo…' : 'Conferir na Meta'}
            </Button>
            {conf && (
              <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
                <p>
                  <strong>{conf.nomeExibicao ?? 'sem nome de exibição'}</strong>
                  {conf.numero ? ` · ${conf.numero}` : ''}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  Qualidade: {conf.qualidade ?? '—'} ·{' '}
                  {conf.verificado ? 'número verificado' : 'não verificado'}
                </p>
                {conf.jaVinculadoA && (
                  <p className="mt-1 font-semibold text-destructive">
                    ⚠️ Este número já está vinculado à loja “{conf.jaVinculadoA}”.
                  </p>
                )}
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground sm:col-span-3">
            Esses dois códigos ficam no painel da Meta, em WhatsApp → Configuração da API. Quando o
            cadastro incorporado hospedado pela Meta estiver liberado para a sua conta, o lojista faz
            o cadastro por um link e você só confere o número aqui.
          </p>
        </div>
      )}

      {precisaAceite && pode && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={aceite}
            onChange={(e) => setAceite(e.target.checked)}
          />
          <span>
            Li e aceito os termos acima em nome da minha empresa. Sei que este aceite fica registrado
            com meu nome, data e hora.
          </span>
        </label>
      )}

      {pode && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={!podeSalvar} onClick={salvar}>
            {busy ? 'Salvando…' : mudou ? 'Confirmar troca' : 'Salvar'}
          </Button>
          {est.cloud.vinculado && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={desvincular}>
              Desvincular número oficial
            </Button>
          )}
          {mudou && !aceite && (
            <span className="text-[11px] text-muted-foreground">Aceite os termos para confirmar.</span>
          )}
        </div>
      )}
    </div>
  );
}
