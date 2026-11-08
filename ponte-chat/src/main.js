'use strict';

// REGEM · PONTE DO CHAT — o programa do PC da loja (parte B da ponte do chat; plano e protótipos v3 aprovados pelo dono em
// 04/11/2026). Abre o Gestor de Pedidos do iFood DENTRO dele (a pessoa da loja entra com o login dela, uma vez; a senha
// nunca passa pelo Regem), lê o chat e conversa com a nuvem do Regem:
//  • pareia este PC por código (Configurações › Equipamentos › "Ponte do chat (iFood e 99, no PC)" › Gerar código);
//  • manda o sinal de vida a cada 30 s (logado ou não no iFood); a nuvem responde se a ponte está LIGADA nos ajustes;
//  • com a ponte ligada, manda as mensagens que chegam no chat (do cliente e da loja); desligada, não manda nada;
//  • (v0.4) ENVIA SOZINHO o que a nuvem enfileira para o chat (avisos "saiu"/"chegando"): pega a vez na fila só com a
//    tela do Gestor LIVRE, confere se a mensagem já está no chat (contra o envio em dobro), digita pelo caminho conferido
//    da v0.3 sem tomar o teclado, e devolve o resultado — `saida.js`;
//  • anota o diagnóstico da ligação conversa × pedido (só marcas, nenhum texto — `diagnostico.js`);
//  • (v0.5) PAUSA neste PC ("Pausar a ponte neste PC": não lê nem responde até retomar — guardada, vale depois de
//    reiniciar; a nuvem passa a vez à reserva), a janela "Estado da ponte" e o canal com o ícone "Regem neste PC": o
//    arquivo `estado-da-ponte.json` e os comandos --abrir/--pausar/--retomar (`estado-local.js`);
//  • (v0.6, Etapa 4a) LÊ o chat da 99: a pessoa abre a 99 numa janela própria ("Abrir a 99") e entra com a CONTA
//    PRINCIPAL da loja (0.7.3, decisão do dono de 08/11/2026 — até a 0.7.2 era o usuário extra, que tem sessão própria mas
//    também conversas próprias: não recebe o chat dos clientes, medido em 07/11). A 99 aceita um login por conta (ERR-365):
//    a 99 fica aberta SÓ na ponte. A escuta é do IM da 99 (`leitor-99.js`); a nuvem liga cada mensagem ao
//    pedido pelo cliente. Sozinha, a 99 só é LIDA (o sinal diz "lendo"): responder é pelo portal da 99;
//  • (v0.7, Etapa 4b) com "Responder pela 99 neste PC" ligado (nasce desligado), ENVIA pela 99 o que a nuvem enfileira
//    (avisos, robô, equipe): busca o pedido, abre a conversa com clique de mouse pelo depurador, confere o número duas
//    vezes, escreve, aperta o "Enviar" da conversa e confirma pela resposta da 99 — `envio-99.js`; a mesma fila de saída.

// Aberto do terminal do VS Code, o Electron herda ELECTRON_RUN_AS_NODE e roda como Node puro (ERR-363): reabre sem ela.
if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawn } = require('child_process');
  const path = require('path');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, [path.join(__dirname, '..'), ...process.argv.slice(2)], { env, detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
}

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, safeStorage, shell } = require('electron');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { Configuracao } = require('./configuracao');
const { Diagnostico } = require('./diagnostico');
const { FilaDeEntrada } = require('./fila-entrada');
const { ligarLeitor } = require('./leitor');
const { ligarLeitor99 } = require('./leitor-99');
const { lerATelaDoChat, lerOQuadro } = require('./tela-do-chat');
const envio = require('./envio-ifood');
const envio99 = require('./envio-99');
const { motivoParaNaoEnviar } = require('./regras');
const nuvem = require('./nuvem');
const { Jornal } = require('./jornal');
const { Saida } = require('./saida');
const { INSTALAR_VIGIA, ESTADO_DA_TELA, avaliarTela, mexeuDesde } = require('./tela-livre');
const local = require('./estado-local');

const GESTOR = process.env.REGEM_PONTE_GESTOR || 'https://gestordepedidos.ifood.com.br/';
const SO_OBSERVAR = process.argv.includes('--so-observar') || process.env.REGEM_PONTE_SO_OBSERVAR === '1';
// os intervalos: 30 s o sinal de vida, 3 s a fila (o teste de ponta a ponta encurta pelas variáveis)
const SINAL_MS = Number(process.env.REGEM_PONTE_SINAL_MS) || 30000;
const FILA_MS = Number(process.env.REGEM_PONTE_FILA_MS) || 3000;
// v0.4: a fila de SAÍDA a cada 5 s; a tela tem de estar parada há 10 s; com ela ocupada depois de pegar, segura 45 s
const SAIDA_MS = Number(process.env.REGEM_PONTE_SAIDA_MS) || 5000;
const PARADA_MS = Number(process.env.REGEM_PONTE_PARADA_MS) || 10000;
const ESPERA_TELA_MS = Number(process.env.REGEM_PONTE_ESPERA_TELA_MS) || 45000;
const ECO_MS = Number(process.env.REGEM_PONTE_ECO_MS) || 20000; // quanto esperar o eco do envio (a prova encurta)
// A 99 (4a): o portal (a prova troca pela 99 de mentira); "logada" = respondeu o polling do IM nos últimos 5 min
const NOVENTA = process.env.REGEM_PONTE_99 || 'https://merchant.99app.com/pt-BR/store/pc-v2/order';
const LOGADA_99_MS = Number(process.env.REGEM_PONTE_99_LOGADA_MS) || 5 * 60 * 1000;
const ICONE = path.join(__dirname, '..', 'assets', 'regem.ico');

app.setName('Regem Ponte do chat');
app.setPath('userData', process.env.REGEM_PONTE_DADOS || path.join(app.getPath('appData'), 'Regem Ponte do chat'));
// O Gestor vê um Chrome comum (sem "Electron" no agente).
const MAIOR = String(process.versions.chrome || '').split('.')[0];
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAIOR}.0.0.0 Safari/537.36`;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const cfg = new Configuracao(app.getPath('userData'), safeStorage);
  const estado = {
    ligada: false,
    papel: 'fora', // o papel desta ponte no iFood: responde | reserva | fora
    nuvem: 'aguardando', // ok | rede | servidor | limite | nao_reconhecido | revogado | recusado
    logadoNoIfood: false,
    logadoNa99: false, // a 99 (4a): a janela da 99 aberta e o IM dela respondendo
    papel99: 'fora', // o papel desta ponte na 99 (4b — só com "Responder pela 99 neste PC" ligado): responde | reserva | fora
    enviadas: 0,
    ultimoErro: null,
    // pausada pela pessoa NESTE PC (peça 6): não lê nem responde até retomar — guardada, vale depois de reiniciar
    pausadaEm: cfg.pausadaEm(),
  };
  let gestor = null;
  let janela99 = null; // o portal da 99 (4a), com a conta principal da loja (0.7.3)
  let leitor99 = null;
  let janelaDoEstado = null;
  let pareamento = null;
  let testeEnvio = null;
  let bandeja = null;
  let leitor = null;
  let saindo = false;
  let diagnostico = null;
  let ocupadoNoGestor = false; // um ensaio/envio por vez (os dois mexem na tela do Gestor)
  let ultimoEnsaio = null; // { numero, em } — o envio de verdade só depois de um ensaio certo do MESMO pedido
  let ultimaTeclaEm = 0; // a última tecla de GENTE na janela do Gestor (o Electron conta à parte da página)
  let jornal = null; // o diário dos envios da fila (v0.4)
  let saida = null; // o envio automático pela fila da nuvem (v0.4)
  let saida99 = null; // o mesmo, pela 99 (4b)
  let ocupadoNa99 = false; // um envio por vez na janela da 99
  let ultimaTecla99Em = 0; // a última tecla de GENTE na janela da 99

  const fila = new FilaDeEntrada(async (lote) => {
    const cred = cfg.credencial();
    if (!cred) return { ok: false };
    const r = await nuvem.mensagens(cred, lote);
    tratarClassificacao(nuvem.classificar(r));
    if (r.ok && r.dados && r.dados.desligada === true) {
      // desligaram a ponte nos ajustes entre um sinal e outro: para já e não guarda nada
      estado.ligada = false;
      fila.esvaziar();
      atualizarBandeja();
      return { ok: false };
    }
    if (r.ok) estado.enviadas += lote.length;
    return r;
  });

  function registrarErro(s) {
    estado.ultimoErro = `${new Date().toLocaleTimeString('pt-BR')} ${s}`;
    atualizarBandeja();
  }

  function textoDaSituacao() {
    if (SO_OBSERVAR) return 'Só observando (sem nuvem) — diagnóstico ligado';
    if (!cfg.credencial()) return 'Falta parear este PC';
    const da99 = !cfg.usar99() ? '' : !estado.logadoNa99 ? ' · 99: sem login' : cfg.responder99() ? ' · 99: lê e responde' : ' · 99: lendo';
    const ifood = `${estado.logadoNoIfood ? 'iFood: logado' : 'iFood: entre com o login da loja'}${da99}`;
    if (estado.pausadaEm) return `PAUSADA neste PC desde ${local.hora(estado.pausadaEm)} · ${ifood}`;
    const n = {
      ok: estado.ligada ? (estado.papel === 'responde' ? 'ponte ligada · este PC responde' : 'ponte ligada · este PC é reserva') : 'ponte DESLIGADA nos ajustes do Regem',
      aguardando: 'falando com a nuvem…',
      rede: 'sem conexão com a nuvem — tentando de novo',
      servidor: 'a nuvem falhou — tentando de novo',
      limite: 'muitas chamadas — esperando um pouco',
      nao_reconhecido: 'o Regem não reconheceu este PC — tentando de novo',
      revogado: 'a ponte deste PC foi revogada — pareie de novo',
      recusado: 'a nuvem recusou o pedido',
    }[estado.nuvem] || estado.nuvem;
    return `${ifood} · ${n}`;
  }

  /** O resumo de agora (a janela "Estado da ponte" e o arquivo que o ícone "Regem neste PC" lê). */
  function resumoDeAgora() {
    return local.resumo(estado, {
      versao: app.getVersion(),
      maquina: os.hostname(),
      pareada: !!cfg.credencial(),
      nome: cfg.nome(),
      soObservar: SO_OBSERVAR,
      pausadaEm: estado.pausadaEm,
      usar99: cfg.usar99(),
      responder99: cfg.responder99(),
      saida: saida ? { situacao: saida.situacao, enviadas: saida.enviadas } : null,
      saida99: saida99 && cfg.responder99() ? { situacao: saida99.situacao, enviadas: saida99.enviadas } : null,
      abrir: { exe: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] },
    });
  }

  /** O estado mudou (ou passou um sinal de vida): a janela do estado e o arquivo do ícone do Regem acompanham. */
  function publicarEstado() {
    const r = resumoDeAgora();
    try {
      local.gravar(app.getPath('userData'), r);
    } catch {
      /* sem gravar: o ícone do Regem diz que não sabe da ponte — a ponte segue */
    }
    if (janelaDoEstado && !janelaDoEstado.isDestroyed()) janelaDoEstado.webContents.send('ponte:mudou', local.paraAJanela(r));
  }

  function atualizarBandeja() {
    const sit = textoDaSituacao();
    if (gestor && !gestor.isDestroyed()) gestor.setTitle(`Regem · Ponte do chat — ${sit}`);
    if (janela99 && !janela99.isDestroyed())
      janela99.setTitle(`Regem · Ponte do chat — 99 (conta principal da loja; a 99 fica aberta só aqui) — ${estado.logadoNa99 ? 'lendo o chat' : 'sem login'}`);
    publicarEstado();
    if (!bandeja) return;
    bandeja.setToolTip(`Regem · Ponte do chat\n${sit}`.slice(0, 127));
    const pareada = !SO_OBSERVAR && !!cfg.credencial();
    bandeja.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Regem · Ponte do chat', enabled: false },
        { label: sit, enabled: false },
        ...(estado.ultimoErro ? [{ label: `Último aviso: ${estado.ultimoErro}`.slice(0, 120), enabled: false }] : []),
        ...(saida ? [{ label: `Fila de saída: ${saida.situacao} · ${saida.enviadas} enviada(s) por este PC`.slice(0, 120), enabled: false }] : []),
        { type: 'separator' },
        { label: 'Ver o estado da ponte', click: () => abrirEstado() },
        // os nomes destes dois itens são os que as telas do Regem citam (V65 — `frontend/src/lib/ponte-do-chat.ts`)
        ...(pareada ? [estado.pausadaEm ? { label: 'Retomar a ponte neste PC', click: () => pausar(false) } : { label: 'Pausar a ponte neste PC', click: () => pausar(true) }] : []),
        { label: 'Abrir o Gestor do iFood', click: () => abrirGestor() },
        ...(!SO_OBSERVAR ? [{ label: 'Abrir a 99 (conta principal)', click: () => abrir99().catch((e) => registrarErro(String(e && e.message))) }] : []),
        ...(!SO_OBSERVAR && cfg.usar99() && cfg.credencial()
          ? [{ label: 'Responder pela 99 neste PC', type: 'checkbox', checked: cfg.responder99(), click: () => responder99(!cfg.responder99()).catch((e) => registrarErro(String(e && e.message))) }]
          : []),
        ...(saida99 && cfg.responder99() ? [{ label: `Fila de saída da 99: ${saida99.situacao} · ${saida99.enviadas} enviada(s)`.slice(0, 120), enabled: false }] : []),
        ...(!SO_OBSERVAR && cfg.usar99() ? [{ label: 'Parar de ler a 99 neste PC', click: () => parar99() }] : []),
        { label: 'Teste de envio (ensaio)…', click: () => abrirTesteDeEnvio() },
        ...(!SO_OBSERVAR && !cfg.credencial() ? [{ label: 'Parear este PC', click: () => abrirPareamento() }] : []),
        { label: 'Abrir a pasta do diagnóstico', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: `Versão ${app.getVersion()}`, enabled: false },
        { label: 'Sair da ponte', click: () => sair() },
      ]),
    );
  }

  function tratarClassificacao(c) {
    estado.nuvem = c;
    if (c === 'revogado') {
      cfg.esquecerPareamento();
      fila.esvaziar();
      estado.ligada = false;
      abrirPareamento('A ponte deste PC foi revogada no Regem. Gere um código novo em Configurações › Equipamentos.');
    }
    atualizarBandeja();
  }

  function logadoNoIfood() {
    if (!gestor || gestor.isDestroyed() || !leitor) return false;
    let u;
    try {
      u = new URL(gestor.webContents.getURL());
    } catch {
      return false;
    }
    const naTela = /(^|\.)gestordepedidos\.ifood\.com\.br$/i.test(u.hostname) || Boolean(process.env.REGEM_PONTE_GESTOR);
    return naTela && leitor.chatAberto();
  }

  /** A 99 logada (4a): a janela da 99 no portal e o IM dela respondendo o polling há pouco. */
  function logadoNa99() {
    if (!janela99 || janela99.isDestroyed() || !leitor99) return false;
    let u;
    try {
      u = new URL(janela99.webContents.getURL());
    } catch {
      return false;
    }
    const naTela = /(^|\.)99app\.com$/i.test(u.hostname) || Boolean(process.env.REGEM_PONTE_99);
    const ultimo = leitor99.ultimoPolling();
    return naTela && ultimo > 0 && Date.now() - ultimo <= LOGADA_99_MS;
  }

  async function sinalDeVida() {
    estado.logadoNoIfood = logadoNoIfood();
    estado.logadoNa99 = logadoNa99();
    const cred = cfg.credencial();
    if (SO_OBSERVAR || !cred) return atualizarBandeja();
    const r = await nuvem.estado(cred, {
      // a 99: "lendo" (a nuvem não põe este PC para responder pela 99) até a pessoa ligar "Responder pela 99 neste PC" (4b)
      plataformas: { ifood: { logado: estado.logadoNoIfood }, '99food': { logado: estado.logadoNa99 && cfg.responder99(), lendo: estado.logadoNa99 } },
      versao: app.getVersion(),
      maquina: os.hostname(),
      // pausada aqui: a nuvem passa a vez para a reserva e as telas dizem "pausada neste PC" (mig 368)
      pausada: !!estado.pausadaEm,
    });
    const c = nuvem.classificar(r);
    if (c === 'ok' && r.dados) {
      const antes = estado.ligada;
      estado.ligada = r.dados.ligada === true;
      estado.papel = (r.dados.canais && r.dados.canais.ifood) || 'fora';
      estado.papel99 = (r.dados.canais && r.dados.canais['99food']) || 'fora';
      if (antes && !estado.ligada) fila.esvaziar(); // desligada: nada de conversa de cliente guardada aqui
    }
    tratarClassificacao(c);
  }

  function abrirGestor() {
    if (gestor && !gestor.isDestroyed()) {
      gestor.show();
      gestor.focus();
      return gestor;
    }
    gestor = new BrowserWindow({
      width: 1280,
      height: 860,
      title: 'Regem · Ponte do chat',
      icon: ICONE,
      autoHideMenuBar: true,
      // backgroundThrottling: o envio da fila roda com a janela escondida ou atrás de outra (v0.4) — sem freio
      webPreferences: { partition: 'persist:ifood', contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const wc = gestor.webContents;
    // O título da janela mostra a situação da ponte (a página do Gestor não o troca).
    gestor.on('page-title-updated', (e) => e.preventDefault());
    // A pessoa usando o Gestor (v0.4): a tecla pela janela (o Electron só passa as de gente) e o vigia DENTRO da página.
    wc.on('before-input-event', () => {
      ultimaTeclaEm = Date.now();
    });
    wc.on('dom-ready', () => {
      wc.mainFrame.executeJavaScript(INSTALAR_VIGIA).catch(() => {});
    });
    // Link para fora do iFood abre no navegador do PC; dentro do iFood, na própria janela.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/([a-z0-9-]+\.)*ifood\.com\.br\//i.test(url)) return { action: 'allow' };
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (!/^https?:\/\//i.test(url) && !(process.env.REGEM_PONTE_GESTOR && url.startsWith('file:'))) e.preventDefault();
    });
    leitor = ligarLeitor(wc, {
      aoChegar: (m) => {
        // O aviso automático do iFood ("…pedidos nos últimos 30 dias", só a loja vê) chega pela CONTA da loja (visto em 05/11
        // no #8916): não é conversa — não vai à nuvem. A 1ª fala da equipe numa conversa nova também chega pela conta da
        // loja (06/11): essa vai, como fala da loja (`avisoDoIfood` separa as duas pelo texto).
        if (m.avisoDoIfood) {
          if (diagnostico) diagnostico.anotar({ ev: 'aviso_da_plataforma', msg: diagnostico.marca(m.id), canal: diagnostico.canal(m.canalDoChat) });
          return;
        }
        // o pedido vem do canal da conversa (`sendbird_gc_cm_<id do pedido>_<loja>`); a nuvem liga pelo external_id
        const pedido = m.pedidoExterno ? { externo: m.pedidoExterno } : undefined;
        // pausada neste PC: não leva nada ao Regem (a reserva, se houver, lê o mesmo chat)
        fila.por({ canal: 'ifood', id: m.id, autor: m.autor, texto: m.texto, cliente: m.cliente, pedido }, estado.ligada && !estado.pausadaEm && !SO_OBSERVAR);
      },
      aoMudarChat: () => {
        estado.logadoNoIfood = logadoNoIfood();
        atualizarBandeja();
      },
      diagnostico,
      registrarErro,
    });
    gestor.on('close', (e) => {
      // Fechar a janela não para a ponte: ela segue no ícone perto do relógio ("Sair da ponte" encerra).
      if (!saindo) {
        e.preventDefault();
        gestor.hide();
      }
    });
    // Só abre o Gestor depois de a escuta da rede estar ligada (ERR-376: conexão do chat aberta antes dela passava sem
    // ser lida). A escuta só termina de ligar com uma página carregada: primeiro uma página em branco, depois o Gestor.
    const janela = gestor;
    (async () => {
      try {
        await janela.loadURL('about:blank');
        await Promise.race([leitor && leitor.pronto, new Promise((r) => setTimeout(r, 3000))]);
        if (!janela.isDestroyed()) await janela.loadURL(GESTOR);
      } catch (e) {
        registrarErro(`não abriu o Gestor: ${e && e.message}`);
      }
    })();
    atualizarBandeja();
    return gestor;
  }

  /**
   * A janela da 99 (4a): o portal com a CONTA PRINCIPAL da loja (0.7.3), numa sessão própria (`persist:99`). Na 1ª vez pergunta e
   * avisa do login (ERR-365); depois fica guardado ("Parar de ler a 99 neste PC" desfaz) e reabre ao reiniciar. A escuta
   * liga ANTES de a página carregar (como no Gestor — ERR-376).
   */
  async function abrir99({ perguntar = true } = {}) {
    if (SO_OBSERVAR) return { ok: false, mensagem: 'No modo só observar a 99 não abre.' };
    if (janela99 && !janela99.isDestroyed()) {
      janela99.show();
      janela99.focus();
      return { ok: true };
    }
    if (!cfg.usar99()) {
      if (perguntar && process.env.REGEM_PONTE_ABRIR_99 !== '1') {
        const r = await dialog.showMessageBox({
          type: 'warning',
          title: 'Ler a 99 neste PC · Regem · Ponte do chat',
          message: 'Entre na 99 com a CONTA PRINCIPAL da loja',
          detail:
            'É com ela que o cliente conversa: o usuário extra da 99 tem conversas próprias e não recebe o chat dos clientes.\n\n' +
            'A 99 aceita um login por conta: entrar aqui derruba a 99 aberta com a mesma conta em outro aparelho (o PC da loja, ' +
            'um tablet), e entrar lá derruba esta. Combine com a loja: a 99 fica aberta só aqui.\n\nAs mensagens dos clientes ' +
            'entram no Atendimento do Regem; com "Responder pela 99 neste PC" ligado, a resposta sai por aqui.',
          buttons: ['Abrir a 99', 'Cancelar'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (r.response !== 0) return { ok: false, mensagem: 'A 99 não foi aberta.' };
      }
      cfg.marcarUsar99(true);
      if (process.env.REGEM_PONTE_RESPONDER_99 === '1') cfg.marcarResponder99(true); // a prova (sem o diálogo)
    }
    janela99 = new BrowserWindow({
      width: 1280,
      height: 860,
      title: 'Regem · Ponte do chat — 99',
      icon: ICONE,
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:99', contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const janela = janela99;
    const wc = janela.webContents;
    janela.on('page-title-updated', (e) => e.preventDefault());
    // O login da 99 passa pelos endereços da DiDi; o resto abre no navegador do PC.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/([a-z0-9-]+\.)*(99app\.com|didiglobal\.com)\//i.test(url)) return { action: 'allow' };
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (!/^https?:\/\//i.test(url)) e.preventDefault();
    });
    // a pessoa usando a 99 (4b): a tecla pela janela e o vigia DENTRO da página (o mesmo do Gestor)
    wc.on('before-input-event', () => {
      ultimaTecla99Em = Date.now();
    });
    wc.on('dom-ready', () => {
      wc.mainFrame.executeJavaScript(INSTALAR_VIGIA).catch(() => {});
    });
    leitor99 = ligarLeitor99(wc, {
      // já no formato da nuvem; pausada neste PC ou desligada: não leva nada ao Regem
      aoChegar: (m) => fila.por(m, estado.ligada && !estado.pausadaEm && !SO_OBSERVAR),
      aoMudar: () => {
        estado.logadoNa99 = logadoNa99();
        atualizarBandeja();
      },
      registrarErro,
      anotar: (o) => {
        if (diagnostico) diagnostico.anotar(o);
      },
    });
    janela.on('close', (e) => {
      // fechar a janela não para a leitura (segue no ícone perto do relógio); "Parar de ler a 99" fecha de vez
      if (!saindo) {
        e.preventDefault();
        janela.hide();
      }
    });
    janela.on('closed', () => {
      if (janela99 === janela) {
        janela99 = null;
        leitor99 = null;
        estado.logadoNa99 = false;
        atualizarBandeja();
      }
    });
    (async () => {
      try {
        await janela.loadURL('about:blank');
        await Promise.race([leitor99 && leitor99.pronto, new Promise((r) => setTimeout(r, 3000))]);
        if (!janela.isDestroyed()) await janela.loadURL(NOVENTA);
      } catch (e) {
        registrarErro(`não abriu a 99: ${e && e.message}`);
      }
    })();
    atualizarBandeja();
    return { ok: true };
  }

  /** "Parar de ler a 99 neste PC": fecha a janela da 99 e esquece a escolha (o login fica guardado na sessão dela). */
  function parar99() {
    cfg.marcarUsar99(false); // também desliga o "Responder pela 99"
    const j = janela99;
    janela99 = null;
    leitor99 = null;
    estado.logadoNa99 = false;
    if (j && !j.isDestroyed()) j.destroy();
    registrarErro('a 99 não é mais lida neste PC');
    sinalDeVida().catch((e) => registrarErro(String(e && e.message)));
    return { ok: true, mensagem: 'A 99 não é mais lida neste PC.' };
  }

  /**
   * "Responder pela 99 neste PC" (4b): ligado, o sinal diz "logado" na 99 e a nuvem põe este PC para enviar pela 99 os
   * avisos, o robô e a equipe (como no iFood). Nasce desligado; ligar pergunta antes (a prova liga pela variável).
   */
  async function responder99(sim) {
    if (SO_OBSERVAR || !cfg.credencial()) return { ok: false, mensagem: 'Pareie este PC antes.' };
    if (sim && !cfg.usar99()) return { ok: false, mensagem: 'Abra a 99 neste PC antes (Abrir a 99).' };
    if (sim && !cfg.responder99() && process.env.REGEM_PONTE_RESPONDER_99 !== '1') {
      const r = await dialog.showMessageBox({
        type: 'question',
        title: 'Responder pela 99 · Regem · Ponte do chat',
        message: 'Este PC vai ENVIAR pela 99',
        detail:
          'Com isto ligado, o que o Regem manda no chat da 99 sai por este PC: os avisos (saiu para entrega, entregador ' +
          'chegando), o robô (se estiver ligado) e as respostas da equipe pelo Atendimento — como já acontece no iFood. ' +
          'O programa só mexe na janela da 99 com ela parada, confere o número do pedido duas vezes e nunca aperta outro botão.',
        buttons: ['Ligar', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (r.response !== 0) return { ok: false, mensagem: 'Nada mudou.' };
    }
    const ligado = cfg.marcarResponder99(sim);
    registrarErro(ligado ? 'este PC passou a responder pela 99' : 'este PC deixou de responder pela 99 (só lê)');
    sinalDeVida().catch((e) => registrarErro(String(e && e.message)));
    atualizarBandeja();
    return { ok: true, mensagem: ligado ? 'Este PC responde pela 99.' : 'Este PC só lê a 99.' };
  }

  // ---------- o envio pela 99 (4b) ----------

  async function estadoDaTela99() {
    if (!janela99 || janela99.isDestroyed()) return null;
    try {
      await janela99.webContents.mainFrame.executeJavaScript(INSTALAR_VIGIA);
      return await janela99.webContents.mainFrame.executeJavaScript(envio99.ROTEIROS.ESTADO_DA_TELA);
    } catch {
      return null;
    }
  }

  async function telaLivre99() {
    if (!janela99 || janela99.isDestroyed() || !leitor99) return { ok: false, motivo: 'a 99 não está aberta no programa' };
    if (ocupadoNa99) return { ok: false, motivo: 'um envio está em andamento' };
    return envio99.avaliarTela(await estadoDaTela99(), { ultimaTeclaEm: ultimaTecla99Em, paradaMs: PARADA_MS });
  }

  async function pessoaMexeuDesde99(desde) {
    return mexeuDesde(await estadoDaTela99(), desde, ultimaTecla99Em);
  }

  /** Envia um item da fila pela 99 sem trazer a janela para a frente; devolve a tela como estava (conversa, busca, aba). */
  async function enviarItem99(item, opcoes) {
    if (ocupadoNa99) return { ok: false, adiar: true, codigo: 'ocupado', etapas: ['✗ já há um envio em andamento na 99'] };
    if (!janela99 || janela99.isDestroyed() || !leitor99) return { ok: false, adiar: true, codigo: 'sem_99', etapas: ['✗ a 99 não está aberta no programa'] };
    const wc = janela99.webContents;
    const ctx = { pagina: wc.mainFrame, cdp: (m, p) => wc.debugger.sendCommand(m, p), leitor: leitor99 };
    ocupadoNa99 = true;
    const antes = await estadoDaTela99();
    try {
      return await envio99.enviar(ctx, { numero: item.pedidoNumero, pedidoExterno: item.pedidoExterno, texto: item.texto }, { ecoMs: ECO_MS, ...opcoes });
    } catch (e) {
      registrarErro(`envio pela 99: ${e && e.message}`);
      return { ok: false, codigo: 'erro', etapas: [`✗ falhou: ${e && e.message}`] };
    } finally {
      const v = await envio99.voltar(ctx, antes).catch(() => null);
      if (diagnostico) diagnostico.anotar({ ev: 'saida99_voltou', ...(v || { falhou: true }) });
      ocupadoNa99 = false;
    }
  }

  function abrirTesteDeEnvio() {
    if (testeEnvio && !testeEnvio.isDestroyed()) {
      testeEnvio.show();
      testeEnvio.focus();
      return;
    }
    testeEnvio = new BrowserWindow({
      width: 620,
      height: 760,
      title: 'Teste de envio · Regem · Ponte do chat',
      icon: ICONE,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'teste-envio-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    testeEnvio.loadFile(path.join(__dirname, 'teste-envio.html'));
    testeEnvio.on('closed', () => {
      testeEnvio = null;
    });
  }

  /** O que o ensaio e o envio usam: a página do Gestor, o leitor e o "digitar" (como o teclado faria). */
  function contextoDoGestor() {
    if (!gestor || gestor.isDestroyed() || !leitor) return null;
    const wc = gestor.webContents;
    return {
      pagina: wc.mainFrame,
      leitor,
      digitar: async (t) => {
        wc.focus();
        await wc.insertText(t);
      },
    };
  }

  /** Roda um ensaio/envio com o Gestor à vista e um de cada vez. */
  async function noGestor(acao) {
    if (ocupadoNoGestor) return { ok: false, etapas: ['✗ já há um ensaio ou envio em andamento — espere terminar'] };
    abrirGestor();
    const ctx = contextoDoGestor();
    if (!ctx) return { ok: false, etapas: ['✗ o Gestor do iFood não está aberto no programa'] };
    ocupadoNoGestor = true;
    try {
      gestor.show();
      gestor.focus();
      return await acao(ctx);
    } catch (e) {
      registrarErro(`ensaio/envio: ${e && e.message}`);
      return { ok: false, etapas: [`✗ falhou: ${e && e.message}`] };
    } finally {
      ocupadoNoGestor = false;
    }
  }

  // ---------- o envio automático pela fila da nuvem (v0.4) ----------

  async function estadoDaTela() {
    if (!gestor || gestor.isDestroyed()) return null;
    try {
      await gestor.webContents.mainFrame.executeJavaScript(INSTALAR_VIGIA);
      return await gestor.webContents.mainFrame.executeJavaScript(ESTADO_DA_TELA);
    } catch {
      return null;
    }
  }

  /** A tela do Gestor está livre para o programa? (no quadro, ninguém mexendo há PARADA_MS, nenhum rascunho no campo) */
  async function telaLivre() {
    if (!gestor || gestor.isDestroyed() || !leitor) return { ok: false, motivo: 'o Gestor não está aberto no programa' };
    if (ocupadoNoGestor) return { ok: false, motivo: 'um ensaio ou envio está em andamento' };
    return avaliarTela(await estadoDaTela(), { ultimaTeclaEm, paradaMs: PARADA_MS });
  }

  async function pessoaMexeuDesde(desde) {
    return mexeuDesde(await estadoDaTela(), desde, ultimaTeclaEm);
  }

  /** Como o `noGestor`, mas SEM trazer a janela para a frente nem tomar o foco (quem usa outro programa no PC segue usando). */
  async function noGestorSemFoco(acao) {
    if (ocupadoNoGestor) return { ok: false, adiar: true, codigo: 'ocupado', etapas: ['✗ já há um ensaio ou envio em andamento'] };
    if (!gestor || gestor.isDestroyed() || !leitor) return { ok: false, adiar: true, codigo: 'sem_gestor', etapas: ['✗ o Gestor do iFood não está aberto no programa'] };
    const pagina = gestor.webContents.mainFrame;
    // o texto entra pelo "setter" (sem o teclado): não depende do foco da janela
    const ctx = { pagina, leitor, digitar: (t) => pagina.executeJavaScript(envio.ROTEIROS.ESCREVER_NO_CAMPO(t)) };
    ocupadoNoGestor = true;
    try {
      return await acao(ctx);
    } catch (e) {
      registrarErro(`envio da fila: ${e && e.message}`);
      return { ok: false, codigo: 'erro', etapas: [`✗ falhou: ${e && e.message}`] };
    } finally {
      ocupadoNoGestor = false;
    }
  }

  function enviarItem(item, opcoes) {
    return noGestorSemFoco(async (ctx) => {
      const r = await envio.enviar(ctx, { numero: item.pedidoNumero, pedidoExterno: item.pedidoExterno, texto: item.texto }, { ecoMs: ECO_MS, ...opcoes });
      const volta = await envio.voltarAoQuadro(ctx.pagina, item.pedidoNumero);
      if (diagnostico) diagnostico.anotar({ ev: 'saida_voltou', conversa: !!(volta.conversa && volta.conversa.ok), resumo: !!(volta.resumo && volta.resumo.ok) });
      return r;
    });
  }

  /** Espera o histórico da conversa do pedido chegar (o Gestor pede ao abrir) — no máximo `ms`. */
  async function esperarHistorico(pedidoExterno, desde, ms = 2500) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (leitor && pedidoExterno && leitor.historicoEm(pedidoExterno) >= desde) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /** Abre a conversa só para o Gestor carregar o histórico (a conferência do "apertei e não sei se saiu") e volta. */
  function abrirSemEnviar(item) {
    return noGestorSemFoco(async (ctx) => {
      const desde = Date.now();
      const a = await envio.abrirConversa(ctx.pagina, ctx.leitor, { numero: item.pedidoNumero, pedidoExterno: item.pedidoExterno });
      await esperarHistorico(item.pedidoExterno, desde);
      await envio.voltarAoQuadro(ctx.pagina, item.pedidoNumero);
      return a;
    });
  }

  ipcMain.handle('ponte:ensaiar', async (_e, { numero, texto }) => {
    const motivo = motivoParaNaoEnviar(texto);
    if (motivo) return { ok: false, etapas: [`✗ ${motivo}`] };
    const r = await noGestor((ctx) => envio.ensaiar(ctx, { numero, texto }, { segurarMs: Number(process.env.REGEM_PONTE_SEGURAR_MS) || 5000 }));
    ultimoEnsaio = r.ok ? { numero: String(numero), em: Date.now() } : null;
    // o que a tela tinha quando o ensaio parou (só rótulos e estrutura) — para ajustar o caminho sem chute
    if (!r.ok && diagnostico) diagnostico.anotar({ ev: 'ensaio_parou', etapa: (r.etapas || []).at(-1), detalhes: r.detalhes || null });
    return r;
  });

  ipcMain.handle('ponte:enviar', async (_e, { numero, texto }) => {
    // O programa confere de novo (a tela só pede): ensaio certo do MESMO pedido há menos de 10 min; texto de verdade.
    if (!ultimoEnsaio || ultimoEnsaio.numero !== String(numero) || Date.now() - ultimoEnsaio.em > 10 * 60 * 1000)
      return { ok: false, etapas: ['✗ faça um ensaio certo deste pedido antes (vale por 10 minutos)'] };
    if (/teste do regem|não será enviada/i.test(String(texto))) return { ok: false, etapas: ['✗ o texto de teste não vai para cliente — troque o texto'] };
    const motivo = motivoParaNaoEnviar(texto);
    if (motivo) return { ok: false, etapas: [`✗ ${motivo}`] };
    ultimoEnsaio = null; // um envio por ensaio
    const r = await noGestor((ctx) => envio.enviar(ctx, { numero, texto }));
    registrarErro(r.ok ? `envio de teste no pedido #${numero}: enviado` : `envio de teste no pedido #${numero}: não confirmado`);
    return r;
  });

  function abrirPareamento(aviso) {
    if (aviso) registrarErro(aviso);
    if (pareamento && !pareamento.isDestroyed()) {
      pareamento.show();
      pareamento.focus();
      return;
    }
    pareamento = new BrowserWindow({
      width: 520,
      height: 560,
      resizable: false,
      title: 'Parear este PC · Regem · Ponte do chat',
      icon: ICONE,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'pareamento-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    pareamento.loadFile(path.join(__dirname, 'pareamento.html'));
    pareamento.on('closed', () => {
      pareamento = null;
    });
  }

  /** A "digital" deste PC (o servidor guarda para o anti-clone): nome da máquina + a 1ª placa de rede, embaralhados. */
  function digital() {
    const placas = Object.values(os.networkInterfaces())
      .flat()
      .filter((x) => x && !x.internal && x.mac && x.mac !== '00:00:00:00:00:00')
      .map((x) => x.mac)
      .sort();
    return crypto.createHash('sha256').update(`${os.hostname()}|${placas[0] || ''}`).digest('hex');
  }

  ipcMain.handle('ponte:parear', async (_e, codigo) => {
    const c = String(codigo || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(c)) return { ok: false, mensagem: 'Digite os 6 números do código.' };
    const r = await nuvem.parear(c, digital());
    if (!r.ok) return { ok: false, mensagem: r.mensagem || 'Não deu para parear agora. Tente de novo.' };
    try {
      cfg.guardarPareamento(r.dados);
    } catch (e) {
      return { ok: false, mensagem: e.message };
    }
    estado.nuvem = 'aguardando';
    setTimeout(() => {
      if (pareamento && !pareamento.isDestroyed()) pareamento.close();
      abrirGestor();
      // a 99 já era lida neste PC (pareado de novo depois de revogar) — ou a prova pede: reabre sem perguntar
      if (cfg.usar99() || process.env.REGEM_PONTE_ABRIR_99 === '1') abrir99({ perguntar: false }).catch((e) => registrarErro(String(e && e.message)));
      sinalDeVida();
    }, 1200);
    return { ok: true, nome: r.dados && r.dados.nome };
  });

  /**
   * Pausa ou retoma a ponte NESTE PC (peça 6, "Pausar a ponte do chat"): pausada, não leva nada ao Regem (a fila de
   * entrada é esvaziada) e não pega a vez na fila de saída; o sinal vai na hora para a nuvem passar a vez à reserva.
   */
  function pausar(sim) {
    if (SO_OBSERVAR || !cfg.credencial()) return { ok: false, mensagem: 'Pareie este PC antes de pausar a ponte.' };
    estado.pausadaEm = cfg.pausar(sim);
    if (sim) fila.esvaziar();
    registrarErro(sim ? 'ponte pausada neste PC' : 'ponte retomada neste PC');
    sinalDeVida().catch((e) => registrarErro(String(e && e.message)));
    return { ok: true, mensagem: sim ? 'Ponte pausada neste PC.' : 'Ponte retomada neste PC.' };
  }

  /** A janela "Estado da ponte" (o clique no ícone, "Ver o estado da ponte" e o "Abrir a ponte" do ícone do Regem). */
  function abrirEstado() {
    if (janelaDoEstado && !janelaDoEstado.isDestroyed()) {
      janelaDoEstado.show();
      janelaDoEstado.focus();
      return janelaDoEstado;
    }
    janelaDoEstado = new BrowserWindow({
      width: 600,
      height: 640,
      minWidth: 360,
      title: 'Estado da ponte · Regem · Ponte do chat',
      icon: ICONE,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'estado-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    janelaDoEstado.loadFile(path.join(__dirname, 'estado.html'));
    janelaDoEstado.on('closed', () => {
      janelaDoEstado = null;
    });
    return janelaDoEstado;
  }

  /** Um comando de fora (linha de comando, o ícone do Regem) ou um botão da janela do estado. */
  async function executar(comando) {
    if (comando === 'pausar') return pausar(true);
    if (comando === 'retomar') return pausar(false);
    if (comando === 'abrir-ifood') {
      abrirGestor();
      return { ok: true };
    }
    if (comando === 'abrir-99') return abrir99();
    if (comando === 'parar-99') return parar99();
    if (comando === 'responder-99') return responder99(true);
    if (comando === 'so-ler-99') return responder99(false);
    if (comando === 'parear') {
      abrirPareamento();
      return { ok: true };
    }
    if (comando === 'atendimento') {
      shell.openExternal(local.enderecoDoAtendimento()).catch(() => {});
      return { ok: true, mensagem: 'Abrindo o Atendimento no navegador…' };
    }
    abrirEstado();
    return { ok: true };
  }

  ipcMain.handle('ponte:estado', () => local.paraAJanela(resumoDeAgora()));
  ipcMain.handle('ponte:acao', async (_e, acao) => {
    const permitidas = ['pausar', 'retomar', 'abrir-ifood', 'abrir-99', 'parar-99', 'responder-99', 'so-ler-99', 'parear', 'atendimento'];
    if (!permitidas.includes(String(acao))) return { ok: false, mensagem: 'Ação desconhecida.' };
    const r = await executar(String(acao));
    atualizarBandeja();
    return { ...r, estado: local.paraAJanela(resumoDeAgora()) };
  });

  function sair() {
    saindo = true;
    app.quit();
  }

  // Abriram o programa de novo (o atalho, o ícone do Regem com --pausar/--retomar/--abrir): o que já está aberto atende.
  app.on('second-instance', (_e, argv) => {
    executar(local.comandoDe(argv) || 'estado')
      .catch((e) => registrarErro(String(e && e.message)))
      .finally(() => atualizarBandeja());
  });
  app.on('window-all-closed', () => {
    /* segue no ícone perto do relógio */
  });
  app.on('before-quit', () => {
    saindo = true;
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    diagnostico = new Diagnostico(path.join(app.getPath('userData'), 'diagnostico.jsonl'), cfg.sal());
    jornal = new Jornal(path.join(app.getPath('userData'), 'envios.jsonl'));
    saida = new Saida({
      podeTrabalhar: () => {
        if (SO_OBSERVAR) return { ok: false, motivo: 'só observando (sem nuvem)' };
        if (!cfg.credencial()) return { ok: false, motivo: 'falta parear este PC' };
        if (!estado.ligada) return { ok: false, motivo: 'ponte desligada nos ajustes' };
        if (estado.pausadaEm) return { ok: false, motivo: 'ponte pausada neste PC' };
        if (estado.papel !== 'responde') return { ok: false, motivo: `este PC não responde pelo iFood (${estado.papel})` };
        if (!logadoNoIfood()) return { ok: false, motivo: 'sem login no iFood' };
        return { ok: true };
      },
      telaLivre,
      pessoaMexeuDesde,
      enviarItem,
      abrirSemEnviar,
      esperarHistorico: (p, desde) => esperarHistorico(p, desde),
      jaEnviada: (q) => (leitor ? leitor.jaEnviada(q) : null),
      jornal,
      nuvem,
      credencial: () => cfg.credencial(),
      tratarClassificacao: (c) => {
        if (c === 'revogado' || c === 'nao_reconhecido') tratarClassificacao(c);
      },
      anotar: (ev) => diagnostico.anotar(ev),
      marca: (v) => diagnostico.marca(v),
      esperaTelaMs: ESPERA_TELA_MS,
    });
    // a fila de saída da 99 (4b): o mesmo trabalhador, pelo canal 99food — só com "Responder pela 99 neste PC" ligado
    saida99 = new Saida({
      canal: '99food',
      podeTrabalhar: () => {
        if (SO_OBSERVAR) return { ok: false, motivo: 'só observando (sem nuvem)' };
        if (!cfg.credencial()) return { ok: false, motivo: 'falta parear este PC' };
        if (!cfg.responder99()) return { ok: false, motivo: 'este PC só lê a 99' };
        if (!estado.ligada) return { ok: false, motivo: 'ponte desligada nos ajustes' };
        if (estado.pausadaEm) return { ok: false, motivo: 'ponte pausada neste PC' };
        if (estado.papel99 !== 'responde') return { ok: false, motivo: `este PC não responde pela 99 (${estado.papel99})` };
        if (!logadoNa99()) return { ok: false, motivo: 'sem login na 99' };
        return { ok: true };
      },
      telaLivre: telaLivre99,
      pessoaMexeuDesde: pessoaMexeuDesde99,
      enviarItem: enviarItem99,
      // sem histórico para reler na 99: a confirmação do envio e o eco do polling ficam na memória do leitor
      abrirSemEnviar: async () => null,
      jaEnviada: (q) => (leitor99 ? leitor99.jaEnviada(q) : null),
      jornal,
      nuvem,
      credencial: () => cfg.credencial(),
      tratarClassificacao: (c) => {
        if (c === 'revogado' || c === 'nao_reconhecido') tratarClassificacao(c);
      },
      anotar: (ev) => diagnostico.anotar({ ...ev, canal: '99food' }),
      marca: (v) => diagnostico.marca(v),
      esperaTelaMs: ESPERA_TELA_MS,
    });
    // a prova liga o "Responder pela 99" pela variável (o diálogo do Windows não se pilota)
    if (process.env.REGEM_PONTE_RESPONDER_99 === '1' && cfg.usar99()) cfg.marcarResponder99(true);
    try {
      bandeja = new Tray(ICONE);
      bandeja.on('click', () => abrirEstado());
    } catch {
      bandeja = null; // sem ícone (teste): a janela mostra a situação no título
    }
    if (!SO_OBSERVAR && !cfg.credencial()) abrirPareamento();
    else if (process.env.REGEM_PONTE_ABRIR_TESTE === '1') {
      abrirGestor();
      abrirTesteDeEnvio(); // a prova de ponta a ponta abre a janela direto (o ícone perto do relógio não se pilota)
    }
    else abrirGestor();
    // a 99 lida neste PC (4a — escolhida antes, ou a prova pede): reabre a janela dela, sem perguntar de novo
    if (!SO_OBSERVAR && cfg.credencial() && (cfg.usar99() || process.env.REGEM_PONTE_ABRIR_99 === '1'))
      abrir99({ perguntar: false }).catch((e) => registrarErro(String(e && e.message)));
    // aberto já com um comando (o ícone do Regem chamou com --pausar/--retomar/--abrir e a ponte estava fechada)
    const primeiro = local.comandoDe(process.argv);
    if (primeiro) executar(primeiro).catch((e) => registrarErro(String(e && e.message)));
    atualizarBandeja();
    setInterval(() => sinalDeVida().catch((e) => registrarErro(String(e && e.message))), SINAL_MS);
    setInterval(() => {
      fila.descarregar(estado.ligada && !estado.pausadaEm && !SO_OBSERVAR).catch((e) => registrarErro(String(e && e.message)));
    }, FILA_MS);
    // a fila de SAÍDA (v0.4): uma volta por vez; a bandeja mostra a situação
    let ultimaSituacao = '';
    setInterval(() => {
      saida
        .volta()
        .then(() => {
          if (saida.situacao !== ultimaSituacao) {
            ultimaSituacao = saida.situacao;
            atualizarBandeja();
          }
        })
        .catch((e) => registrarErro(`fila de saída: ${e && e.message}`));
    }, SAIDA_MS);
    let ultimaSituacao99 = '';
    setInterval(() => {
      saida99
        .volta()
        .then(() => {
          if (saida99.situacao !== ultimaSituacao99) {
            ultimaSituacao99 = saida99.situacao;
            atualizarBandeja();
          }
        })
        .catch((e) => registrarErro(`fila de saída da 99: ${e && e.message}`));
    }, SAIDA_MS);
    setTimeout(() => sinalDeVida().catch(() => {}), 3000);
    // Diagnóstico da TELA do chat (só a estrutura, sem texto): com uma conversa aberta no Gestor, anota onde ficam o campo
    // de digitar e o botão de enviar — uma vez por forma diferente. É o que o envio (o ensaio) precisa para não chutar.
    let ultimaForma = '';
    let ultimoQuadro = '';
    setInterval(async () => {
      if (!diagnostico || !gestor || gestor.isDestroyed()) return;
      const q = await lerOQuadro(gestor.webContents).catch(() => null);
      if (q) {
        const fq = JSON.stringify({ c: q.cartoes.map((c) => [c.caminho.replace(/\d/g, '0'), c.clicavel && c.clicavel.caminho]), b: q.botoesDeChat.map((b) => [b.rotulo, b.titulo, b.testid]), k: q.ultimoClique && q.ultimoClique.em });
        if (fq !== ultimoQuadro) {
          ultimoQuadro = fq;
          diagnostico.anotar({ ev: 'quadro', ...q });
        }
      }
      const r = await lerATelaDoChat(gestor.webContents).catch(() => null);
      if (!r) return;
      const forma = JSON.stringify({ c: r.campo, b: r.botoes.map((b) => [b.rotulo, b.titulo, b.testid, b.temIcone, b.perto]), t: r.topo.map((t) => t.forma.replace(/\d/g, '0')), n: (r.comNumero || []).map((x) => x.caminho) });
      if (forma === ultimaForma) return;
      ultimaForma = forma;
      diagnostico.anotar({ ev: 'tela_do_chat', ...r });
    }, 3000);
  });
}
