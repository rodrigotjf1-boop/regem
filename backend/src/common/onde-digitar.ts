// ONDE DIGITAR O CÓDIGO DE PAREAMENTO, por tipo — um lugar só para o ícone do servidor (bandeja.service), a tela
// Equipamentos (a resposta de "Gerar código" e de "Reativar") e a recusa do código digitado no aparelho errado.
// Os nomes das telas e botões estão como aparecem neles (V65): o caixa e o garçom ("Código do terminal" → "Parear e
// liberar o caixa", `terminal-gate.tsx`), o ícone "Regem neste PC" → "Parear com codigo..." (`RegemEstacao.cs`), a TV
// ("Parear esta TV", `app/senhas/page.tsx`) e o instalador (tela "Este PC", caixa "Este PC tem impressora", `.iss`).
// "Parear sem reinstalar" (pedido do dono de 22/10/2026): o instalador fica só para o PC NOVO.

export type OndeDigitar = { titulo: string; passos: string[]; obs?: string };

export function ondeDigitar(tipo: string): OndeDigitar | null {
  if (tipo === 'pdv' || tipo === 'salao')
    return {
      titulo: tipo === 'pdv' ? 'No caixa' : 'No celular ou tablet do garçom',
      passos: ['Abra o Regem no aparelho.', 'Na tela "Código do terminal", digite os 6 números.', 'Toque em "Parear e liberar o caixa".'],
    };
  if (tipo === 'estacao_impressao')
    return {
      titulo: 'No PC da estação de impressão',
      passos: [
        'Perto do relógio, clique com o botão direito no ícone "Regem neste PC".',
        'Escolha "Parear com codigo...".',
        'Digite os 6 números e clique em "Parear". As impressoras dela continuam as mesmas.',
      ],
      // O atalho é do instalador a partir da parte 2 do "parear sem reinstalar" (instalar-tudo.ps1, modo cliente).
      obs:
        'Sem o ícone perto do relógio? Abra o atalho "Regem - parear este PC" na área de trabalho. ' +
        'PC novo, sem o Regem? Rode o RegemEdgeSetup.exe, escolha "Cliente" e, na tela "Este PC", marque "Este PC tem impressora" e digite o código.',
    };
  if (tipo === 'tela_senhas') return { titulo: 'Na TV de senhas', passos: ['A TV mostra "Parear esta TV".', 'Digite os 6 números.'] };
  return null;
}

/**
 * Os tipos que pareiam pela MESMA tela: o garçom (sub-PDV do salão) usa a tela do caixa ("Código do terminal"). O código
 * digitado num aparelho de outro grupo é recusado SEM ser gasto (senão troca o segredo do aparelho dono do código).
 */
export function mesmoLugarDeParear(tipoDoCodigo: string, tipoDeQuemDigitou: string): boolean {
  const grupo = (t: string) => (t === 'pdv' || t === 'salao' ? 'caixa' : t);
  return grupo(tipoDoCodigo) === grupo(tipoDeQuemDigitou);
}
