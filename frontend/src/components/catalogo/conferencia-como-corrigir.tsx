'use client';

import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { APP, listaE, precoNoApp, type CanalConferido, type LinhaConferida } from '@/lib/conferencia-apps';

// "Conferir com os apps" (R3 F4a) — a gaveta "Como corrigir" / "Como resolver" da linha que o Regem não liga sozinho
// (protótipo: sem código, código repetido; e, até a F4b trazer "Criar no Regem" e "Ligar a um produto", o "só no app" e o
// "só no Regem" sem código). Só explica: os caminhos são os do menu (Cadastros › Cardápio = /produtos; › Opções).
export function ConferenciaComoCorrigir({
  linha: l,
  canal,
  aoFechar,
  aoLerDeNovo,
}: {
  linha: LinhaConferida;
  canal: CanalConferido;
  aoFechar: () => void;
  aoLerDeNovo: () => void;
}) {
  const a = APP[canal];
  // Na 99 o código do item é o que o Regem mandou no "Exportar catálogo" (não há código sem item nem repetido lá).
  const ondeNoApp = canal === 'ifood' ? 'no Gestor de Pedidos do iFood' : 'na 99';
  const ondeNoRegem = l.tipo === 'item' ? 'Cadastros › Cardápio' : 'Cadastros › Cardápio › Opções';
  const coisa = l.tipo === 'item' ? 'o produto' : 'a opção';
  const lerDeNovo = `Volte aqui e toque em "Ler ${a.o} agora".`;

  let aviso = '';
  let passos: string[] = [];
  if (l.situacao === 'naoLiga' && l.motivo === 'semCodigo') {
    aviso = `"${l.nome}" não tem código PDV ${a.no}. Sem código, o Regem não sabe qual ${l.tipo === 'item' ? 'produto' : 'opção'} é: ${
      l.tipo === 'item' ? 'a venda não baixa o estoque' : 'não é cobrado nem baixa o estoque pelo Regem'
    }.`;
    passos = [
      `Em ${ondeNoRegem}, veja o código PDV de ${coisa} "${l.nome}" (ou dê um código a ele).`,
      `${ondeNoApp.replace(/^./, (x) => x.toUpperCase())}, abra "${l.nome}" e preencha o código PDV com esse mesmo código.`,
      lerDeNovo,
    ];
  } else if (l.situacao === 'naoLiga' && l.motivo === 'repetidoNoApp') {
    aviso = `O código ${l.pdv} está em ${listaE([l.nome, ...l.outros])} ${a.no}. Com o código repetido, a venda de um baixaria o estoque do outro — por isso nenhum deles é ligado.`;
    passos = [
      `${ondeNoApp.replace(/^./, (x) => x.toUpperCase())}, deixe o código ${l.pdv} em um só deles e dê um código novo aos outros.`,
      `Em ${ondeNoRegem}, ponha cada código novo ${l.tipo === 'item' ? 'no produto certo' : 'na opção certa'}.`,
      lerDeNovo,
    ];
  } else if (l.situacao === 'naoLiga' && l.motivo === 'repetidoNoRegem') {
    aviso = `O código ${l.pdv} está em ${listaE(l.outros)} no Regem. Com o código repetido, o Regem não sabe qual baixar quando ${a.o} vende "${l.nome}".`;
    passos = [`Em ${ondeNoRegem}, deixe o código ${l.pdv} em um só e dê outro código (ou nenhum) aos outros.`, lerDeNovo];
  } else if (l.situacao === 'soApp') {
    aviso = `${a.nome.replace(/^./, (x) => x.toUpperCase())} vende "${l.nome}" (código ${l.pdv}, ${precoNoApp(l)}), mas nenhum${l.tipo === 'item' ? ' produto' : 'a opção'} do Regem tem esse código: ${
      l.tipo === 'item' ? 'a venda não baixa o estoque' : 'não é cobrado nem baixa o estoque pelo Regem'
    }.`;
    passos = [
      `Se ${coisa} já existe no Regem com outro código: em ${ondeNoRegem}, troque o código dele para ${l.pdv}.`,
      `Se não existe: crie ${coisa} em ${ondeNoRegem} com o código PDV ${l.pdv}.`,
      lerDeNovo,
    ];
  } else if (l.situacao === 'soRegem' && l.motivo === 'semCodigoNoRegem') {
    aviso = `"${l.nome}" está marcado "${a.marca}", mas não tem código PDV no Regem: não liga ${a.ao}.`;
    passos = [
      `${ondeNoApp.replace(/^./, (x) => x.toUpperCase())}, veja o código PDV do item "${l.nome}".`,
      'Ponha esse código no produto (Editar, em Produtos e preços).',
      lerDeNovo,
    ];
  } else if (canal === '99food') {
    aviso = `"${l.nome}" está marcado "${a.marca}", mas a 99 não tem item com o código ${l.pdv}.`;
    passos = [
      'Se o produto é vendido na 99: mande o cardápio de novo em Delivery › Painel › ⚙️ › Integrações › 99Food › "Exportar catálogo".',
      `Se não é: tire o "${a.marca}" (o botão na linha).`,
      lerDeNovo,
    ];
  } else {
    aviso = `"${l.nome}" está marcado "${a.marca}", mas o iFood não tem item com o código ${l.pdv}.`;
    passos = [
      `Se o item existe no iFood com outro código: no Gestor de Pedidos do iFood, troque o código dele para ${l.pdv} (ou ponha o código de lá no produto do Regem).`,
      `Se o produto não é vendido no iFood: tire o "${a.marca}" (o botão na linha).`,
      lerDeNovo,
    ];
  }

  return (
    <Gaveta
      titulo={l.situacao === 'naoLiga' ? 'Como corrigir' : 'Como resolver'}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
          <Button type="button" onClick={aoLerDeNovo}>
            Ler {a.o} agora
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2">{aviso}</p>
        <ol className="list-decimal space-y-2 pl-5">
          {passos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        <p className={`text-xs ${texto2}`}>A conferência compara pelo código PDV: o código do produto no Regem é o código do item {a.no}.</p>
      </div>
    </Gaveta>
  );
}
