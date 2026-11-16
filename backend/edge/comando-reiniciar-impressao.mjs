// Comando 'reiniciar_impressao' (nuvem → servidor da loja; F4.4 do Mister, `docs/plano-mister.md`, conversa 5 do
// protótipo `mockups/regem-mister.html`): reinicia o serviço do Windows `RegemEdgeImpressao` — o worker da fila de
// impressão local —, como o técnico faria pelo services.msc. As vias que estavam na fila saem quando ele volta (o
// worker relê a fila ao subir). Quem pede é o presidente, pelo botão "Autorizar" do Mister; a nuvem confere depois se a
// impressora voltou a responder.
//
// A execução vem de fora (`executar` = o `execFile` com promessa do daemon) para o teste trocar por uma de mentira.
// O sync roda como serviço do NSSM (conta do sistema), que pode parar e subir os outros serviços do Regem.

export const SERVICO_DA_IMPRESSAO = 'RegemEdgeImpressao';

/** Reinicia o serviço de impressão e confere que ele voltou a rodar. Lança com a frase do que deu errado. */
export async function reiniciarServicoDeImpressao(executar) {
  try {
    await executar(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Restart-Service -Name ${SERVICO_DA_IMPRESSAO} -Force -ErrorAction Stop`],
      { timeout: 60_000, windowsHide: true },
    );
  } catch (e) {
    const dito = String(e?.stderr || e?.message || e).replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim().slice(0, 160);
    throw new Error(`o Windows recusou o reinício (${dito})`);
  }
  // A situação pelo `Get-Service` (o valor do enum, "Running", não muda com o idioma do Windows — o texto do `sc query` muda).
  const { stdout } = await executar(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `(Get-Service -Name ${SERVICO_DA_IMPRESSAO}).Status`],
    { timeout: 15_000, windowsHide: true },
  );
  if (String(stdout ?? '').trim() !== 'Running') throw new Error('o serviço não voltou a rodar depois de reiniciar');
  return 'serviço de impressão reiniciado';
}
