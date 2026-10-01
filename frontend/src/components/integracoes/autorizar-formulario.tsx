'use client';

import { useRef, useState } from 'react';
import { Check, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Chave } from './chave';
import { ParDeSelos } from './autorizar-moldura';
import { CUSTO_SEM_PERMISSAO, NAO_VAI, TEXTO_ESCOPO, dia, plural } from './textos';

export type PedidoOk = {
  situacao: 'ok';
  cliente: { chave: string; rotulo: string; descricao: string; site: string };
  empresa: string;
  quem: { nome: string; verFinanceiro: boolean };
  lojas: { id: string; nome: string; tipo: string | null; conectadaDesde: string | null }[];
  sempre: { chave: string; rotulo: string }[];
  opcionais: { campo: string; chave: string; rotulo: string; padrao: boolean; disponivel: boolean }[];
  cancelarUrl: string;
};

const textoDe = (e: { chave: string; rotulo: string }) => TEXTO_ESCOPO[e.chave] ?? { rotulo: e.rotulo, texto: '' };

function Secao({ n, titulo, id, children }: { n: number; titulo: string; id: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5" aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2 font-display text-[15px] font-bold">
        <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-foreground font-mono text-[11px] font-bold text-white">{n}</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Item({
  icone,
  titulo,
  idTitulo,
  texto,
  codigo,
  apagado = false,
  lado,
}: {
  icone: 'ok' | 'cadeado';
  titulo: string;
  idTitulo?: string;
  texto: string;
  codigo?: string;
  apagado?: boolean;
  lado?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border px-3.5 py-3 first:border-t-0">
      {icone === 'ok' ? (
        <Check className="mt-0.5 h-[18px] w-[18px] flex-none text-ok" aria-hidden="true" />
      ) : (
        <Lock className="mt-0.5 h-[18px] w-[18px] flex-none text-muted-foreground" aria-hidden="true" />
      )}
      <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
        <b id={idTitulo} className={cn('font-bold', apagado && 'text-secondary-foreground')}>
          {titulo}
        </b>
        {texto && <span className="text-[13px] text-secondary-foreground">{texto}</span>}
        {codigo && <code className="font-mono text-[11px] text-muted-foreground">{codigo}</code>}
      </div>
      {lado && <div className="self-center pl-[30px] sm:pl-0">{lado}</div>}
    </li>
  );
}

// O formulário da autorização (mockup aprovado em 01/10/2026): quais lojas, o que o aplicativo
// recebe (o que vai sempre e o que o presidente decide), o que não vai, e os dois botões.
export function AutorizarFormulario({
  pedido,
  enviando,
  aoAutorizar,
  aoCancelar,
}: {
  pedido: PedidoOk;
  enviando: boolean;
  aoAutorizar: (lojas: string[], opcionais: Record<string, boolean>) => void;
  aoCancelar: () => void;
}) {
  const app = pedido.cliente.rotulo;
  const umaLoja = pedido.lojas.length === 1;
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>(() => Object.fromEntries(pedido.lojas.map((l) => [l.id, true])));
  const [chaves, setChaves] = useState<Record<string, boolean>>(() => Object.fromEntries(pedido.opcionais.map((o) => [o.campo, o.padrao])));
  const [semLoja, setSemLoja] = useState(false);
  const primeira = useRef<HTMLInputElement>(null);
  const escolhidas = pedido.lojas.filter((l) => marcadas[l.id]).map((l) => l.id);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!escolhidas.length) {
      setSemLoja(true);
      primeira.current?.focus();
      return;
    }
    aoAutorizar(
      escolhidas,
      Object.fromEntries(pedido.opcionais.map((o) => [o.campo, o.disponivel && Boolean(chaves[o.campo])])),
    );
  }

  return (
    <form onSubmit={enviar} noValidate className="grid w-full max-w-[640px] gap-5 rounded-xl border border-border bg-card p-[18px] sm:gap-[22px] sm:p-[26px]">
      <div className="grid gap-2">
        <ParDeSelos cliente={pedido.cliente.chave} rotulo={app} />
        <h1 className="font-display text-[19px] font-extrabold leading-tight sm:text-[22px]">
          O {app} quer ler as vendas {umaLoja ? 'da sua loja' : 'das suas lojas'}
        </h1>
        <p className="text-secondary-foreground">
          O {app} mede quais anúncios viraram pedido no caixa. Ele só lê o que estiver marcado aqui; não muda pedido, preço nem cardápio.
          Você veio de <span className="font-mono text-[13px]">{pedido.cliente.site}</span> e volta para lá ao terminar.
        </p>
      </div>

      <Secao n={1} titulo={umaLoja ? 'A loja' : 'Quais lojas'} id="aut-lojas">
        {pedido.lojas.map((l, i) => (
          <label
            key={l.id}
            className={cn(
              'grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-[11px] border px-3.5 py-3',
              marcadas[l.id] ? 'border-primary bg-primary/10' : 'border-border',
            )}
          >
            <input
              ref={i === 0 ? primeira : undefined}
              type="checkbox"
              className="mt-0.5 h-[18px] w-[18px] accent-[hsl(var(--primary))]"
              checked={Boolean(marcadas[l.id])}
              aria-describedby={semLoja ? 'aut-lojas-erro' : undefined}
              onChange={(e) => {
                setMarcadas((m) => ({ ...m, [l.id]: e.target.checked }));
                setSemLoja(false);
              }}
            />
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <b className="font-bold">{l.nome}</b>
              {l.tipo && (
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11.5px] font-semibold text-secondary-foreground">
                  {l.tipo === 'matriz' ? 'Matriz' : 'Filial'}
                </span>
              )}
              {l.conectadaDesde && (
                <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11.5px] font-semibold text-ok">Conectada desde {dia(l.conectadaDesde)}</span>
              )}
            </span>
            {l.conectadaDesde && (
              <small className="col-start-2 text-[12.5px] text-secondary-foreground">
                Autorizar de novo troca o token desta loja: o antigo para de valer na hora, e a leitura continua de onde parou.
              </small>
            )}
          </label>
        ))}
        {semLoja && (
          <p id="aut-lojas-erro" role="alert" className="text-[13px] font-semibold text-destructive">
            Marque ao menos uma loja.
          </p>
        )}
      </Secao>

      <Secao n={2} titulo={`O que o ${app} recebe de cada loja marcada`} id="aut-recebe">
        <h3 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">Sempre</h3>
        <ul className="overflow-hidden rounded-[11px] border border-border">
          {pedido.sempre.map((e) => (
            <Item key={e.chave} icone="ok" titulo={textoDe(e).rotulo} texto={textoDe(e).texto} codigo={e.chave} />
          ))}
        </ul>
        {pedido.opcionais.length > 0 && (
          <>
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">Você decide</h3>
            <ul className="overflow-hidden rounded-[11px] border border-border">
              {pedido.opcionais.map((o) => {
                const ligada = o.disponivel && Boolean(chaves[o.campo]);
                return (
                  <Item
                    key={o.chave}
                    icone={ligada ? 'ok' : 'cadeado'}
                    titulo={textoDe(o).rotulo}
                    idTitulo={`aut-chave-${o.campo}`}
                    texto={o.disponivel ? textoDe(o).texto : o.chave === 'custos.ler' ? CUSTO_SEM_PERMISSAO : 'O seu perfil não pode liberar este item.'}
                    codigo={o.chave}
                    apagado={!ligada}
                    lado={
                      <Chave
                        ligada={ligada}
                        travada={!o.disponivel}
                        rotuladaPor={`aut-chave-${o.campo}`}
                        aoMudar={(v) => setChaves((c) => ({ ...c, [o.campo]: v }))}
                      />
                    }
                  />
                );
              })}
            </ul>
          </>
        )}
      </Secao>

      <Secao n={3} titulo="O que não vai" id="aut-nao-vai">
        <ul className="overflow-hidden rounded-[11px] border border-border">
          {NAO_VAI.map((n) => (
            <Item key={n.titulo} icone="cadeado" titulo={n.titulo} texto={n.texto.replaceAll('Liame', app)} />
          ))}
        </ul>
      </Secao>

      <p className="flex gap-2.5 rounded-[11px] border border-border bg-secondary px-3.5 py-3 text-[13px] text-secondary-foreground">
        <ShieldCheck className="mt-px h-[18px] w-[18px] flex-none text-muted-foreground" aria-hidden="true" />
        <span>
          Cada loja ganha um acesso próprio, que vai direto do Regem para o {app}: ninguém vê nem copia. Vale até você revogar, em{' '}
          <b className="text-foreground">Configurações → Aplicativos conectados</b> ou no {app}.
        </span>
      </p>

      <div className="flex flex-wrap justify-end gap-2.5">
        <Button type="button" variant="outline" className="flex-1 font-bold sm:flex-none" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 font-bold sm:flex-none" disabled={enviando}>
          {enviando ? 'Autorizando…' : escolhidas.length ? `Autorizar ${plural(escolhidas.length, 'loja', 'lojas')}` : 'Autorizar'}
        </Button>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        Fica registrado na auditoria: quem autorizou, quando, quais lojas e o que foi liberado.
      </p>
    </form>
  );
}
