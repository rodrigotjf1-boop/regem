'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F3b — modal de configuração da TRAVA DE INSTALAÇÃO (anti-clone) de uma loja. Liga/
// desliga a exigência de re-autorização, escolhe o 2º fator (e-mail ou app autenticador/
// TOTP), enrola o TOTP (QR) e mostra a trilha de moves. Só a distribuição chega aqui.
const dh = (d: any) => (d ? new Date(d).toLocaleString('pt-BR') : '—');

export function TravaModal({ ativacao, onClose, onChange }: { ativacao: any; onClose: () => void; onChange: () => void }) {
  const [ativo, setAtivo] = useState<boolean>(!!ativacao.reauthAtivo);
  const [metodo, setMetodo] = useState<string>(ativacao.reauthMetodo ?? 'email');
  const [temTotp, setTemTotp] = useState<boolean>(!!ativacao.reauthTemTotp);
  const [salvando, setSalvando] = useState(false);
  // Enrolamento do TOTP.
  const [qr, setQr] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [codigo, setCodigo] = useState<string>('');
  const [confirmando, setConfirmando] = useState(false);
  const [moves, setMoves] = useState<any[]>([]);

  const carregarMoves = useCallback(async () => {
    try { setMoves((await api.reauthMoves(ativacao.id)) as any[]); } catch { /* trilha é best-effort */ }
  }, [ativacao.id]);
  useEffect(() => { carregarMoves(); }, [carregarMoves]);

  async function salvar() {
    if (metodo === 'totp' && !temTotp) return toast.error('Configure o app autenticador antes de usar esse método.');
    setSalvando(true);
    try {
      await api.reauthConfig(ativacao.id, { ativo, metodo });
      toast.success(ativo ? 'Trava ligada.' : 'Trava desligada.');
      onChange();
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
    finally { setSalvando(false); }
  }

  async function iniciarTotp() {
    try {
      const r: any = await api.reauthTotpIniciar(ativacao.id);
      setSecret(r.secret ?? '');
      setQr(await QRCode.toDataURL(r.otpauthUri, { width: 200, margin: 1 }));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }

  async function confirmarTotp() {
    if (codigo.trim().length !== 6) return toast.error('Digite o código de 6 dígitos do app.');
    setConfirmando(true);
    try {
      await api.reauthTotpConfirmar(ativacao.id, codigo.trim());
      toast.success('App autenticador configurado — trava por TOTP ligada.');
      setTemTotp(true);
      setMetodo('totp');
      setAtivo(true);
      setQr('');
      setSecret('');
      setCodigo('');
      onChange();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
    finally { setConfirmando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <Card className="my-8 w-full max-w-lg space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold">Trava de instalação</h2>
            <p className="text-xs text-muted-foreground">Loja <span className="font-mono">{(ativacao.tenantId ?? '').slice(0, 8)}…</span> — impede clonar o edge em outra máquina com a senha vazada.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-muted-foreground hover:bg-secondary">✕</button>
        </div>

        {/* Liga/desliga */}
        <label className="flex items-center gap-3 rounded-lg border border-border p-3">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} aria-pressed={ativo} />
          <span className="text-sm">
            <span className="font-medium">Exigir re-autorização em máquina nova</span>
            <span className="block text-xs text-muted-foreground">Mover o edge p/ outro PC passa a pedir um código (2º fator). Reinstalar na mesma máquina não pede nada.</span>
          </span>
        </label>

        {/* Método */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">Como enviar o código</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm ${metodo === 'email' ? 'border-primary bg-primary/10' : 'border-border'}`}>
              <input type="radio" name="metodo" className="accent-primary" checked={metodo === 'email'} onChange={() => setMetodo('email')} />
              <span>E-mail da conta<span className="block text-xs text-muted-foreground">Código de 6 dígitos por e-mail.</span></span>
            </label>
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm ${metodo === 'totp' ? 'border-primary bg-primary/10' : 'border-border'}`}>
              <input type="radio" name="metodo" className="accent-primary" checked={metodo === 'totp'} onChange={() => setMetodo('totp')} />
              <span>App autenticador {temTotp && <span className="text-ok">✓</span>}<span className="block text-xs text-muted-foreground">Google Authenticator / Authy (TOTP).</span></span>
            </label>
          </div>
        </fieldset>

        {/* Enrolamento TOTP */}
        {metodo === 'totp' && (
          <div className="rounded-lg border border-dashed border-border p-3">
            {temTotp && !qr && (
              <p className="text-xs text-ok">App já configurado. Para trocar de aparelho, gere um novo QR.</p>
            )}
            {!qr && (
              <Button type="button" variant="outline" onClick={iniciarTotp} className="mt-1">{temTotp ? 'Gerar novo QR' : 'Configurar app (gerar QR)'}</Button>
            )}
            {qr && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Escaneie no app autenticador (ou digite a chave manualmente):</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR do app autenticador" className="rounded border border-border" width={200} height={200} />
                <p className="break-all font-mono text-[11px] text-muted-foreground">{secret}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div><Label className="text-xs">Código do app</Label><Input inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="000000" className="w-28 font-mono" /></div>
                  <Button type="button" onClick={confirmarTotp} disabled={confirmando}>{confirmando ? 'Confirmando…' : 'Confirmar'}</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Trilha de moves */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">Últimos pedidos de move</h3>
          {moves.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Nenhum move registrado.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {moves.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 px-2 py-1 text-xs">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${m.status === 'aprovada' ? 'bg-ok/15 text-ok' : m.status === 'pendente' ? 'bg-warn/15 text-warn' : 'bg-secondary text-muted-foreground'}`}>{m.status}</span>
                  <span className="text-muted-foreground">{m.metodo}</span>
                  <span className="font-mono text-muted-foreground">{(m.fingerprintNovo ?? '').slice(0, 12)}…</span>
                  <span className="ml-auto text-muted-foreground">{dh(m.criadoEm)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </Card>
    </div>
  );
}
