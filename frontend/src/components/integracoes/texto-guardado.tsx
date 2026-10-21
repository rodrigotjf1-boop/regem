'use client';

import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import type { TextoGuardado } from './clique-tipos';
import { diaEHora } from './textos';

function Parte({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <h4 className="font-display text-xs font-bold uppercase tracking-wider text-secondary-foreground">{titulo}</h4>
      <div className="text-[13.5px] text-secondary-foreground">{children}</div>
    </div>
  );
}

const lista = (itens: { id: string; rotulo: string; ligada?: boolean }[], comEstado: boolean) =>
  itens.length ? (
    <ul className="grid gap-0.5">
      {itens.map((i) => (
        <li key={i.id}>
          <b className="text-foreground">{i.rotulo}</b>
          {comEstado ? ` · ${i.ligada ? 'ligada' : 'desligada'}` : ''}
        </li>
      ))}
    </ul>
  ) : (
    <p>—</p>
  );

// "O texto que você autorizou" (Hub DMS, F3, parte C): a prova que a autorização por clique guarda — a tela que o
// presidente viu, com a versão e a decisão dele. Aberto da gaveta de "Detalhes" em Aplicativos conectados.
export function DialogoTextoGuardado({
  texto,
  versao,
  em,
  por,
  aoFechar,
}: {
  texto: TextoGuardado;
  versao: number;
  em: string;
  por: string;
  aoFechar: () => void;
}) {
  const marcadas = texto.lojas.filter((l) => l.marcada);
  const p = texto.contaQuePede;
  return (
    <Dialogo
      titulo="O texto que você autorizou"
      aoFechar={aoFechar}
      largura="lg"
      rodape={
        <Button type="button" variant="outline" onClick={aoFechar}>
          Fechar
        </Button>
      }
    >
      <div className="grid gap-4">
        <p className="text-[13px] text-secondary-foreground">
          Versão {versao} · mostrado e confirmado com a senha em {diaEHora(em)}, por {por} (presidente).
        </p>
        <div className="grid gap-4 rounded-[11px] border border-border bg-secondary p-3.5">
          <div className="grid gap-1">
            <b className="font-display text-[15px] font-bold">{texto.titulo}</b>
            <p className="text-[13.5px] text-secondary-foreground">{texto.abertura}</p>
          </div>
          <Parte titulo="Quem pede">
            <p>
              {texto.aplicativo.nome}, aplicativo de {texto.aplicativo.empresa}
              {texto.aplicativo.cnpj ? ` (CNPJ ${texto.aplicativo.cnpj})` : ''}.
            </p>
            <p className="break-words">
              A conta {p.nome} no {texto.aplicativo.nome} ({p.cnpj ? `CNPJ ${p.cnpj}` : 'sem CNPJ informado'} · {p.email}
              {p.marca ? ` · para a marca ${p.marca}` : ''}){p.outraEmpresa ? ', de outra empresa' : ''}.
              {p.outraEmpresa && texto.confirmouOutraEmpresa ? ' Confirmado: a empresa foi contratada.' : ''}
            </p>
          </Parte>
          <Parte titulo={marcadas.length === 1 ? 'A loja marcada' : 'As lojas marcadas'}>
            <p>{marcadas.map((l) => l.nome).join(', ') || '—'}</p>
          </Parte>
          {texto.modo === 'mais' ? (
            <Parte titulo="O que mudou">{lista(texto.novas, true)}</Parte>
          ) : (
            <>
              <Parte titulo="Necessárias">{lista(texto.necessarias, false)}</Parte>
              {texto.opcionais.length > 0 && <Parte titulo="Opcionais">{lista(texto.opcionais, true)}</Parte>}
              {texto.dadosDosClientes.length > 0 && <Parte titulo="Dados dos clientes">{lista(texto.dadosDosClientes, true)}</Parte>}
            </>
          )}
          <Parte titulo={`O que o ${texto.aplicativo.nome} não pode`}>
            <ul className="grid gap-0.5">
              {texto.naoPode.map((n) => (
                <li key={n.rotulo}>
                  <b className="text-foreground">{n.rotulo}.</b> {n.frase}
                </li>
              ))}
            </ul>
          </Parte>
          <p className="text-[12.5px] text-secondary-foreground">{texto.rodape}</p>
        </div>
      </div>
    </Dialogo>
  );
}
