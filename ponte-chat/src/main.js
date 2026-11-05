'use strict';

// REGEM · PONTE DO CHAT — o programa do PC da loja (parte B da ponte do chat; plano e protótipos v3 aprovados pelo dono em
// 04/11/2026). Abre o Gestor de Pedidos do iFood DENTRO dele (a pessoa da loja entra com o login dela, uma vez; a senha
// nunca passa pelo Regem), lê o chat e conversa com a nuvem do Regem:
//  • pareia este PC por código (Configurações › Equipamentos › "Ponte do chat (iFood e 99, no PC)" › Gerar código);
//  • manda o sinal de vida a cada 30 s (logado ou não no iFood); a nuvem responde se a ponte está LIGADA nos ajustes;
//  • com a ponte ligada, manda as mensagens que chegam no chat (do cliente e da loja); desligada, não manda nada;
//  • anota o diagnóstico da ligação conversa × pedido (só marcas, nenhum texto — `diagnostico.js`).
// ESTA VERSÃO NÃO ENVIA mensagem ao cliente: o envio entra depois do teste com a loja fechada, com o "pode" do dono.
// A 99 fica fora por enquanto (aceita um login só — ERR-365: abrir aqui derrubaria a 99 da loja).

// Aberto do terminal do VS Code, o Electron herda ELECTRON_RUN_AS_NODE e roda como Node puro (ERR-363): reabre sem ela.
if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawn } = require('child_process');
  const path = require('path');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, [path.join(__dirname, '..'), ...process.argv.slice(2)], { env, detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
}

const { app, BrowserWindow, Menu, Tray, ipcMain, safeStorage, shell } = require('electron');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { Configuracao } = require('./configuracao');
const { Diagnostico } = require('./diagnostico');
const { FilaDeEntrada } = require('./fila-entrada');
const { ligarLeitor } = require('./leitor');
const { lerATelaDoChat, lerOQuadro } = require('./tela-do-chat');
const envio = require('./envio-ifood');
const { motivoParaNaoEnviar } = require('./regras');
const nuvem = require('./nuvem');

const GESTOR = process.env.REGEM_PONTE_GESTOR || 'https://gestordepedidos.ifood.com.br/';
const SO_OBSERVAR = process.argv.includes('--so-observar') || process.env.REGEM_PONTE_SO_OBSERVAR === '1';
// os intervalos: 30 s o sinal de vida, 3 s a fila (o teste de ponta a ponta encurta pelas variáveis)
const SINAL_MS = Number(process.env.REGEM_PONTE_SINAL_MS) || 30000;
const FILA_MS = Number(process.env.REGEM_PONTE_FILA_MS) || 3000;
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
    enviadas: 0,
    ultimoErro: null,
  };
  let gestor = null;
  let pareamento = null;
  let testeEnvio = null;
  let bandeja = null;
  let leitor = null;
  let saindo = false;
  let diagnostico = null;
  let ocupadoNoGestor = false; // um ensaio/envio por vez (os dois mexem na tela do Gestor)
  let ultimoEnsaio = null; // { numero, em } — o envio de verdade só depois de um ensaio certo do MESMO pedido

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
    const ifood = estado.logadoNoIfood ? 'iFood: logado' : 'iFood: entre com o login da loja';
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

  function atualizarBandeja() {
    const sit = textoDaSituacao();
    if (gestor && !gestor.isDestroyed()) gestor.setTitle(`Regem · Ponte do chat — ${sit}`);
    if (!bandeja) return;
    bandeja.setToolTip(`Regem · Ponte do chat\n${sit}`.slice(0, 127));
    bandeja.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Regem · Ponte do chat', enabled: false },
        { label: sit, enabled: false },
        ...(estado.ultimoErro ? [{ label: `Último aviso: ${estado.ultimoErro}`.slice(0, 120), enabled: false }] : []),
        { type: 'separator' },
        { label: 'Abrir o Gestor do iFood', click: () => abrirGestor() },
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

  async function sinalDeVida() {
    estado.logadoNoIfood = logadoNoIfood();
    const cred = cfg.credencial();
    if (SO_OBSERVAR || !cred) return atualizarBandeja();
    const r = await nuvem.estado(cred, {
      plataformas: { ifood: { logado: estado.logadoNoIfood } },
      versao: app.getVersion(),
      maquina: os.hostname(),
    });
    const c = nuvem.classificar(r);
    if (c === 'ok' && r.dados) {
      const antes = estado.ligada;
      estado.ligada = r.dados.ligada === true;
      estado.papel = (r.dados.canais && r.dados.canais.ifood) || 'fora';
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
      webPreferences: { partition: 'persist:ifood', contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    const wc = gestor.webContents;
    // O título da janela mostra a situação da ponte (a página do Gestor não o troca).
    gestor.on('page-title-updated', (e) => e.preventDefault());
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
        // o pedido vem do canal da conversa (`sendbird_gc_cm_<id do pedido>_<loja>`); a nuvem liga pelo external_id
        const pedido = m.pedidoExterno ? { externo: m.pedidoExterno } : undefined;
        fila.por({ canal: 'ifood', id: m.id, autor: m.autor, texto: m.texto, cliente: m.cliente, pedido }, estado.ligada && !SO_OBSERVAR);
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
      sinalDeVida();
    }, 1200);
    return { ok: true, nome: r.dados && r.dados.nome };
  });

  function sair() {
    saindo = true;
    app.quit();
  }

  app.on('second-instance', () => abrirGestor());
  app.on('window-all-closed', () => {
    /* segue no ícone perto do relógio */
  });
  app.on('before-quit', () => {
    saindo = true;
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    diagnostico = new Diagnostico(path.join(app.getPath('userData'), 'diagnostico.jsonl'), cfg.sal());
    try {
      bandeja = new Tray(ICONE);
      bandeja.on('click', () => abrirGestor());
    } catch {
      bandeja = null; // sem ícone (teste): a janela mostra a situação no título
    }
    if (!SO_OBSERVAR && !cfg.credencial()) abrirPareamento();
    else if (process.env.REGEM_PONTE_ABRIR_TESTE === '1') {
      abrirGestor();
      abrirTesteDeEnvio(); // a prova de ponta a ponta abre a janela direto (o ícone perto do relógio não se pilota)
    }
    else abrirGestor();
    atualizarBandeja();
    setInterval(() => sinalDeVida().catch((e) => registrarErro(String(e && e.message))), SINAL_MS);
    setInterval(() => {
      fila.descarregar(estado.ligada && !SO_OBSERVAR).catch((e) => registrarErro(String(e && e.message)));
    }, FILA_MS);
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
