'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Plus, Printer, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialogo } from '@/components/ui/sobreposto';
import { TituloLista, Vazio, texto2 } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { horarioTexto } from '@/lib/vagas-ficha';
import type { AjustesDaLoja } from './ajustes-da-pagina';

// Pessoas › Candidatos › aba QR codes e links: um QR por lugar (balcão, salão, fachada…), quantas fichas vieram de cada
// um, o link para copiar e o CARTAZ A4 para imprimir (logo da loja, funções abertas, benefícios e o QR do lugar).
interface Qr { id: string; codigo: string; nome: string; fichas: number }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function htmlDoCartaz(d: AjustesDaLoja, qr: Qr, qrImagem: string): string {
  const p = d.pagina;
  const cor = p.corPrincipal || d.loja.corPrimaria || '#0F6647';
  const destaque = p.corDestaque || '#E8A845';
  const funcoes = (p.funcoes ?? []).filter((f: { aberta: boolean }) => f.aberta);
  const h = p.horarios;
  const horarios = [
    p.vagaFixa && h['12x36'].ativa ? `12x36 ${horarioTexto(h['12x36'])}` : '',
    p.vagaFixa && h['5x2'].ativa ? `5x2 ${horarioTexto(h['5x2'])}` : '',
    p.horista ? 'Horistas' : '',
  ].filter(Boolean);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cartaz — ${esc(qr.nome)}</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Arial,sans-serif;color:#1e2a22;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.f{display:flex;flex-direction:column;gap:12px;min-height:270mm}.t{border-radius:18px;padding:18px;text-align:center;color:#fff;background:${esc(cor)}}
.t img{max-width:62%;max-height:70mm;object-fit:contain;display:block;margin:0 auto 8px}.t h1{margin:4px 0 0;font-size:36px}
.s{text-align:center;background:${esc(destaque)};border-radius:999px;padding:6px 14px;font-weight:800;font-size:16px}
.c{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:center}ul{list-style:none;margin:0;padding:0}
li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed #d8cdbd;font-size:17px;font-weight:600}li b{color:${esc(cor)};text-align:right}
.q{border:4px dashed ${esc(destaque)};border-radius:18px;padding:14px;text-align:center}.q img{width:100%;max-width:70mm}.q b{display:block;font-size:19px}
.b{text-align:center;font-size:15px;font-weight:600}.r{text-align:center;font-size:12px;color:#55635a;margin-top:auto}
</style></head><body><div class="f">
<div class="t">${d.loja.logoRef ? `<img src="${esc(d.loja.logoRef)}" alt="">` : `<div style="font-size:34px;font-weight:800">${esc(d.loja.nome)}</div>`}<h1>Estamos contratando!</h1></div>
${p.frase ? `<div class="s">${esc(p.frase)}</div>` : ''}
<div class="c"><ul>${funcoes.map((f: { nome: string; salario: string }) => `<li><span>${esc(f.nome)}</span><b>${esc(f.salario)}</b></li>`).join('')}</ul>
<div class="q"><img src="${qrImagem}" alt="QR code"><b>Aponte a câmera do celular</b><span>e preencha a sua ficha em uns 6 minutos</span></div></div>
${horarios.length ? `<p class="b">🕒 ${esc(horarios.join(' · '))}</p>` : ''}
${(p.beneficios ?? []).length ? `<p class="b">🎁 ${esc(p.beneficios.join(' · '))}</p>` : ''}
<p class="r">As respostas são usadas só para a seleção de vagas. Dúvidas? Fale com a gerência.</p>
</div><script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`;
}

function CartaoQr({ q, link, aoImprimir, aoApagar }: { q: Qr; link: string; aoImprimir: () => void; aoApagar: () => void }) {
  const [img, setImg] = useState('');
  useEffect(() => {
    QRCode.toDataURL(link, { width: 220, margin: 1 }).then(setImg).catch(() => setImg(''));
  }, [link]);
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4">
      <h3 className="font-display text-base font-bold">{q.nome}</h3>
      <div className="grid min-h-[150px] place-items-center rounded-md bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img ? <img src={img} alt={`QR code de ${q.nome}`} className="h-[140px] w-[140px]" /> : <span className={texto2}>QR</span>}
      </div>
      <code className={`break-all font-mono text-xs ${texto2}`}>{link}</code>
      <p className="text-sm">
        {q.fichas === 0 ? (
          <span className={texto2}>Nenhuma ficha veio daqui ainda</span>
        ) : (
          <>
            <b className="font-mono">{q.fichas}</b> {q.fichas === 1 ? 'ficha veio daqui' : 'fichas vieram daqui'}
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={aoImprimir}>
          <Printer className="h-4 w-4" aria-hidden="true" /> Cartaz para imprimir
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copiado.'), () => toast.error('Não deu para copiar.'))}
        >
          <Copy className="h-4 w-4" aria-hidden="true" /> Copiar
        </Button>
        <Button type="button" size="sm" variant="ghost" aria-label={`Apagar o QR ${q.nome}`} onClick={aoApagar}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}

export function QrCodes({ dados }: { dados: AjustesDaLoja }) {
  const [qrs, setQrs] = useState<Qr[] | null>(null);
  const [novo, setNovo] = useState<string | null>(null);
  const [apagando, setApagando] = useState<Qr | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    try {
      setQrs(await api.vagasQrs());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para carregar os QR codes.');
      setQrs([]);
    }
  }, []);
  useEffect(() => {
    if (dados.codigo) carregar();
  }, [carregar, dados.codigo]);

  if (!dados.codigo) return <Vazio>Salve a página na aba &quot;Página de vagas&quot; primeiro: o endereço e os QR codes nascem com ela.</Vazio>;
  if (!qrs) return <SkeletonList />;
  const linkDe = (q: Qr) => `${window.location.origin}/v/${dados.codigo}?o=${q.codigo}`;
  const imprimir = async (q: Qr) => {
    const w = window.open('', '_blank');
    if (!w) return toast.error('Permita pop-ups para imprimir o cartaz.');
    const img = await QRCode.toDataURL(linkDe(q), { width: 700, margin: 1 });
    w.document.write(htmlDoCartaz(dados, q, img));
    w.document.close();
  };

  return (
    <section className="space-y-3" aria-labelledby="qr-titulo">
      <TituloLista id="qr-titulo" titulo="QR codes e links" total={qrs.length} mostrando={qrs.length} um="lugar" varios="lugares" extra="um QR por lugar mostra de onde vêm as fichas">
        <Button type="button" onClick={() => setNovo('')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Novo QR
        </Button>
      </TituloLista>
      {!dados.pagina?.ligada && (
        <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
          A página está desligada: quem ler o QR vê &quot;página não encontrada&quot;. Ligue na aba &quot;Página de vagas&quot;.
        </p>
      )}
      {qrs.length === 0 ? (
        <Vazio>Nenhum QR ainda. Crie um para cada lugar onde o cartaz vai ficar.</Vazio>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {qrs.map((q) => (
            <CartaoQr key={q.id} q={q} link={linkDe(q)} aoImprimir={() => void imprimir(q)} aoApagar={() => setApagando(q)} />
          ))}
        </div>
      )}
      {novo !== null && (
        <Dialogo
          titulo="Novo QR"
          aoFechar={() => setNovo(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setNovo(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={ocupado || novo.trim().length < 2}
                onClick={async () => {
                  setOcupado(true);
                  try {
                    await api.vagasCriarQr(novo.trim());
                    toast.success('QR criado.');
                    setNovo(null);
                    carregar();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Não deu para criar.');
                  } finally {
                    setOcupado(false);
                  }
                }}
              >
                Criar QR
              </Button>
            </>
          }
        >
          <label htmlFor="qr-nome" className="text-sm font-bold">
            Onde o cartaz vai ficar?
          </label>
          <Input id="qr-nome" value={novo} maxLength={60} placeholder="Ex.: Banheiro, Caixa, Post do Instagram" onChange={(e) => setNovo(e.target.value)} data-foco-inicial />
        </Dialogo>
      )}
      {apagando && (
        <Dialogo
          titulo={`Apagar o QR "${apagando.nome}"?`}
          alerta
          aoFechar={() => setApagando(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setApagando(null)} data-foco-inicial>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={ocupado}
                onClick={async () => {
                  setOcupado(true);
                  try {
                    await api.vagasApagarQr(apagando.id);
                    toast.success('QR apagado.');
                    setApagando(null);
                    carregar();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Não deu para apagar.');
                  } finally {
                    setOcupado(false);
                  }
                }}
              >
                Apagar QR
              </Button>
            </>
          }
        >
          <p className="text-sm">
            O cartaz já impresso com este QR continua abrindo a página, mas as fichas que chegarem por ele deixam de aparecer na contagem deste lugar. As fichas
            não são apagadas.
          </p>
        </Dialogo>
      )}
    </section>
  );
}
