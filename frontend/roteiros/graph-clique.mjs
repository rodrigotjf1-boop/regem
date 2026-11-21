// Roteiro de tela do DMS GRAPH PELO CLIQUE (G5b; mig 450; protótipo `mockups/regem-graph-clique.html`, aprovado pelo dono
// em 18/11/2026). A API é simulada com as regras do servidor (`graph-clique.service.ts`): a situação da EMPRESA, ligar
// devolve a página do Graph, desligar, e a volta que troca o código. Confere: o cartão em Delivery › Configurações ›
// Integrações só com o Graph liberado; a janela antes de ligar (vale para a empresa inteira, a única permissão, só o
// presidente conecta) e ligada (quem ligou, a última leitura, a reserva, a franquia com os números, desligar com
// confirmação), a franquia acabou, desligada no Graph; a linha "Quem lê as fotos agora" em Atendimento; a página de volta
// (ligou → integrações; não ligou → a frase do servidor e "Voltar às integrações"); a empresa sem CNPJ (GR-8, 19/11: o
// presidente informa na janela, a recusa do servidor no bloco, o gerente sem o campo); e as 16 larguras com a janela aberta.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PERM = { loja: { ver: true, editar: true }, delivery: { ver: true, editar: true } };
const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: PERM });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', perm: PERM });
const PAGINA_DO_GRAPH = 'https://graph.exemplo.test/autorizar?client_id=app-regem&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Agph_teste';
const AGORA = Date.now();
const MES = new Date(AGORA).toISOString().slice(0, 7);

const PERMISSOES = [
  { id: 'arquivos.analisar', nome: 'Ler fotos, PDFs e vídeos', frase: 'Ler as fotos, os PDFs e os vídeos que os seus clientes e a sua equipe mandam, sem guardar o arquivo.', motivo: 'O atendente virtual e o Mister leem o que chega; o Graph não guarda o arquivo.', necessaria: true, pago: false },
  { id: 'audio.ouvir', nome: 'Ouvir áudios', frase: 'Ouvir os áudios.', motivo: 'O Mister entende o áudio que você manda.', necessaria: false, pago: false },
  { id: 'audio.falar', nome: 'Falar', frase: 'Transformar um texto em voz.', motivo: 'O Mister responde em áudio quando você pede.', necessaria: false, pago: false },
  { id: 'imagens.editar', nome: 'Editar fotos', frase: 'Editar as fotos.', motivo: 'Melhorar a foto dos produtos do cardápio.', necessaria: false, pago: true },
  { id: 'imagens.criar', nome: 'Criar imagens', frase: 'Criar imagens.', motivo: 'A arte de um banner a partir de uma descrição.', necessaria: false, pago: true },
];
const base = (o = {}) => ({
  ligado: true,
  empresaNome: 'Casa do Hambúrguer Ltda.',
  empresaTemCnpj: true,
  reservaIa: true,
  pronto: true,
  naNuvem: true,
  podeLigar: true,
  ligacao: null,
  desligadaPeloGraphEm: null,
  permissoes: PERMISSOES,
  legadoAte: '2099-03-01',
  ...o,
});
const ligacao = (o = {}) => ({
  contaNome: 'Casa do Hambúrguer Ltda.',
  desde: new Date(AGORA - 3 * 86400000).toISOString(),
  por: 'Ana Presidente',
  permissoes: ['arquivos.analisar'],
  ultimoUso: new Date(AGORA - 3 * 60000).toISOString(),
  ultimaLeitura: { em: new Date(AGORA - 3 * 60000).toISOString(), resultado: 'lida' },
  franquia: { mes: MES, usados: 87, total: 500, em: new Date(AGORA - 3 * 60000).toISOString(), doMesAtual: true },
  ...o,
});
const SITUACOES = {
  naoLigado: () => base(),
  ligado: () => base({ ligacao: ligacao() }),
  comTudo: () => base({ ligacao: ligacao({ permissoes: PERMISSOES.map((p) => p.id) }) }),
  soAudioNovo: () => base({ ligacao: ligacao({ permissoes: ['arquivos.analisar', 'audio.ouvir', 'audio.falar'] }) }),
  legadoVencido: () => base({ legadoAte: '2020-01-01', ligacao: ligacao() }),
  cheia: () => base({ ligacao: ligacao({ franquia: { mes: MES, usados: 500, total: 500, em: new Date(AGORA).toISOString(), doMesAtual: true }, ultimaLeitura: { em: new Date(AGORA).toISOString(), resultado: 'franquia-esgotada' } }) }),
  desligadoNoGraph: () => base({ desligadaPeloGraphEm: new Date(AGORA - 86400000).toISOString() }),
  semReserva: () => base({ reservaIa: false, ligacao: ligacao() }),
  foraDoPiloto: () => base({ ligado: false, empresaNome: null }),
  semCnpj: () => base({ empresaTemCnpj: false }),
};

/** Um CNPJ com os dígitos certos, montado na hora (nunca escrito no arquivo). */
function cnpjDeTeste() {
  const base12 = Array.from({ length: 12 }, () => String(Math.floor(Math.random() * 10))).join('');
  const dv = (b) => {
    let soma = 0;
    let peso = b.length - 7;
    for (const c of b) {
      soma += Number(c) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12);
  return `${base12}${d1}${dv(base12 + d1)}`;
}

const AJUSTES = {
  conectado99: false,
  ajuste99: null,
  fila: { avisarGerenteMin: 0, dizerPosicao: false },
  fotos: { ler: true, liberadaNaDistribuicao: true, limitePorDia: 5 },
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    for (const d of document.querySelectorAll('[role="dialog"] > div.relative, [role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1) achados.push(`painel fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    // texto esmagado: um bloco de texto com menos de 40 px de largura dentro da janela
    for (const t of document.querySelectorAll('[role="dialog"] :is(p, dd, b, li span, h3)')) {
      const r = t.getBoundingClientRect();
      if (t.textContent.trim().length > 12 && r.width > 0 && r.width < 40) achados.push(`texto esmagado "${t.textContent.trim().slice(0, 20)}" ${Math.round(r.width)} px`);
    }
    return achados;
  });

export default async function roteiroGraphClique({ nav, base: endereco, ok, foto, larguras }) {
  async function abrir(w, h, { token = PRESIDENTE, situacao = 'naoLigado', caminho = '/delivery/configuracoes?aba=integracoes', concluir = { ligada: true, contaNome: 'Casa do Hambúrguer Ltda.', permissoes: ['arquivos.analisar'] }, recusarCnpj = null } = {}) {
    const S = { situacao, pedidos: [], iniciar: 0, desligar: 0, concluir: [], leiturasSituacao: 0, cnpjs: [] };
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: false });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), token);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    // Só o HOST do Graph (a volta leva `iss=https://graph.exemplo.test` na consulta e não pode cair aqui).
    await page.route((u) => u.hostname === 'graph.exemplo.test', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>DMS Graph</title><h1>Página do DMS Graph (simulada)</h1>' }));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const corpo = req.postData() ? JSON.parse(req.postData()) : null;
      if (p === '/graph/clique/situacao') {
        S.leiturasSituacao++;
        // Como o servidor: só o presidente liga e desliga (GR-2, pela categoria de quem pede).
        return responder(route, { ...SITUACOES[S.situacao](), podeLigar: token === PRESIDENTE });
      }
      if (p === '/graph/clique/iniciar' && req.method() === 'POST') {
        S.iniciar++;
        S.pedidos.push(corpo);
        return responder(route, { url: PAGINA_DO_GRAPH });
      }
      if (p === '/graph/clique/desligar' && req.method() === 'POST') {
        S.desligar++;
        S.situacao = 'naoLigado';
        return responder(route, { desligada: true });
      }
      if (p === '/graph/clique/concluir' && req.method() === 'POST') {
        S.concluir.push(corpo);
        return responder(route, concluir);
      }
      // GR-8: como o servidor (`PATCH /empresas/cnpj`): recusa com a mensagem dele, ou grava e a situação passa a ter CNPJ.
      if (p === '/empresas/cnpj' && req.method() === 'PATCH') {
        S.cnpjs.push(corpo);
        if (recusarCnpj) return responder(route, { statusCode: 409, message: recusarCnpj }, 409);
        S.situacao = 'naoLigado';
        return responder(route, { cnpj: String(corpo?.cnpj ?? '') });
      }
      if (p === '/atendimento/ajustes') return responder(route, AJUSTES);
      if (/banners|cupons|regras-sinal|formas|impressoras|integrac|numeros|robo|eventos|fidelidade|cashback|bairros|areas-entrega/.test(p)) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(endereco + caminho);
    return { ctx, page, erros, S };
  }
  const cartao = (page) => page.locator('button[aria-label="Configurar DMS Graph"]');
  const janela = (page) => page.locator('[role="dialog"][aria-label="DMS Graph"]');
  async function abrirJanela(page) {
    await cartao(page).waitFor({ timeout: 20000 });
    await cartao(page).click();
    await janela(page).waitFor({ timeout: 5000 });
  }

  // ── não ligado, presidente: o cartão, a janela antes de ligar e o "Conectar" ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900);
    await cartao(page).waitFor({ timeout: 20000 }).catch(() => {});
    ok(await cartao(page).isVisible(), 'o cartão "DMS Graph" aparece na grade de Integrações');
    ok(/não ligado/.test(await cartao(page).innerText()), `o cartão diz "não ligado" (${umaLinha(await cartao(page).innerText(), 80)})`);
    ok(/Lê fotos, PDFs e áudios; edita e cria imagem/.test(await cartao(page).innerText()), 'o cartão diz o que o Graph faz');
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(/Vale para:\s*Casa do Hambúrguer Ltda\.\s*\(a empresa inteira, todas as lojas\)/.test(t), 'a janela diz que vale para a empresa inteira (G-3)');
    ok(/O que o Regem vai pedir ao DMS Graph/.test(t) && /Ler fotos, PDFs e vídeos/.test(t) && /Opcional: ouvir áudios/.test(t) && /Opcional: criar imagens/.test(t) && /cada uma começa desligada/.test(t), 'a leitura é necessária e o resto opcional, com a frase do catálogo');
    ok(/Ninguém copia chave/.test(t), 'a nota do caminho (DMS ID, conferir, autorizar)');
    await page.screenshot({ path: foto('graph-antes-de-ligar.png') });
    await page.click('[role="dialog"] button:has-text("Conectar ao DMS Graph")');
    await page.waitForURL(/graph\.exemplo\.test\/autorizar/, { timeout: 8000 }).catch(() => {});
    ok(S.iniciar === 1, 'Conectar chama POST /graph/clique/iniciar uma vez');
    ok(/graph\.exemplo\.test\/autorizar/.test(page.url()), `e leva à página do DMS Graph (${umaLinha(page.url(), 80)})`);
    ok(erros.length === 0, `sem erro na página (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── gerente: vê, não conecta ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: GERENTE });
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(/Só quem é presidente liga o DMS Graph/.test(t), 'o gerente vê "Só quem é presidente liga" (GR-2)');
    ok((await page.locator('[role="dialog"] button:has-text("Conectar ao DMS Graph")').count()) === 0, 'o gerente não tem o botão "Conectar"');
    ok(S.iniciar === 0, 'nada é pedido ao servidor pelo gerente');
    await ctx.close();
  }

  // ── ligado: a franquia, a reserva e desligar com confirmação ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { situacao: 'ligado' });
    await cartao(page).waitFor({ timeout: 20000 });
    ok(/ligado/.test(await cartao(page).innerText()) && !/não ligado/.test(await cartao(page).innerText()), 'o cartão diz "ligado"');
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(/Casa do Hambúrguer Ltda\. \(todas as lojas\)/.test(t), 'a empresa, todas as lojas');
    ok(/Ana Presidente em/.test(t), 'quem ligou e quando');
    ok(/há 3 minutos · lida pelo DMS Graph/.test(t), `a última leitura em palavras (${umaLinha(t.match(/Última leitura\s*\n?([^\n]*)/)?.[1] ?? '', 80)})`);
    ok(/IA da empresa \(a chave em Mister › IA e uso\)/.test(t), 'a reserva: a IA da empresa, com o caminho');
    ok(/87\s*de\s*500/.test(t), 'a franquia com os números escritos (87 de 500)');
    const barra = page.locator('[role="dialog"] [role="img"]');
    ok(/87 de 500 fotos lidas em/.test((await barra.getAttribute('aria-label')) ?? ''), 'a barra tem o rótulo com os números');
    ok((await page.locator('[role="dialog"] a[href="/mister?parte=ia"]').count()) === 1, 'o link da reserva abre Mister › IA e uso');
    await page.screenshot({ path: foto('graph-ligado.png') });
    await page.click('[role="dialog"] button:text-is("Desligar")');
    const conf = page.locator('[role="alertdialog"][aria-label="Desligar o DMS Graph"]');
    ok(await conf.isVisible(), 'Desligar pede confirmação na própria janela');
    ok(S.desligar === 0, 'nada desliga antes de confirmar');
    await conf.locator('button:text-is("Cancelar")').click();
    ok(!(await conf.isVisible()) && S.desligar === 0, 'Cancelar não desliga');
    await page.click('[role="dialog"] button:text-is("Desligar")');
    await conf.locator('button:text-is("Desligar")').click();
    await page.waitForTimeout(600);
    ok(S.desligar === 1, 'confirmar chama POST /graph/clique/desligar uma vez');
    ok(S.leiturasSituacao >= 2, 'e a situação é lida de novo');
    ok(/não ligado/.test(await cartao(page).innerText()), 'o cartão volta a "não ligado"');
    ok(erros.length === 0, `sem erro na página (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── a franquia acabou, sem reserva, desligado no Graph, fora do piloto ──
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'cheia' });
    await cartao(page).waitFor({ timeout: 20000 });
    ok(/franquia acabou/.test(await cartao(page).innerText()), 'franquia acabou: o selo do cartão');
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(/A franquia de \S+ acabou/.test(t) && /as fotos são lidas pela IA da empresa/.test(t), 'franquia acabou: o aviso com a reserva');
    ok(/500\s*de\s*500/.test(t), 'franquia acabou: 500 de 500');
    ok(/a franquia do mês acabou; foi à IA da empresa/.test(t), 'a última leitura diz por que foi à IA');
    await ctx.close();
  }
  // ── pedir mais (plano "recursos por produto"): a ligação antiga, as chaves e o que vai ao servidor ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { situacao: 'ligado' });
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(/O que está liberado/.test(t) && /Ler fotos, PDFs e vídeos/.test(t), 'ligado: a lista do que está liberado');
    ok(/Peça de novo "ouvir áudios" e "falar" até 01\/03\/2099/.test(t) && (t.match(/Pela permissão antiga/g) ?? []).length === 2, 'a ligação antiga: o aviso e ouvir e falar pela permissão antiga');
    ok(/Recurso pago: a empresa começa com franquia 0/.test(t), 'o recurso pago diz que começa em 0');
    const pedirMais = page.locator('[role="dialog"] button:has-text("Pedir mais ao DMS Graph")');
    ok(await pedirMais.isDisabled(), 'sem nada ligado, "Pedir mais" fica travado');
    await page.getByRole('switch', { name: 'Pedir: editar fotos' }).click();
    ok(await pedirMais.isEnabled(), 'com uma chave ligada, "Pedir mais" libera');
    await page.getByRole('switch', { name: 'Pedir: criar imagens' }).click();
    await page.getByRole('switch', { name: 'Pedir: criar imagens' }).click();
    await pedirMais.click();
    await page.waitForURL(/graph\.exemplo\.test\/autorizar/, { timeout: 8000 }).catch(() => {});
    ok(S.iniciar === 1 && JSON.stringify(S.pedidos[0]) === '{"pedir":["imagens.editar"]}', `vai só o que ficou ligado (${JSON.stringify(S.pedidos[0])})`);
    ok(erros.length === 0, `pedir mais: sem erro na página (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { situacao: 'ligado' });
    await abrirJanela(page);
    await page.click('[role="dialog"] button:has-text("Pedir de novo ouvir e falar")');
    await page.waitForURL(/graph\.exemplo\.test\/autorizar/, { timeout: 8000 }).catch(() => {});
    ok(JSON.stringify(S.pedidos[0]) === '{"pedir":["audio.ouvir","audio.falar"]}', '"Pedir de novo ouvir e falar" pede os dois');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'comTudo' });
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(!/Pedir mais ao DMS Graph/.test(t) && !/Peça de novo/.test(t) && (await page.getByRole('switch').count()) === 0, 'com tudo liberado: sem chave e sem "Pedir mais"');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'soAudioNovo' });
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(!/Peça de novo/.test(t) && !/Pela permissão antiga/.test(t) && (await page.getByRole('switch').count()) === 2, 'já com ouvir e falar próprios: sem o aviso, só as chaves de imagem');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'legadoVencido' });
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(!/Pela permissão antiga/.test(t) && (await page.getByRole('switch', { name: 'Pedir: ouvir áudios' }).count()) === 1, 'depois da data: ouvir e falar aparecem como não liberados');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'ligado', token: GERENTE });
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(/Só quem é presidente pede mais ou desliga/.test(t) && (await page.getByRole('switch').count()) === 0 && !/Pedir mais ao DMS Graph/.test(t) && !/Pedir de novo/.test(t), 'o gerente vê o que está liberado, sem pedir');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'semReserva' });
    await abrirJanela(page);
    ok(/Nenhuma: sem a chave de IA da empresa/.test(await janela(page).innerText()), 'sem a chave de IA: a reserva diz "Nenhuma"');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'desligadoNoGraph' });
    await abrirJanela(page);
    const t = await janela(page).innerText();
    ok(/A ligação foi desligada no DMS Graph em/.test(t), 'desligada no Graph: o aviso com a data (GR-6)');
    ok((await page.locator('[role="dialog"] button:has-text("Conectar ao DMS Graph de novo")').count()) === 1, 'desligada no Graph: "Conectar ao DMS Graph de novo"');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { situacao: 'foraDoPiloto' });
    await page.waitForTimeout(1500);
    ok(S.leiturasSituacao >= 1 && (await cartao(page).count()) === 0, 'fora do piloto (ligado: false): sem cartão');
    await ctx.close();
  }

  // ── GR-8: a empresa sem CNPJ — o presidente informa na janela, uma vez ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { situacao: 'semCnpj' });
    await abrirJanela(page);
    const bloco = page.locator('[role="dialog"] :text("Falta o CNPJ da empresa")');
    ok(await bloco.isVisible(), 'sem CNPJ: o bloco "Falta o CNPJ da empresa" aparece');
    const conectar = page.locator('[role="dialog"] button:has-text("Conectar ao DMS Graph")');
    ok(await conectar.isDisabled(), 'sem CNPJ: "Conectar ao DMS Graph" fica desligado');
    ok(await page.locator('[role="dialog"] :text("Salve o CNPJ para conectar.")').isVisible(), 'sem CNPJ: a nota "Salve o CNPJ para conectar."');
    const campo = page.getByLabel('CNPJ da empresa');
    ok((await campo.count()) === 1, 'o campo tem o rótulo ligado ("CNPJ da empresa")');
    const salvar = page.locator('[role="dialog"] button:has-text("Salvar CNPJ")');
    await campo.fill('1234');
    ok(await salvar.isDisabled(), 'com menos de 14 números, "Salvar CNPJ" fica desligado');
    const c = cnpjDeTeste();
    await campo.fill(`${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`);
    ok(await salvar.isEnabled(), 'com 14 números (com a máscara), "Salvar CNPJ" liga');
    await page.screenshot({ path: foto('graph-sem-cnpj.png') });
    await salvar.click();
    await page.waitForTimeout(700);
    ok(S.cnpjs.length === 1 && S.cnpjs[0].cnpj === c, `vai ao servidor só com os números (${JSON.stringify(S.cnpjs)})`);
    ok(!(await bloco.isVisible().catch(() => false)), 'gravado: a situação é lida de novo e o bloco some');
    ok(await conectar.isEnabled(), 'gravado: "Conectar ao DMS Graph" liga');
    ok(erros.length === 0, `sem erro na página (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const frase = 'Outra empresa do Regem já usa este CNPJ. Confira o número; se ele é mesmo desta empresa, fale com o suporte da DMS.';
    const { ctx, page, S } = await abrir(1280, 900, { situacao: 'semCnpj', recusarCnpj: frase });
    await abrirJanela(page);
    await page.getByLabel('CNPJ da empresa').fill(cnpjDeTeste());
    await page.locator('[role="dialog"] button:has-text("Salvar CNPJ")').click();
    const alerta = page.locator('[role="dialog"] [role="alert"]');
    await alerta.waitFor({ timeout: 5000 }).catch(() => {});
    ok((await alerta.innerText().catch(() => '')).includes(frase), 'CNPJ recusado: a frase do servidor no próprio bloco');
    ok(S.cnpjs.length === 1 && (await page.locator('[role="dialog"] button:has-text("Conectar ao DMS Graph")').isDisabled()), 'CNPJ recusado: nada muda e "Conectar" segue desligado');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: GERENTE, situacao: 'semCnpj' });
    await abrirJanela(page);
    ok((await page.getByLabel('CNPJ da empresa').count()) === 0, 'gerente sem CNPJ: sem o campo');
    ok(await page.locator('[role="dialog"] :text("é o presidente quem informa")').isVisible(), 'gerente sem CNPJ: "é o presidente quem informa"');
    ok(S.cnpjs.length === 0, 'gerente: nada vai ao servidor');
    await ctx.close();
  }

  // ── Atendimento › Fotos do cliente: "Quem lê as fotos agora" ──
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'ligado', caminho: '/delivery/configuracoes?aba=atendimento' });
    const linha = page.locator(':text("Quem lê as fotos agora")').first();
    await linha.waitFor({ timeout: 20000 }).catch(() => {});
    ok(await linha.isVisible(), 'a linha "Quem lê as fotos agora" aparece em Fotos do cliente');
    const corpo = await page.locator('main').innerText();
    ok(/Quem lê agora: o DMS Graph \(87 de 500 fotos neste mês\)\. Se ele não ler em 10 segundos, a foto vai à IA da empresa\./.test(corpo), 'a ajuda diz quem lê, a franquia e os 10 s do serviço');
    ok((await page.locator('main a[href="/delivery/configuracoes?aba=integracoes"]:has-text("Ver o DMS Graph")').count()) === 1, 'o link aponta o cartão em Integrações');
    ok(/com o DMS Graph ligado, a foto é lida dentro da franquia dele/.test(corpo) && !/sai da chave de IA da empresa/.test(corpo), 'a nota do grupo diz que a foto sai da franquia do Graph (não da chave da IA)');
    await page.screenshot({ path: foto('graph-fotos-do-cliente.png'), fullPage: false });
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { situacao: 'naoLigado', caminho: '/delivery/configuracoes?aba=atendimento' });
    await page.locator(':text("Quem lê as fotos agora")').first().waitFor({ timeout: 20000 }).catch(() => {});
    const corpo = await page.locator('main').innerText();
    ok(/Quem lê agora: a chave de IA da empresa/.test(corpo), 'não ligado: quem lê é a IA da empresa');
    ok(/sai da chave de IA da empresa/.test(corpo), 'não ligado: a nota do grupo diz que sai da chave de IA da empresa');
    ok((await page.locator('main a:has-text("Ligar o DMS Graph")').count()) === 1, 'não ligado: o presidente tem "Ligar o DMS Graph"');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { situacao: 'foraDoPiloto', caminho: '/delivery/configuracoes?aba=atendimento' });
    await page.locator(':text("Ler as fotos que o cliente manda")').first().waitFor({ timeout: 20000 }).catch(() => {});
    ok(S.leiturasSituacao >= 1 && (await page.locator(':text("Quem lê as fotos agora")').count()) === 0, 'fora do piloto: sem a linha');
    await ctx.close();
  }

  // ── a volta ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { caminho: '/integracoes/graph/volta?code=gph_ac_x&state=abc&iss=https%3A%2F%2Fgraph.exemplo.test' });
    await page.waitForURL(/aba=integracoes/, { timeout: 15000 }).catch(() => {});
    ok(
      S.concluir.length === 1 && S.concluir[0].code === 'gph_ac_x' && S.concluir[0].state === 'abc' && S.concluir[0].iss === 'https://graph.exemplo.test',
      `a volta manda code, state e iss ao servidor (${JSON.stringify(S.concluir)}; em ${umaLinha(page.url(), 80)}; ${umaLinha(await page.locator('body').innerText().catch(() => ''), 160)}; ${erros.join(' | ')})`,
    );
    ok(/aba=integracoes/.test(page.url()), 'ligou: volta à aba Integrações');
    await ctx.close();
  }
  {
    const frase = 'Você não autorizou no DMS Graph. Nada mudou: as fotos dos clientes seguem pela IA da empresa. Se quiser ligar, comece de novo.';
    const { ctx, page } = await abrir(1280, 900, { caminho: '/integracoes/graph/volta?error=access_denied&state=abc&iss=https%3A%2F%2Fgraph.exemplo.test', concluir: { ligada: false, mensagem: frase } });
    const alerta = page.locator('[role="alert"]:has-text("A empresa não foi ligada ao DMS Graph")');
    await alerta.waitFor({ timeout: 15000 }).catch(() => {});
    ok(await alerta.isVisible(), 'não ligou: o título');
    ok((await alerta.innerText()).includes(frase), 'não ligou: a frase do servidor');
    ok(!/code=|state=/.test(page.url()), 'o código e o state saem do endereço');
    ok((await page.locator('button:has-text("Voltar às integrações")').count()) === 1, 'não ligou: "Voltar às integrações"');
    await ctx.close();
  }

  // ── as larguras: a janela aberta (antes de ligar, ligada e na confirmação) e a volta que falhou ──
  for (const w of larguras) {
    const h = w < 700 ? 760 : 900;
    for (const situacao of ['naoLigado', 'ligado', 'semCnpj']) {
      const { ctx, page, erros } = await abrir(w, h, { situacao });
      try {
        await abrirJanela(page);
        if (situacao === 'ligado') {
          await page.click('[role="dialog"] button:text-is("Desligar")');
          await page.locator('[role="alertdialog"]').waitFor({ timeout: 3000 });
        }
        const achados = await medir(page);
        ok(achados.length === 0, `${w}px · ${situacao}: sem barra para o lado e nada fora da tela${achados.length ? ` (${achados.slice(0, 3).join('; ')})` : ''}`);
        const caixa = await page.locator('[role="dialog"] > div.relative').boundingBox();
        ok(!!caixa && caixa.x >= -1 && caixa.x + caixa.width <= w + 1, `${w}px · ${situacao}: a janela inteira na largura`);
        const botao = page.locator(
          situacao === 'ligado'
            ? '[role="alertdialog"] button:text-is("Desligar")'
            : situacao === 'semCnpj'
              ? '[role="dialog"] button:has-text("Salvar CNPJ")'
              : '[role="dialog"] button:has-text("Conectar ao DMS Graph")',
        );
        const b = await botao.boundingBox();
        ok(!!b && b.height >= 36, `${w}px · ${situacao}: o botão principal tem altura de toque (${b ? Math.round(b.height) : '—'} px)`);
        if (w === 320 || w === 375 || w === 1440) await page.screenshot({ path: foto(`graph-${situacao}-${w}.png`) });
        ok(erros.length === 0, `${w}px · ${situacao}: sem erro na página (${erros.join(' | ')})`);
      } catch (e) {
        ok(false, `${w}px · ${situacao}: ${umaLinha(e?.message ?? e)}`);
      }
      await ctx.close();
    }
    {
      const { ctx, page } = await abrir(w, h, { caminho: '/integracoes/graph/volta?error=access_denied&state=abc', concluir: { ligada: false, mensagem: 'O pedido venceu: a página do DMS Graph ficou aberta mais de 10 minutos. Comece de novo; nada foi ligado.' } });
      await page.locator('[role="alert"]').first().waitFor({ timeout: 15000 }).catch(() => {});
      const achados = await medir(page);
      ok(achados.length === 0, `${w}px · volta que falhou: sem barra para o lado${achados.length ? ` (${achados.slice(0, 3).join('; ')})` : ''}`);
      await ctx.close();
    }
  }
}
