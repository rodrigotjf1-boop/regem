'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getCategoria, getPermissoes } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ModelosWhatsapp } from '@/components/delivery/modelos-whatsapp';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Delivery → Marketing: campanhas de WhatsApp (épico 2 provedores). Público segmentado,
// conteúdo com imagem+link, prévia do balão, agendamento, tipos prontos, cupom automático
// e lista de exclusão (opt-out). Disparo pelo número de marketing (anti-ban).

const SEGS = [
  { k: 'todos', t: 'Todos os clientes' },
  { k: 'mes', t: 'Pediram no mês' },
  { k: '30d', t: 'Últimos 30 dias' },
  { k: 'sem_30', t: '+30 dias sem pedir' },
  { k: 'sem_60', t: '+60 dias sem pedir' },
  { k: 'campeoes', t: 'Campeões (3+ no mês)' },
  { k: 'recuperacao', t: 'Recuperação (X dias)' },
];

// Tipos prontos: pré-preenchem mensagem e público (o lojista ajusta).
const TIPOS: { k: string; t: string; seg?: string; cupom?: boolean; msg: string }[] = [
  { k: 'avulsa', t: 'Livre', msg: '' },
  { k: 'frete_gratis', t: 'Frete grátis', cupom: true, seg: 'todos', msg: 'Hoje é FRETE GRÁTIS na [sua loja]! 🛵 Use o cupom {CUPOM} e peça agora: [link]' },
  { k: 'cupom', t: 'Cupom de desconto', cupom: true, seg: 'todos', msg: 'Presente pra você 🎁 {CUPOM} de desconto na [sua loja]. Peça: [link]' },
  { k: 'recuperacao', t: 'Recuperar cliente', seg: 'recuperacao', msg: 'Sentimos sua falta 😊 Que tal um pedido hoje? Veja as novidades: [link]' },
  { k: 'campeoes', t: 'Clientes campeões', seg: 'campeoes', msg: 'Você é cliente VIP! 🏆 Um mimo especial pra você: [link]' },
  { k: 'aniversario', t: 'Aniversário', msg: 'Feliz aniversário! 🎉 Comemore com um presente da [sua loja]: [link]' },
  { k: 'peca_de_novo', t: 'Peça de novo', seg: '30d', msg: 'Bateu vontade? 😋 Seu preferido está te esperando: [link]' },
  { k: 'vip', t: 'VIP / fidelidade', seg: 'campeoes', msg: 'Oferta exclusiva pra você, cliente VIP 💛 [link]' },
  { k: 'fim_de_semana', t: 'Fim de semana', seg: 'todos', msg: 'Fim de semana pede [sua loja]! 🍔 Confira: [link]' },
];

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Comprime a imagem no navegador (máx 1080px, JPG q80) — leve para 500+ disparos.
async function comprimir(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement('img');
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const escala = Math.min(1, 1080 / Math.max(img.width, img.height));
    const w = Math.round(img.width * escala);
    const h = Math.round(img.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.8));
    return new File([blob], (file.name.replace(/\.\w+$/, '') || 'campanha') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function MarketingPage() {
  const [pode, setPode] = useState(false);
  const [campanhas, setCampanhas] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [excluir, setExcluir] = useState('');

  // Builder
  const [tipo, setTipo] = useState('avulsa');
  const [seg, setSeg] = useState('todos');
  const [recDias, setRecDias] = useState(45);
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState('');
  const [imagemRef, setImagemRef] = useState<string | null>(null);
  const [subindoImg, setSubindoImg] = useState(false);
  const [instancia, setInstancia] = useState<'marketing' | 'loja'>('marketing');
  const [intervalo, setIntervalo] = useState(30);
  const [tetoDia, setTetoDia] = useState('');
  const [tetoSemana, setTetoSemana] = useState('');
  const [tetoMes, setTetoMes] = useState('');
  const [agendada, setAgendada] = useState(false);
  const [dias, setDias] = useState<number[]>([]);
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFim, setHoraFim] = useState('');
  const [criarCupom, setCriarCupom] = useState(true);
  const [cupomCodigo, setCupomCodigo] = useState('');
  const [cupomValor, setCupomValor] = useState('10');
  const [cupomDuracao, setCupomDuracao] = useState('7');
  const [previa, setPrevia] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Abas + provedor + templates (para campanha na API oficial)
  const [aba, setAba] = useState<'campanhas' | 'modelos'>('campanhas');
  const [numeros, setNumeros] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateNome, setTemplateNome] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  const ehCupom = tipo === 'cupom' || tipo === 'frete_gratis';
  // Provedor do número escolhido (marketing→papel marketing; loja→principal).
  const provedorAtual: 'evolution' | 'cloud' =
    (instancia === 'marketing' ? numeros?.marketing?.provedor : numeros?.principal?.provedor) ?? 'evolution';
  const ehCloud = provedorAtual === 'cloud';
  const templateSel = templates.find((t) => t.nome === templateNome);
  const templateVarsCount = templateSel ? (String(templateSel.corpo).match(/\{\{\d+\}\}/g) ?? []).length : 0;
  // Só faz sentido "Modelos (API oficial)" se a loja usa a API oficial em algum número.
  const temCloud = numeros?.principal?.provedor === 'cloud' || numeros?.marketing?.provedor === 'cloud';
  // Marketing só funciona com um número conectado — evita erro no disparo.
  const numeroConectado = !!(numeros?.principal?.vinculado || numeros?.marketing?.vinculado);
  // Na API oficial o modelo é PRÉ-REQUISITO → aba "Modelos" vem primeiro.
  const abas = (temCloud ? (['modelos', 'campanhas'] as const) : (['campanhas'] as const));
  const semModeloAprovado = temCloud && templates.length === 0;

  const carregar = useCallback(async () => {
    try {
      setCampanhas(await api.crmCampanhas());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const cat = getCategoria();
    const perms = getPermissoes();
    setPode(cat === 'presidente' || cat === 'gerente' || perms.includes('delivery'));
    carregar();
    api.whatsappNumeros().then(setNumeros).catch(() => {});
    api
      .whatsappTemplatesLocais()
      .then((ts: any) => setTemplates((ts || []).filter((t: any) => t.status === 'aprovado')))
      .catch(() => {});
  }, [carregar]);

  // Abre em "Modelos" por padrão quando a loja é API oficial e ainda não tem modelo
  // aprovado (o modelo é pré-requisito p/ campanha). Roda uma vez, após carregar números.
  const abaAjustada = useRef(false);
  useEffect(() => {
    if (abaAjustada.current || !numeros) return;
    abaAjustada.current = true;
    if (temCloud && templates.length === 0) setAba('modelos');
  }, [numeros, temCloud, templates.length]);

  // Recalcula o público quando o segmento muda.
  useEffect(() => {
    if (!novo) return;
    setPrevia(null);
    api
      .crmCampanhaPrevia(seg, seg === 'recuperacao' ? recDias : undefined)
      .then((r: any) => setPrevia(r?.total ?? 0))
      .catch(() => setPrevia(0));
  }, [novo, seg, recDias]);

  function aplicarTipo(k: string) {
    const t = TIPOS.find((x) => x.k === k);
    if (!t) return;
    setTipo(k);
    if (t.seg) setSeg(t.seg);
    if (t.msg) setMsg(t.msg);
    if (t.cupom && !cupomCodigo) setCupomCodigo('PROMO' + Math.floor(1000 + Math.random() * 9000));
  }

  async function subirImagem(f: File) {
    setSubindoImg(true);
    try {
      const c = await comprimir(f);
      const r: any = await api.upload(c);
      setImagemRef(r?.url ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui subir a imagem.');
    } finally {
      setSubindoImg(false);
    }
  }

  function toggleDia(d: number) {
    setDias((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  async function criar() {
    if (msg.trim().length < 3) {
      toast.error('Escreva a mensagem.');
      return;
    }
    setEnviando(true);
    try {
      const r: any = await api.crmCampanhaCriar({
        tipo,
        segmento: seg,
        recuperacaoDias: seg === 'recuperacao' ? recDias : undefined,
        mensagem: msg,
        link: link.trim() || null,
        imagemRef,
        instanciaTipo: instancia,
        intervaloSeg: intervalo,
        tetoDia: tetoDia ? Number(tetoDia) : null,
        tetoSemana: tetoSemana ? Number(tetoSemana) : null,
        tetoMes: tetoMes ? Number(tetoMes) : null,
        agendada,
        diasSemana: agendada && dias.length ? dias : null,
        horaInicio: agendada ? horaInicio || null : null,
        horaFim: agendada ? horaFim || null : null,
        criarCupom: ehCupom ? criarCupom : false,
        cupomCodigo: ehCupom ? cupomCodigo.trim().toUpperCase() : null,
        cupomTipo: tipo === 'frete_gratis' ? 'fretegratis' : 'percentual',
        cupomValor: ehCupom ? Number(cupomValor) || 0 : 0,
        cupomDuracaoDias: ehCupom && cupomDuracao ? Number(cupomDuracao) : null,
        templateNome: ehCloud ? templateNome : null,
        templateIdioma: ehCloud ? templateSel?.idioma || 'pt_BR' : null,
        templateVars: ehCloud ? templateVars : null,
      });
      toast.success(`Campanha criada para ${r?.total ?? 0} contato(s).`);
      setNovo(false);
      resetar();
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar.');
    } finally {
      setEnviando(false);
    }
  }

  function resetar() {
    setTipo('avulsa');
    setSeg('todos');
    setMsg('');
    setLink('');
    setImagemRef(null);
    setTetoDia('');
    setTetoSemana('');
    setTetoMes('');
    setAgendada(false);
    setDias([]);
    setHoraInicio('');
    setHoraFim('');
  }

  async function excluirTel() {
    const t = excluir.replace(/\D/g, '');
    if (!t) return;
    try {
      await api.crmExcluirTelefone(t);
      toast.success('Número adicionado à lista de exclusão.');
      setExcluir('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui excluir.');
    }
  }

  const captionPreview = [msg.replace('{CUPOM}', cupomCodigo || 'CUPOM'), link].filter(Boolean).join('\n');

  return (
    <Shell>
      <div className="w-full space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl font-bold">Marketing</h1>
          {pode && aba === 'campanhas' && (
            <Button className="ml-auto" disabled={!numeroConectado} onClick={() => setNovo((v) => !v)}>
              {novo ? 'Fechar' : '＋ Nova campanha'}
            </Button>
          )}
        </div>

        {/* Abas (Modelos só quando a loja usa API oficial) */}
        <div className="flex gap-1 border-b border-border">
          {abas.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setAba(k)}
              aria-pressed={aba === k}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
                aba === k
                  ? 'border-primary text-primary'
                  : 'border-transparent text-foreground/60 hover:text-foreground'
              }`}
            >
              {k === 'campanhas' ? 'Campanhas' : 'Modelos (API oficial)'}
            </button>
          ))}
        </div>

        {/* Como funciona / casos de uso */}
        <details className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
          <summary className="cursor-pointer font-semibold text-foreground">Como funciona · casos de uso e boas práticas</summary>
          <div className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-foreground/80">
            <p>
              O Regem é <strong className="text-foreground">Provedor de Tecnologia oficial da Meta (WhatsApp)</strong>. Você escolhe, por número, entre:
            </p>
            <p>
              <strong className="text-foreground">API Oficial (Meta)</strong> — mais segura e escalável para <strong>marketing</strong>. Iniciar conversa exige um{' '}
              <strong>modelo (template) aprovado</strong> e o <strong>opt-in</strong> do cliente; a Meta cobra as mensagens direto da conta da sua loja. É o caminho recomendado para disparos em volume.
            </p>
            <p>
              <strong className="text-foreground">Grátis (QR / Evolution)</strong> — sem custo por mensagem, mas <strong>não oficial</strong>: o número pode ser bloqueado pela Meta a qualquer momento. Use um <strong>número descartável</strong> para marketing, nunca o principal da loja.
            </p>
            <p>
              <strong className="text-foreground">Boas práticas:</strong> peça opt-in, respeite quem responde <strong>SAIR</strong> (entra na lista de exclusão automaticamente, com aviso de confirmação), mantenha <strong>1–3 mensagens por semana</strong>, e sempre identifique a loja. Isso protege a qualidade do número e evita bloqueios.
            </p>
          </div>
        </details>

        {/* Aviso: sem número conectado, o disparo não funciona */}
        {pode && numeros && !numeroConectado && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-700">
            ⚠️ Nenhum número de WhatsApp conectado. Conecte em <strong>Delivery · Configurações · Robô</strong> antes de criar campanhas.
          </div>
        )}

        {aba === 'modelos' && temCloud && <ModelosWhatsapp pode={pode} />}

        {/* Assistente */}
        {aba === 'campanhas' && novo && pode && (
          <Card className="space-y-4 p-4">
            {/* Tipo */}
            <div>
              <p className="mb-1 text-xs font-semibold text-foreground/70">Tipo de campanha</p>
              <div className="flex flex-wrap gap-2">
                {TIPOS.map((t) => (
                  <button
                    key={t.k}
                    type="button"
                    onClick={() => aplicarTipo(t.k)}
                    aria-pressed={tipo === t.k}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      tipo === t.k ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                    }`}
                  >
                    {t.t}
                  </button>
                ))}
              </div>
            </div>

            {/* Público */}
            <div>
              <p className="mb-1 text-xs font-semibold text-foreground/70">Público</p>
              <div className="flex flex-wrap items-center gap-2">
                {SEGS.map((s) => (
                  <button
                    key={s.k}
                    type="button"
                    onClick={() => setSeg(s.k)}
                    aria-pressed={seg === s.k}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      seg === s.k ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                    }`}
                  >
                    {s.t}
                  </button>
                ))}
                {seg === 'recuperacao' && (
                  <label className="text-xs text-foreground/70">
                    há mais de{' '}
                    <input
                      type="number"
                      min={1}
                      value={recDias}
                      onChange={(e) => setRecDias(Number(e.target.value) || 45)}
                      className="w-16 rounded-md border border-border bg-background px-2 py-1"
                    />{' '}
                    dias
                  </label>
                )}
              </div>
              <p className="mt-1 text-xs">
                {previa == null ? 'calculando público…' : <><strong>{previa}</strong> destinatário(s) (exclui opt-out e lista de exclusão)</>}
              </p>
            </div>

            {/* Conteúdo + prévia */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground/70">Mensagem</p>
                <textarea
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  rows={5}
                  maxLength={900}
                  placeholder="Escreva a mensagem… Use [link] e {CUPOM}. Inclua 'responda SAIR para não receber'."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (opcional) — ex.: cardápio/cupom" />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => e.target.files?.[0] && subirImagem(e.target.files[0])}
                  />
                  <Button type="button" size="sm" variant="outline" disabled={subindoImg} onClick={() => fileRef.current?.click()}>
                    {subindoImg ? 'Enviando…' : imagemRef ? 'Trocar imagem' : '＋ Imagem'}
                  </Button>
                  {imagemRef && (
                    <button type="button" className="text-[11px] text-destructive underline" onClick={() => setImagemRef(null)}>
                      remover
                    </button>
                  )}
                  <span className="text-[11px] text-foreground/70">Ideal 1080×1350 (4:5). Comprimimos automático.</span>
                </div>
              </div>

              {/* Prévia do balão do WhatsApp */}
              <div>
                <p className="mb-1 text-xs font-semibold text-foreground/70">Prévia (como o cliente vê)</p>
                <div className="rounded-lg bg-[#e5ddd5] p-3">
                  <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#dcf8c6] p-2 shadow">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {imagemRef && <img src={imagemRef} alt="prévia" className="mb-1 w-full rounded" />}
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-[#111]">
                      {captionPreview || 'sua mensagem aparece aqui…'}
                    </p>
                    <span className="mt-1 block text-right text-[10px] text-[#667781]">agora ✓✓</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Cupom automático */}
            {ehCupom && (
              <div className="rounded-lg border border-dashed border-border p-3">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={criarCupom} onChange={(e) => setCriarCupom(e.target.checked)} />
                  Criar o cupom no Regem automaticamente (se não existir)
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <label className="text-xs">
                    <span className="mb-0.5 block text-foreground/70">Código</span>
                    <Input value={cupomCodigo} onChange={(e) => setCupomCodigo(e.target.value.toUpperCase())} placeholder="PROMO10" />
                  </label>
                  {tipo !== 'frete_gratis' && (
                    <label className="text-xs">
                      <span className="mb-0.5 block text-foreground/70">Desconto (%)</span>
                      <Input type="number" value={cupomValor} onChange={(e) => setCupomValor(e.target.value)} />
                    </label>
                  )}
                  <label className="text-xs">
                    <span className="mb-0.5 block text-foreground/70">Validade (dias)</span>
                    <Input type="number" value={cupomDuracao} onChange={(e) => setCupomDuracao(e.target.value)} />
                  </label>
                </div>
              </div>
            )}

            {/* Enviar de + pacing + tetos */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="text-xs">
                <span className="mb-1 block text-foreground/70">Enviar do número</span>
                <div className="flex gap-2">
                  {(['marketing', 'loja'] as const).map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setInstancia(i)}
                      aria-pressed={instancia === i}
                      className={`rounded-md border px-3 py-1.5 ${instancia === i ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
                    >
                      {i === 'marketing' ? 'Marketing' : 'Principal'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-xs">
                <span className="mb-1 block text-foreground/70">Pausa (s)</span>
                <Input type="number" min={3} max={120} value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value) || 30)} className="w-20" />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-foreground/70">Teto/dia</span>
                <Input type="number" value={tetoDia} onChange={(e) => setTetoDia(e.target.value)} placeholder="—" className="w-20" />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-foreground/70">Teto/semana</span>
                <Input type="number" value={tetoSemana} onChange={(e) => setTetoSemana(e.target.value)} placeholder="—" className="w-24" />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-foreground/70">Teto/mês</span>
                <Input type="number" value={tetoMes} onChange={(e) => setTetoMes(e.target.value)} placeholder="—" className="w-24" />
              </label>
            </div>

            {/* API oficial (cloud): campanha por MODELO aprovado */}
            {ehCloud && (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <p className="text-xs font-semibold text-primary">
                  Número oficial (Meta) — a campanha vai por MODELO aprovado (o texto livre acima não é usado).
                </p>
                {templates.length === 0 ? (
                  <p className="text-xs text-foreground/70">
                    Nenhum modelo <strong>aprovado</strong> ainda. Crie e aprove um na aba <strong>Modelos</strong>.
                  </p>
                ) : (
                  <>
                    <label className="block text-xs">
                      <span className="mb-0.5 block text-foreground/70">Modelo aprovado</span>
                      <select
                        value={templateNome}
                        onChange={(e) => {
                          setTemplateNome(e.target.value);
                          setTemplateVars({});
                        }}
                        className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                      >
                        <option value="">Selecione…</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.nome}>{t.nome}</option>
                        ))}
                      </select>
                    </label>
                    {templateSel && <p className="whitespace-pre-wrap text-xs text-foreground/70">{templateSel.corpo}</p>}
                    {templateVarsCount > 0 && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {Array.from({ length: templateVarsCount }, (_, i) => (
                          <label key={i} className="text-xs">
                            <span className="mb-0.5 block text-foreground/70">Variável {'{{'}{i + 1}{'}}'}</span>
                            <Input
                              value={templateVars[String(i + 1)] ?? ''}
                              onChange={(e) => setTemplateVars((v) => ({ ...v, [String(i + 1)]: e.target.value }))}
                              placeholder="nome (ou texto fixo)"
                            />
                          </label>
                        ))}
                        <p className="text-[11px] text-foreground/70 sm:col-span-2">
                          Digite <strong>nome</strong> para inserir o primeiro nome do cliente; qualquer outro texto é fixo.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Agendamento */}
            <div className="rounded-lg border border-dashed border-border p-3">
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={agendada} onChange={(e) => setAgendada(e.target.checked)} />
                Agendar (dias e horário)
              </label>
              {agendada && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <div className="flex gap-1">
                    {DIAS.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDia(i)}
                        aria-pressed={dias.includes(i)}
                        className={`h-7 w-9 rounded border text-[11px] ${dias.includes(i) ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <label className="text-xs text-foreground/70">
                    das <input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1" />
                  </label>
                  <label className="text-xs text-foreground/70">
                    até <input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1" />
                  </label>
                  <span className="text-[11px] text-foreground/70">Vazio = manda direto, respeitando a pausa.</span>
                </div>
              )}
            </div>

            <p className="rounded-md bg-warn/10 px-3 py-2 text-xs text-foreground/70">
              ⚠️ Disparo em massa pode marcar o número. Enviamos pausado, só para quem não optou por sair; a mensagem deve identificar a loja e incluir “responda SAIR”. Marketing em número Evolution tem risco alto — prefira um número descartável.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNovo(false)}>Cancelar</Button>
              <Button onClick={criar} disabled={enviando || !previa || (ehCloud && !templateNome)}>
                {enviando ? 'Criando…' : `Criar campanha (${previa ?? 0})`}
              </Button>
            </div>
          </Card>
        )}

        {aba === 'campanhas' && (<>
        {/* API oficial exige modelo aprovado ANTES da campanha */}
        {semModeloAprovado && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-[13px] text-foreground/80">
            📋 Sua loja usa a <strong>API oficial da Meta</strong>: crie e <strong>aprove um modelo</strong> antes de disparar campanhas.
            {' '}
            <button type="button" className="font-semibold text-primary underline" onClick={() => setAba('modelos')}>
              Ir para Modelos
            </button>
          </div>
        )}
        {/* Lista de campanhas */}
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3">
            <p className="font-display font-bold">Campanhas</p>
          </div>
          {campanhas.length === 0 ? (
            <p className="px-4 py-6 text-sm text-foreground/70">Nenhuma campanha ainda.</p>
          ) : (
            <div className="divide-y divide-border">
              {campanhas.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-foreground/70">{c.tipo ?? 'avulsa'}</span>
                  <span className="min-w-0 flex-1 truncate">{c.mensagem}</span>
                  <span className="text-xs text-foreground/70">{c.enviados}/{c.total} enviados{c.falhas ? ` · ${c.falhas} falhas` : ''}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${c.status === 'concluida' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Lista de exclusão */}
        {pode && (
          <Card className="space-y-2 p-4">
            <p className="text-sm font-semibold text-foreground">Lista de exclusão (não receber marketing)</p>
            <p className="text-[13px] text-foreground/70">
              Esta lista é preenchida <strong>automaticamente</strong> quando o cliente responde <strong>SAIR</strong> numa campanha —
              ele recebe um aviso de que <strong>não receberá mais ofertas e campanhas</strong> e confirma a saída. Você também pode
              excluir um número manualmente aqui.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input value={excluir} onChange={(e) => setExcluir(e.target.value)} placeholder="5521999999999" className="max-w-[220px]" />
              <Button type="button" variant="outline" onClick={excluirTel}>Excluir número</Button>
            </div>
          </Card>
        )}
        </>)}
      </div>
    </Shell>
  );
}
