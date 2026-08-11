'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine, Camera, CameraOff, PackageCheck, DoorOpen } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brDate = (iso?: string) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

// Bip curto (Web Audio) — feedback de leitura. ok=agudo, erro=grave.
function beep(ok = true) {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 880 : 200;
    o.start();
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    o.stop(ctx.currentTime + 0.16);
    o.onended = () => ctx.close?.();
  } catch { /* silencioso */ }
}

type Modo = 'perguntar' | 'baixar' | 'abrir';
type Hist = { id: string; desc: string; acao: string; hora: string; ok: boolean };

export default function PontoBaixaPage() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>('perguntar');
  const [codigo, setCodigo] = useState('');
  const [pendente, setPendente] = useState<any>(null); // etiqueta fechada aguardando escolha (modo perguntar)
  const [ultimo, setUltimo] = useState<any>(null); // último resultado exibido em destaque
  const [hist, setHist] = useState<Hist[]>([]);
  const [busy, setBusy] = useState(false);
  const [camAtiva, setCamAtiva] = useState(false);
  const [camMsg, setCamMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rodando = useRef(false);
  const ultimaLeitura = useRef<{ cod: string; t: number }>({ cod: '', t: 0 });

  const foca = useCallback(() => setTimeout(() => inputRef.current?.focus(), 30), []);

  useEffect(() => {
    if (!getToken()) { router.replace('/entrar'); return; }
    foca();
  }, [router, foca]);

  const addHist = (id: string, desc: string, acao: string, ok: boolean) =>
    setHist((h) => [{ id: id || Math.random().toString(36), desc, acao, hora: new Date().toLocaleTimeString('pt-BR'), ok }, ...h].slice(0, 12));

  async function baixar(e: any) {
    await api.finalizarEtiqueta(e.id);
    beep(true); setUltimo({ ...e, resultado: 'Baixada ✓' });
    addHist(e.id, e.descricao, 'baixada', true);
    toast.success(`Baixada: ${e.descricao}`);
  }
  async function abrir(e: any) {
    const r: any = await api.abrirEtiqueta(e.id);
    beep(true);
    const txt = r?.substituida ? 'Aberta — nova via impressa (validade encurtou)' : 'Aberta (em uso)';
    setUltimo({ ...e, resultado: txt, nova: r?.substituida ? r?.etiqueta : null });
    addHist(e.id, e.descricao, r?.substituida ? 'aberta (nova via)' : 'aberta', true);
    toast.success(txt);
  }

  // Processa um código lido (USB ou câmera).
  const processar = useCallback(async (raw: string) => {
    const cod = String(raw || '').trim();
    if (!cod || busy) return;
    // debounce da câmera: ignora o mesmo código relido em <2.5s.
    const agora = Date.now();
    if (ultimaLeitura.current.cod === cod && agora - ultimaLeitura.current.t < 2500) return;
    ultimaLeitura.current = { cod, t: agora };
    setBusy(true); setPendente(null);
    try {
      const e: any = await api.buscarEtiqueta(cod);
      if (e.status === 'substituida') {
        beep(false);
        setUltimo({ ...e, resultado: `Substituída — use a NOVA (cód ${e.substituta?.codigo ?? '?'}, val ${brDate(e.substituta?.validade)})` });
        addHist(e.id, e.descricao, 'substituída', false);
        toast.error('Etiqueta substituída — use a nova.');
      } else if (e.status === 'baixado' || e.status === 'vencido') {
        beep(false);
        setUltimo({ ...e, resultado: e.status === 'vencido' ? 'Vencida' : 'Já baixada' });
        addHist(e.id, e.descricao, e.status === 'vencido' ? 'vencida' : 'já baixada', false);
        toast.info(`Etiqueta ${e.status === 'vencido' ? 'vencida' : 'já baixada'}.`);
      } else if (modo === 'baixar') {
        await baixar(e);
      } else if (modo === 'abrir') {
        if (e.status === 'fechado') await abrir(e); else await baixar(e);
      } else {
        // perguntar
        if (e.status === 'fechado') { beep(true); setPendente(e); setUltimo(null); }
        else await baixar(e); // em uso → baixa direto
      }
    } catch (err: any) {
      beep(false);
      setUltimo({ naoAchou: true, codigo: cod, resultado: err?.message || 'Etiqueta não encontrada' });
      addHist('', cod, 'não encontrada', false);
      toast.error(err?.message || 'Etiqueta não encontrada.');
    } finally {
      setBusy(false); setCodigo(''); foca();
    }
  }, [busy, modo, foca]);

  // ---- Câmera (BarcodeDetector nativo — Android Chrome/tablets) ----
  const suportaCam = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  async function ligarCamera() {
    if (!suportaCam) { setCamMsg('Câmera/leitura não suportada neste aparelho — use o leitor USB.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const Det = (window as any).BarcodeDetector;
      const det = new Det({ formats: ['qr_code', 'code_128', 'ean_13'] });
      setCamAtiva(true); setCamMsg(''); rodando.current = true;
      const loop = async () => {
        if (!rodando.current || !videoRef.current) return;
        try {
          const codes = await det.detect(videoRef.current);
          if (codes?.[0]?.rawValue) await processar(codes[0].rawValue);
        } catch { /* frame sem código */ }
        if (rodando.current) setTimeout(loop, 350);
      };
      loop();
    } catch (e: any) {
      setCamMsg('Não consegui abrir a câmera: ' + (e?.message || 'permissão negada') + '. Use o leitor USB.');
    }
  }
  const desligarCamera = useCallback(() => {
    rodando.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null; setCamAtiva(false);
  }, []);
  useEffect(() => () => desligarCamera(), [desligarCamera]);

  const MODOS: { v: Modo; txt: string }[] = [
    { v: 'perguntar', txt: 'Perguntar' },
    { v: 'baixar', txt: 'Baixar direto' },
    { v: 'abrir', txt: 'Abrir' },
  ];

  return (
    <Shell eyebrow="Estoque" title="Ponto de baixa (QR)">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Modo */}
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">Ao ler, o que fazer?</p>
            <div className="flex flex-wrap gap-1.5">
              {MODOS.map((m) => (
                <button key={m.v} type="button" onClick={() => { setModo(m.v); foca(); }}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${modo === m.v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                  {m.txt}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              <b>Perguntar</b>: pergunta a cada leitura (fechado). <b>Baixar</b>/<b>Abrir</b>: aplica direto (bom pra lote). Item já aberto sempre baixa.
            </p>
          </Card>

          {/* Leitor USB / digitação */}
          <Card className="p-4">
            <label className="mb-1.5 flex items-center gap-2 text-sm font-medium"><ScanLine className="h-4 w-4 text-primary" /> Leitor USB / código</label>
            <div className="flex gap-2">
              <Input ref={inputRef} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Aponte o leitor ou digite o código + Enter" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); processar(codigo); } }} onBlur={foca} />
              <Button type="button" disabled={busy || !codigo.trim()} onClick={() => processar(codigo)}>Ler</Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">O leitor USB "digita" o QR sozinho. Mantenha esta caixa focada.</p>
          </Card>

          {/* Câmera */}
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium"><Camera className="h-4 w-4 text-primary" /> Câmera (tablet/celular)</span>
              {camAtiva ? (
                <Button type="button" size="sm" variant="outline" onClick={desligarCamera}><CameraOff className="mr-1 h-4 w-4" /> Parar</Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={ligarCamera}>Ligar câmera</Button>
              )}
            </div>
            <div className={`overflow-hidden rounded-lg bg-black ${camAtiva ? '' : 'hidden'}`}>
              <video ref={videoRef} className="mx-auto max-h-72 w-full object-contain" muted playsInline />
            </div>
            {camMsg && <p className="mt-1.5 text-xs text-warn">{camMsg}</p>}
            {!camAtiva && !camMsg && <p className="text-[11px] text-muted-foreground">Aponte a câmera pro QR/código de barras da etiqueta. (Precisa de HTTPS — o servidor local já usa.)</p>}
          </Card>

          {/* Pergunta (modo perguntar, etiqueta fechada) */}
          {pendente && (
            <Card className="border-primary/40 p-4">
              <p className="text-sm">Etiqueta lida: <b>{pendente.descricao}</b> · validade {brDate(pendente.validade)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" onClick={async () => { setBusy(true); try { await baixar(pendente); } finally { setPendente(null); setBusy(false); foca(); } }}>
                  <PackageCheck className="mr-1 h-4 w-4" /> Baixar (usei)
                </Button>
                <Button type="button" variant="outline" onClick={async () => { setBusy(true); try { await abrir(pendente); } finally { setPendente(null); setBusy(false); foca(); } }}>
                  <DoorOpen className="mr-1 h-4 w-4" /> Abrir (em uso)
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setPendente(null); foca(); }}>Cancelar</Button>
              </div>
            </Card>
          )}

          {/* Destaque do último resultado */}
          {ultimo && !pendente && (
            <Card className={`p-5 ${ultimo.naoAchou || ultimo.status === 'substituida' || ultimo.status === 'vencido' || ultimo.status === 'baixado' ? 'border-danger/40' : 'border-ok/40'}`}>
              {ultimo.naoAchou ? (
                <p className="text-lg font-bold text-danger">Código {ultimo.codigo}: {ultimo.resultado}</p>
              ) : (
                <>
                  <p className="font-display text-xl font-bold">{ultimo.descricao}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Validade {brDate(ultimo.validade)}{ultimo.unidadeMedida ? ` · ${ultimo.unidadeMedida}` : ''}</p>
                  <p className="mt-2 text-lg font-semibold">{ultimo.resultado}</p>
                  {ultimo.nova && <p className="mt-1 text-xs text-muted-foreground">Nova etiqueta: cód {ultimo.nova.codigo} · val {brDate(ultimo.nova.validade)}</p>}
                </>
              )}
            </Card>
          )}
        </div>

        {/* Histórico */}
        <div>
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">Últimas leituras</p>
            {hist.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma leitura ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {hist.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5 text-xs">
                    <span className="min-w-0 truncate">{h.desc}</span>
                    <span className={`shrink-0 font-semibold ${h.ok ? 'text-ok' : 'text-danger'}`}>{h.acao} · {h.hora}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
