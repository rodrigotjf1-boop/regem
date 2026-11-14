// Roteiro de tela do MISTER › PESSOAS, IA E USO e AVISOS E RELATÓRIOS (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026), com a
// API simulada.
// PESSOAS: o presidente vê as duas partes e a lista inteira (quem é quem, o final do número, avisos parados, quem não
// ligou), sem "Editar o que pode"; a parte da IA só é lida quando aberta; ligar o próprio WhatsApp (o código, o QR, o
// link, a espera até aparecer ligado, o código vencido e "Gerar outro código", a recusa do servidor); desligar pede
// confirmação; o Mister indisponível trava o "Ligar"; o gerente vê só a própria linha, sem a faixa de partes e sem
// chamar as rotas da IA; quem é da execução não entra.
// IA E USO:
// Confere: módulo desligado não abre a tela nem chama a rota da chave; sem chave própria, a IA incluída; a chave colada
// vai ao servidor sem espaço, o campo esvazia e ela NÃO fica na página; a situação (funcionando, sem crédito) e o teste;
// a recusa do servidor aparece com a frase dele; apagar pede confirmação; o uso com os rótulos, o custo e o total, vazio,
// erro e "Tentar de novo"; os atalhos de período; o guia em gaveta; gerente não entra; e, em cada largura, a página, a
// gaveta e o diálogo inteiros na tela, sem barra lateral.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: {} });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', perm: { delivery: { ver: true } } });
const CHAVE = `sk-ant-api03-${'k'.repeat(60)}ZZ99`;

const SEM_CHAVE = { provedoresAceitos: ['anthropic'], origem: 'incluida', chave: null };
const comChave = (situacao = 'ok') => ({
  provedoresAceitos: ['anthropic'],
  origem: 'propria',
  chave: { provedor: 'anthropic', final: 'ZZ99', situacao, conferidaEm: '2026-11-13T01:10:00Z', salvaEm: '2026-11-13T01:10:00Z' },
});
const USO = {
  de: '2026-10-15',
  ate: '2026-11-13',
  precosLidosEm: '2026-11-12',
  itens: [
    { recurso: 'copiloto', provedor: 'anthropic', modelo: 'claude-haiku-5-5', origem: 'lojista', chamadas: 312, falhas: 2, tokens: { entrada: 780_000, cacheEscrita: 0, cacheLeitura: 0, saida: 62_000 }, custoEstimadoUsd: 0.109 },
    { recurso: 'copiloto', provedor: 'anthropic', modelo: 'claude-haiku-5-5', origem: 'distribuicao', chamadas: 40, falhas: 0, tokens: { entrada: 100_000, cacheEscrita: 0, cacheLeitura: 0, saida: 8_000 }, custoEstimadoUsd: 0.014 },
    { recurso: 'mister_perguntas', provedor: 'anthropic', modelo: 'claude-sonnet-5-5', origem: 'lojista', chamadas: 28, falhas: 0, tokens: { entrada: 400_000, cacheEscrita: 500_000, cacheLeitura: 2_500_000, saida: 224_000 }, custoEstimadoUsd: 8.96 },
    { recurso: 'prova', provedor: 'anthropic', modelo: 'modelo-novo', origem: 'lojista', chamadas: 2, falhas: 0, tokens: { entrada: 16, cacheEscrita: 0, cacheLeitura: 0, saida: 32 }, custoEstimadoUsd: null },
  ],
  custoEstimadoUsd: { lojista: 9.069, distribuicao: 0.014 },
  semPreco: ['modelo-novo'],
};

const pessoa = (o) => ({
  colaboradorId: 'c1',
  nome: 'Ana Souza',
  nivel: 'presidente',
  loja: null,
  voce: false,
  ligado: false,
  final: null,
  ligadoEm: null,
  pausado: false,
  pode: ['avisos', 'consulta', 'autorizacao'],
  ...o,
});
const gerente = (o) => pessoa({ nivel: 'gerente', pode: ['avisos', 'consulta'], ...o });
const PESSOAS = [
  pessoa({ voce: true, ligado: true, final: '4321', ligadoEm: '2026-11-02T15:00:00Z' }),
  gerente({ colaboradorId: 'c2', nome: 'Carlos Lima', loja: 'Loja Centro', ligado: true, final: '8890', ligadoEm: '2026-11-05T15:00:00Z' }),
  gerente({ colaboradorId: 'c3', nome: 'João Reis', loja: 'Loja Centro', ligado: true, final: '1177', ligadoEm: '2026-11-06T15:00:00Z', pausado: true }),
  gerente({ colaboradorId: 'c4', nome: 'Marina Alves de Albuquerque Figueiredo', loja: 'Loja Barra' }),
];
const NINGUEM = PESSOAS.map((x) => ({ ...x, ligado: false, final: null, ligadoEm: null, pausado: false }));
const EXECUCAO = tokenFalso({ cat: 'execucao', perfil: 'execucao', perm: {} });

// A parte "Avisos e relatórios" (versão 2 do protótipo, aprovada em 14/11/2026): o que o servidor devolve com o padrão.
const DESTINOS_DA_TELA = [
  { id: 'presidente', nome: 'WhatsApp do presidente' },
  { id: 'gerente', nome: 'WhatsApp do gerente da loja' },
  { id: 'tela', nome: 'Tela do Regem na loja' },
  { id: 'kds', nome: 'KDS da cozinha' },
  { id: 'atendimento', nome: 'Caso no Atendimento' },
  { id: 'dms', nome: 'Suporte da DMS' },
];
const regraAv = (destinos, o = {}) => ({ ligado: true, destinos, escalaMin: null, escalaPara: [], parametro: null, ...o });
const AVISOS_PADRAO = () => ({
  destinos: DESTINOS_DA_TELA,
  avisos: [
    { tipo: 'impressora', grupo: 'Na loja', titulo: 'Impressora parada', descricao: 'Uma impressora deixou de responder com via na fila.', jaFunciona: true, padrao: true, regra: regraAv(['tela'], { escalaMin: 5, escalaPara: ['gerente'] }) },
    { tipo: 'pedido_parado', grupo: 'Na loja', titulo: 'Pedido parado', descricao: 'Um pedido sem andar além do tempo escolhido.', jaFunciona: false, padrao: true, regra: regraAv(['kds', 'tela', 'gerente'], { ligado: false, parametro: 20 }) },
    { tipo: 'caixa_24h', grupo: 'Na loja', titulo: 'Caixa aberto há mais de 24 horas', descricao: 'O Regem já pede o fechamento na tela do caixa; aqui o gerente fica sabendo.', jaFunciona: true, padrao: true, regra: regraAv(['gerente']) },
    { tipo: 'canal_desconectado', grupo: 'Na loja', titulo: 'iFood ou 99 desconectado', descricao: 'A loja parou de receber pedidos de um canal.', jaFunciona: false, padrao: true, regra: regraAv(['gerente', 'tela']) },
    { tipo: 'servidor_sem_sinal', grupo: 'Servidor da loja', titulo: 'Servidor da loja sem sinal', descricao: 'Só quando há pedido esperando.', jaFunciona: true, padrao: true, regra: regraAv(['gerente', 'dms']) },
    { tipo: 'servidor_tecnico', grupo: 'Servidor da loja', titulo: 'Serviço parado, disco cheio ou cópia de segurança atrasada', descricao: 'Problemas técnicos do servidor: o suporte da DMS resolve.', jaFunciona: true, padrao: true, regra: regraAv(['dms'], { escalaMin: 120, escalaPara: ['gerente'] }) },
    { tipo: 'nota_sem_resposta', grupo: 'Fiscal', titulo: 'Nota fiscal sem resposta', descricao: 'Nota que ficou pendente depois de todas as tentativas.', jaFunciona: false, padrao: true, regra: regraAv(['atendimento', 'presidente']) },
    { tipo: 'certificado', grupo: 'Fiscal', titulo: 'Certificado digital perto de vencer', descricao: 'A 60, 30, 15, 7 e 1 dia do vencimento.', jaFunciona: false, padrao: true, regra: regraAv(['presidente']) },
    { tipo: 'chave_ia', grupo: 'O próprio Mister', titulo: 'A chave de IA parou', descricao: 'Sem crédito, no teto de gasto ou recusada.', jaFunciona: true, padrao: true, regra: regraAv(['presidente']) },
  ],
});
// Os relatórios (mig 420): os dois desligados, como o padrão; o do dia com um envio que não saiu (fora da janela).
const RELATORIOS_PADRAO = () => [
  {
    tipo: 'resumo_dia', titulo: 'Resumo do dia', descricao: 'Pedidos, vendas, tempo médio, cancelamentos e o que saiu do lugar.',
    regra: { ligado: false, hora: '23:30', diaSemana: null },
    ultimo: { referencia: '2026-11-13', situacao: 'nao_enviado', motivo: 'fora_da_janela_de_24h', em: '2026-11-14T02:31:00.000Z' },
  },
  { tipo: 'resumo_semana', titulo: 'Resumo da semana', descricao: 'Os 7 dias até a véspera contra os 7 anteriores.', regra: { ligado: false, hora: '09:00', diaSemana: 1 }, ultimo: null },
];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('main *, [role="dialog"] *, [role="alertdialog"] *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        // A faixa de partes desliza sem barra à mostra abaixo de 640 px (o desenho do componente e a regra do dono de
        // 07/10/2026): vale, desde que a barra dela fique escondida de verdade.
        if (el.classList.contains('faixa-abas') && window.innerWidth < 640 && el.offsetHeight === el.clientHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) continue;
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth + 1 || r.top < 0) achados.push(`painel fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    for (const b of document.querySelectorAll('main button, [role="dialog"] button, [role="alertdialog"] button'))
      if (b.getClientRects().length && b.getBoundingClientRect().height < 39.5) achados.push(`botão baixo "${b.textContent.trim().slice(0, 30)}"`);
    return achados;
  });

export default async function roteiroMister({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h, o = {}) {
    const S = { modulo: o.modulo ?? true, estado: o.estado ?? SEM_CHAVE, uso: o.uso === undefined ? USO : o.uso, usoFalha: !!o.usoFalha, recusa: o.recusa ?? null, pedidos: [], modulos: [],
      // a parte "Pessoas"
      pessoas: o.pessoas ?? PESSOAS, souPresidente: o.souPresidente ?? true, disponivel: o.disponivel ?? true, pessoasFalha: !!o.pessoasFalha,
      recusaDoCodigo: o.recusaDoCodigo ?? null, valeMs: o.valeMs ?? 600_000, ligaNaLeitura: o.ligaNaLeitura ?? 0, leiturasDoMeu: 0, codigos: 0, doMister: [],
      meu: { disponivel: true, numeroDoMister: '5521900000000', ligado: false, final: null, ligadoEm: null, pausado: false, codigo: null },
      // a parte "Avisos e relatórios"
      avisos: o.avisos ?? AVISOS_PADRAO(), avisosFalha: !!o.avisosFalha, recusaDosAvisos: o.recusaDosAvisos ?? null, salvamentos: [],
      relatorios: o.relatorios ?? RELATORIOS_PADRAO(), salvamentosRel: [],
    };
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), o.token ?? PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = req.method();
      if (p.startsWith('/ia/')) S.pedidos.push({ metodo, p, consulta: url.search, corpo: req.postData() });
      if (p.startsWith('/mister/')) S.doMister.push({ metodo, p });
      if (p === '/mister/avisos' && metodo === 'GET') {
        if (S.avisosFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, S.avisos);
      }
      if (p === '/mister/relatorios' && metodo === 'GET') return responder(route, { relatorios: S.relatorios });
      if (p === '/mister/relatorios' && metodo === 'PATCH') {
        const corpo = JSON.parse(req.postData() || '{}');
        S.salvamentosRel.push(corpo);
        for (const r of corpo.relatorios ?? []) {
          const x = S.relatorios.find((y) => y.tipo === r.tipo);
          if (x) x.regra = { ligado: r.ligado, hora: r.hora, diaSemana: r.diaSemana };
        }
        return responder(route, { relatorios: S.relatorios });
      }
      if (p === '/mister/avisos' && metodo === 'PATCH') {
        const corpo = JSON.parse(req.postData() || '{}');
        S.salvamentos.push(corpo);
        if (S.recusaDosAvisos) return responder(route, { statusCode: 400, message: S.recusaDosAvisos }, 400);
        for (const r of corpo.regras ?? []) {
          const a = S.avisos.avisos.find((x) => x.tipo === r.tipo);
          if (a) Object.assign(a, { padrao: false, regra: { ligado: r.ligado, destinos: r.destinos, escalaMin: r.escalaMin, escalaPara: r.escalaPara, parametro: r.parametro } });
        }
        return responder(route, S.avisos);
      }
      if (p === '/mister/pessoas' && metodo === 'GET') {
        if (S.pessoasFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, { disponivel: S.disponivel, numeroDoMister: S.disponivel ? '5521900000000' : null, souPresidente: S.souPresidente, total: S.pessoas.length, pessoas: S.pessoas });
      }
      if (p === '/mister/whatsapp/codigo' && metodo === 'POST') {
        if (S.recusaDoCodigo) return responder(route, { statusCode: 409, message: S.recusaDoCodigo }, 409);
        S.codigos += 1;
        const codigo = String(482912 + S.codigos);
        // Só o PRIMEIRO código usa a validade curta do cenário "vencido"; o gerado depois vale os 10 minutos.
        const vale = S.codigos === 1 ? S.valeMs : 600_000;
        S.meu = { ...S.meu, codigo: { codigo, mensagem: `MISTER ${codigo}`, link: `https://wa.me/5521900000000?text=MISTER%20${codigo}`, expiraEm: new Date(Date.now() + vale).toISOString() } };
        return responder(route, S.meu, 201);
      }
      if (p === '/mister/whatsapp' && metodo === 'GET') {
        S.leiturasDoMeu += 1;
        if (S.ligaNaLeitura && S.leiturasDoMeu >= S.ligaNaLeitura && !S.meu.ligado) {
          S.meu = { ...S.meu, ligado: true, final: '4321', ligadoEm: '2026-11-13T15:00:00Z', codigo: null };
          S.pessoas = S.pessoas.map((x) => (x.voce ? { ...x, ligado: true, final: '4321', ligadoEm: '2026-11-13T15:00:00Z' } : x));
        }
        return responder(route, S.meu);
      }
      const paraDesligar = /^\/mister\/pessoas\/([^/]+)$/.exec(p);
      if (paraDesligar && metodo === 'DELETE') {
        S.pessoas = S.pessoas.map((x) => (x.colaboradorId === paraDesligar[1] ? { ...x, ligado: false, final: null, ligadoEm: null, pausado: false } : x));
        return responder(route, { desligado: true });
      }
      if (p === '/modulos/meus') return responder(route, { mister: S.modulo, mesas: true, kds: true });
      // Visão C&O: a lista de módulos e o liga/desliga
      if (p === '/diretoria/multiunidade') return responder(route, { unidades: [], rede: null });
      if (p === '/modulos' && metodo === 'GET')
        return responder(route, {
          modulos: [
            { chave: 'kds', label: 'KDS de Alertas', emoji: '🖥️' },
            { chave: 'mister', label: 'Mister', emoji: '✨', padrao: false },
          ],
          unidades: [],
          rede: { kds: true, mister: S.modulo },
          porUnidade: {},
        });
      if (p === '/modulos' && metodo === 'POST') {
        S.modulos.push(JSON.parse(req.postData() ?? '{}'));
        return responder(route, { ok: true }, 201);
      }
      if (p === '/ia/chave' && metodo === 'GET') return responder(route, S.estado);
      if (p === '/ia/chave' && metodo === 'POST') {
        if (S.recusa) return responder(route, { statusCode: 400, message: S.recusa }, 400);
        S.estado = comChave(o.aoSalvar ?? 'ok');
        return responder(route, S.estado, 201);
      }
      if (p === '/ia/chave/testar') {
        S.estado = comChave(o.aoTestar ?? 'ok');
        return responder(route, S.estado, 201);
      }
      if (p === '/ia/chave' && metodo === 'DELETE') {
        S.estado = SEM_CHAVE;
        return responder(route, S.estado);
      }
      if (p === '/ia/uso') return S.usoFalha ? responder(route, { statusCode: 500, message: 'Erro interno' }, 500) : responder(route, S.uso);
      return responder(route, {});
    });
    await page.goto(base + (o.caminho ?? '/mister?parte=ia'));
    return { ctx, page, erros, S };
  }
  const daIa = (S, metodo, p) => S.pedidos.filter((x) => x.metodo === metodo && x.p === p);

  // ── Visão C&O › Módulos do produto: o Mister DESLIGADO tem de APARECER e ligar com um toque ──
  // A chave desligada usava a cor do cartão (1,05:1) e ninguém via: todo módulo nascia ligado, até o Mister.
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { modulo: false, caminho: '/diretoria' });
    const chave = page.locator('button[role="switch"][aria-label="Mister na rede"]');
    await chave.waitFor({ timeout: 20000 });
    ok((await chave.getAttribute('aria-checked')) === 'false', 'Visão C&O: o Mister aparece na lista e nasce desligado');
    await page.waitForTimeout(250); // a cor termina a transição
    const contraste = await chave.evaluate((el) => {
      const cor = (s) => {
        const p = (s.match(/rgba?\(([^)]+)\)/)?.[1] ?? '255,255,255').split(/[,\s/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
      };
      const fundo = (n) => {
        for (let x = n; x; x = x.parentElement) {
          const c = cor(getComputedStyle(x).backgroundColor);
          if (c.a > 0.99) return c;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };
      const atras = fundo(el.parentElement);
      const dela = cor(getComputedStyle(el).backgroundColor);
      const vista = { r: dela.r * dela.a + atras.r * (1 - dela.a), g: dela.g * dela.a + atras.g * (1 - dela.a), b: dela.b * dela.a + atras.b * (1 - dela.a) };
      const lum = (c) => {
        const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const [claro, escuro] = [lum(vista), lum(atras)].sort((x, y) => y - x);
      return (claro + 0.05) / (escuro + 0.05);
    });
    ok(contraste >= 3, `Visão C&O: a chave DESLIGADA aparece sobre o cartão (contraste ${contraste.toFixed(2)}:1; o mínimo é 3:1)`);
    await page.screenshot({ path: foto('1280-modulo-desligado.png'), fullPage: true });
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/modulos') && r.request().method() === 'POST'), chave.click()]);
    ok(S.modulos.length === 1 && S.modulos[0].modulo === 'mister' && S.modulos[0].ativo === true && S.modulos[0].unidadeId === null, `Visão C&O: um toque liga o Mister na rede (${JSON.stringify(S.modulos[0])})`);
    await page.waitForSelector('text=Módulo ativado.');
    ok((await chave.getAttribute('aria-checked')) === 'true', 'Visão C&O: ligado, a chave muda de estado');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── módulo desligado: a tela explica e não pede a chave ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { modulo: false });
    await page.waitForSelector('text=O módulo Mister está desligado', { timeout: 20000 });
    ok((await page.locator('a[href="/diretoria"]:has-text("Abrir Visão C&O")').count()) === 1, 'módulo desligado: aponta Visão C&O › Módulos do produto');
    ok(S.pedidos.length === 0, `módulo desligado: nenhuma chamada às rotas da IA (${S.pedidos.length})`);
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── gerente: entra, só na parte "Pessoas", com a própria linha; nada da IA ──
  {
    const soEle = [gerente({ colaboradorId: 'c2', nome: 'Carlos Lima', loja: 'Loja Centro', voce: true })];
    const { ctx, page, erros, S } = await abrir(1280, 900, { token: GERENTE, caminho: '/mister?parte=ia', pessoas: soEle, souPresidente: false });
    await page.waitForSelector('text=Quem fala com o Mister', { timeout: 20000 });
    ok((await page.locator('[aria-label="Partes do Mister"]').count()) === 0, 'gerente: sem a faixa de partes (não há "IA e uso" para ele, nem pelo link)');
    ok(/Ligue o seu WhatsApp pelo seu celular/.test(await page.locator('main').innerText()), 'gerente: o texto é o dele (ligar o próprio WhatsApp)');
    const linhasDele = await page.locator('main table tbody tr').allInnerTexts();
    ok(linhasDele.length === 1 && /Carlos Lima \(você\)/.test(linhasDele[0].replace(/\s+/g, ' ')) && /gerente · Loja Centro/.test(linhasDele[0]), `gerente: só a própria linha (${linhasDele.length})`);
    ok((await page.locator('main table button:has-text("Ligar o meu WhatsApp")').count()) === 1, 'gerente: pode ligar o próprio WhatsApp');
    ok(S.pedidos.length === 0, `gerente: nenhuma chamada às rotas da IA (${S.pedidos.length})`);
    ok((await page.locator('nav a[href="/mister"]').count()) === 1, 'gerente: o item "Mister" aparece no menu');
    ok(erros.length === 0, `gerente: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── execução: não entra, não vê o item no menu e nada é pedido ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: EXECUCAO, caminho: '/mister' });
    await page.waitForSelector('text=Área restrita', { timeout: 20000 });
    ok(S.pedidos.length === 0 && S.doMister.length === 0, `execução: área restrita, sem chamada à IA nem ao Mister (${S.pedidos.length + S.doMister.length})`);
    ok((await page.locator('nav a[href="/mister"]').count()) === 0, 'execução: o item "Mister" não aparece no menu');
    await ctx.close();
  }

  // ── PESSOAS, presidente: as duas partes, a lista inteira, e a IA só é lida quando aberta ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister' });
    await page.waitForSelector('text=Quem fala com o Mister', { timeout: 20000 });
    const partes = page.locator('[aria-label="Partes do Mister"] button');
    ok((await partes.allInnerTexts()).join('|') === 'Pessoas|IA e uso|Avisos e relatórios' && (await partes.first().getAttribute('aria-pressed')) === 'true', 'presidente: as partes "Pessoas", "IA e uso" e "Avisos e relatórios", abrindo em Pessoas');
    ok(S.pedidos.length === 0, 'em Pessoas, a parte da IA não é lida');
    ok(/O número do Mister é \+55 21 90000-0000/.test(await page.locator('main').innerText()), 'o número do Mister, formatado, para salvar nos contatos');
    const linhas = (await page.locator('main table tbody tr').allInnerTexts()).map((l) => l.replace(/\s+/g, ' '));
    ok(linhas.length === 4, `as quatro pessoas (${linhas.length})`);
    ok(/Ana Souza \(você\) presidente · todas as lojas ligado final 4321 · desde 02\/11 Avisos · Consulta · Autorização Desligar/.test(linhas[0]), `a linha do presidente (${linhas[0]})`);
    ok(/Carlos Lima gerente · Loja Centro ligado final 8890 · desde 05\/11 Avisos · Consulta Desligar/.test(linhas[1]), `a linha do gerente ligado (${linhas[1]})`);
    ok(/avisos parados final 1177/.test(linhas[2]) && /Respondeu PARAR AVISOS/.test(linhas[2]), 'quem respondeu PARAR AVISOS aparece com os avisos parados');
    ok(/não ligado Só a própria pessoa liga, entrando com o usuário dela\. Avisos · Consulta$/.test(linhas[3].trim()), `quem não ligou: a frase e nenhum botão (${linhas[3]})`);
    ok((await page.locator('main button:has-text("Editar o que pode")').count()) === 0, 'sem "Editar o que pode" (o perfil de permissões fica para o fim do projeto)');
    ok(!/\d{10,}/.test(linhas.join(' ')), 'nenhum telefone inteiro na lista');
    // desligar o WhatsApp de outra pessoa: pede confirmação; "Cancelar" não chama
    const desligar = (nome) => page.locator('main table tbody tr', { hasText: nome }).locator('button:has-text("Desligar")');
    await desligar('Carlos Lima').click();
    const alerta = page.locator('[role="alertdialog"]');
    await alerta.waitFor();
    ok(/Desligar o WhatsApp de Carlos Lima/.test(await alerta.innerText()) && /a própria pessoa liga de novo/.test(await alerta.innerText()), 'desligar outra pessoa: o diálogo diz de quem e como volta');
    await alerta.locator('button:has-text("Cancelar")').click();
    await alerta.waitFor({ state: 'detached' });
    ok(S.doMister.filter((x) => x.metodo === 'DELETE').length === 0, 'desligar: "Cancelar" não chama o servidor');
    await desligar('Carlos Lima').click();
    await alerta.locator('button:has-text("Desligar")').click();
    await page.waitForSelector('text=WhatsApp desligado.');
    const apagou = S.doMister.filter((x) => x.metodo === 'DELETE');
    ok(apagou.length === 1 && apagou[0].p === '/mister/pessoas/c2', `desligar confirmado: a pessoa certa vai ao servidor (${apagou.map((x) => x.p).join(',')})`);
    await page.locator('main table tbody tr', { hasText: 'Carlos Lima' }).locator('text=não ligado').waitFor();
    ok((await desligar('Carlos Lima').count()) === 0, 'depois de desligar: a linha mostra "não ligado", sem botão');
    // o próprio: o diálogo fala com ele
    await desligar('Ana Souza').click();
    await alerta.waitFor();
    ok(/Desligar o meu WhatsApp/.test(await alerta.innerText()) && /ligue de novo pelo seu celular/.test(await alerta.innerText()), 'desligar o próprio: o diálogo é o dele');
    await page.keyboard.press('Escape');
    await alerta.waitFor({ state: 'detached' });
    // a outra parte
    await page.click('[aria-label="Partes do Mister"] button:has-text("IA e uso")');
    await page.waitForSelector('text=Chave de IA');
    ok(daIa(S, 'GET', '/ia/chave').length === 1, 'abrir "IA e uso": aí sim a chave é lida');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── PESSOAS: ligar o meu WhatsApp — o código, o QR, o link, a espera e o "Ligado" ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister', pessoas: NINGUEM, ligaNaLeitura: 2 });
    await page.click('main table button:has-text("Ligar o meu WhatsApp")');
    const dialogo = page.locator('[role="dialog"]');
    await dialogo.locator('text=Esperando a sua mensagem').waitFor({ timeout: 15000 });
    const texto = await dialogo.innerText();
    ok(/Ligar o meu WhatsApp ao Mister/.test(texto) && /MISTER 482913/.test(texto) && /para o número do Mister/.test(texto), 'ligar: o diálogo mostra a mensagem com a palavra MISTER e o código');
    ok(/o código vale até \d{2}:\d{2} e uma vez só/.test(texto), 'ligar: diz até quando o código vale');
    ok((await dialogo.locator('a[href="https://wa.me/5521900000000?text=MISTER%20482913"]').count()) === 1, 'ligar: o link abre o WhatsApp do número do Mister com a mensagem pronta');
    const qr = dialogo.locator('img[alt="Código para abrir o WhatsApp com a mensagem pronta"]');
    await qr.waitFor();
    ok((await qr.getAttribute('src'))?.startsWith('data:image/png'), 'ligar: o código para a câmera é desenhado');
    await dialogo.locator('text=Ligado.').waitFor({ timeout: 15000 });
    ok(/Final 4321/.test(await dialogo.innerText()), 'ligar: quando a mensagem chega, a tela mostra "Ligado" e o final do número');
    const lidas = S.leiturasDoMeu;
    await page.waitForTimeout(3500);
    ok(S.leiturasDoMeu === lidas, `ligado: a tela para de perguntar ao servidor (${lidas} → ${S.leiturasDoMeu})`);
    await dialogo.locator('button:has-text("Fechar")').click();
    await dialogo.waitFor({ state: 'detached' });
    await page.locator('main table tbody tr', { hasText: 'Ana Souza' }).locator('text=final').waitFor();
    ok(S.codigos === 1, 'ligar: um código só foi gerado');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── PESSOAS: o código vence — "Gerar outro código" ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister', pessoas: NINGUEM, valeMs: 2000 });
    await page.click('main table button:has-text("Ligar o meu WhatsApp")');
    const dialogo = page.locator('[role="dialog"]');
    await dialogo.locator('text=O código venceu. Gere outro para ligar.').waitFor({ timeout: 15000 });
    ok(!/MISTER 482913/.test(await dialogo.innerText()), 'código vencido: o código velho sai da tela');
    await dialogo.locator('button:has-text("Gerar outro código")').click();
    await dialogo.locator('text=MISTER 482914').first().waitFor();
    ok(S.codigos === 2, 'código vencido: "Gerar outro código" pede um novo ao servidor');
    await ctx.close();
  }

  // ── PESSOAS: o Mister indisponível, a recusa do servidor e o erro ao carregar ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister', pessoas: NINGUEM, disponivel: false });
    await page.waitForSelector('text=O Mister ainda não está disponível pelo WhatsApp');
    ok(await page.locator('main table button:has-text("Ligar o meu WhatsApp")').isDisabled(), 'Mister indisponível: avisa e trava o "Ligar"');
    ok(!/\+55 21/.test(await page.locator('main').innerText()) && S.codigos === 0, 'Mister indisponível: não mostra número e não gera código');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { caminho: '/mister', pessoas: NINGUEM, recusaDoCodigo: 'O Mister ainda não está disponível pelo WhatsApp. Fale com a Regem.' });
    await page.click('main table button:has-text("Ligar o meu WhatsApp")');
    await page.waitForSelector('[role="dialog"] [role="alert"]:has-text("Fale com a Regem")');
    ok((await page.locator('[role="dialog"] button:has-text("Tentar de novo")').count()) === 1, 'recusa ao gerar o código: a frase do servidor, com "Tentar de novo"');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister', pessoasFalha: true });
    await page.waitForSelector('text=Não consegui carregar as pessoas agora.');
    S.pessoasFalha = false;
    await page.click('main button:has-text("Tentar de novo")');
    await page.locator('main table tbody tr').first().waitFor();
    ok(true, 'erro ao carregar as pessoas: avisa e "Tentar de novo" lê de novo');
    await ctx.close();
  }

  // ── sem chave própria: a IA incluída; colar, salvar, testar, apagar ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, {});
    await page.waitForSelector('text=IA incluída pela Regem.', { timeout: 20000 });
    const campo = page.locator('input[type="password"]');
    ok((await campo.getAttribute('autocomplete')) === 'new-password', 'o campo da chave não deixa o navegador preencher nem guardar (V54)');
    ok((await campo.getAttribute('placeholder')) === 'cole a chave que começa com sk-ant-', 'sem chave: o campo pede a chave');
    ok((await page.locator('button:has-text("Apagar a chave")').count()) === 0, 'sem chave: não há "Apagar a chave"');

    await page.click('button:has-text("Testar conexão")');
    await page.waitForSelector('text=Cole a chave e clique em "Salvar chave"');
    await page.click('button:has-text("Salvar chave")');
    await page.waitForSelector('text=Cole a chave de IA.');
    ok(daIa(S, 'POST', '/ia/chave').length === 0 && daIa(S, 'POST', '/ia/chave/testar').length === 0, 'campo vazio: nada vai ao servidor');

    await campo.fill(`  ${CHAVE}  `);
    await Promise.all([page.waitForResponse((r) => r.url().includes('/ia/chave') && r.request().method() === 'POST'), page.click('button:has-text("Salvar chave")')]);
    await page.waitForSelector('text=Chave conferida e salva.');
    const enviado = JSON.parse(daIa(S, 'POST', '/ia/chave')[0].corpo);
    ok(enviado.provedor === 'anthropic' && enviado.chave === CHAVE, 'salvar: vai o provedor e a chave SEM os espaços das pontas');
    ok((await campo.inputValue()) === '', 'salvar: o campo esvazia');
    ok(!(await page.content()).includes(CHAVE), 'salvar: a chave não fica em lugar nenhum da página');
    const faixa = await page.locator('[role="status"]').first().innerText();
    ok(/Chave salva · final ZZ99/.test(faixa) && /conferida em 12\/11 às 22:10/.test(faixa) && /funcionando/.test(faixa), `a situação: ${umaLinha(faixa)}`);
    ok((await campo.getAttribute('placeholder')) === '•••••• (mantém)', 'com chave salva: o campo vazio mantém a que está guardada');
    await page.screenshot({ path: foto('1280-chave-salva.png'), fullPage: true });

    await Promise.all([page.waitForResponse((r) => r.url().includes('/ia/chave/testar')), page.click('button:has-text("Testar conexão")')]);
    await page.waitForSelector('text=Conectado ✓');
    ok(daIa(S, 'POST', '/ia/chave/testar').length === 1, 'testar: prova a chave guardada');

    // apagar: pede a confirmação; "Cancelar" não apaga
    await page.click('button:has-text("Apagar a chave")');
    await page.waitForSelector('[role="alertdialog"]');
    await page.click('[role="alertdialog"] button:has-text("Cancelar")');
    await page.waitForSelector('[role="alertdialog"]', { state: 'detached' });
    ok(daIa(S, 'DELETE', '/ia/chave').length === 0, 'apagar: "Cancelar" não apaga');
    await page.click('button:has-text("Apagar a chave")');
    await Promise.all([page.waitForResponse((r) => r.request().method() === 'DELETE'), page.click('[role="alertdialog"] button:has-text("Apagar a chave")')]);
    await page.waitForSelector('text=IA incluída pela Regem.');
    ok(daIa(S, 'DELETE', '/ia/chave').length === 1, 'apagar: confirma, apaga e a tela volta para a IA incluída');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── a recusa do servidor aparece com a frase dele; chave salva sem crédito ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { recusa: 'A Anthropic recusou esta chave. Confira se ela está ativa e se foi copiada inteira.' });
    await page.waitForSelector('text=IA incluída pela Regem.', { timeout: 20000 });
    await page.locator('input[type="password"]').fill(CHAVE);
    await page.click('button:has-text("Salvar chave")');
    await page.waitForSelector('text=A Anthropic recusou esta chave.');
    ok((await page.locator('text=Chave salva · final').count()) === 0, 'chave recusada: a tela não diz que salvou');
    ok(daIa(S, 'POST', '/ia/chave').length === 1, 'chave recusada: a frase do servidor aparece');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { estado: comChave('sem_credito'), aoTestar: 'sem_credito' });
    await page.waitForSelector('text=sem crédito', { timeout: 20000 });
    const faixa = await page.locator('[role="status"]').first().innerText();
    ok(/Compre crédito no console dela/.test(faixa), `sem crédito: a faixa diz o que fazer (${umaLinha(faixa)})`);
    await page.click('button:has-text("Testar conexão")');
    await page.waitForSelector('text=Falhou: a conta está sem crédito.');
    ok(true, 'sem crédito: o teste diz por que falhou');
    await ctx.close();
  }

  // ── o uso: rótulos, tokens, custo, total; vazio; erro; atalhos; período invertido ──
  {
    const { ctx, page, erros, S } = await abrir(1440, 900, { estado: comChave() });
    await page.waitForSelector('text=Copiloto do atendimento', { timeout: 20000 });
    const t = await page.locator('main').innerText();
    ok(/Claude Haiku 5\.5/.test(t) && /Claude Sonnet 5\.5/.test(t) && /modelo-novo/.test(t), 'uso: o nome de cada modelo (o que não conhece sai como veio)');
    ok(/780 mil · 62 mil/.test(t) && /3,4 mi · 224 mil/.test(t), 'uso: os tokens curtos, com o cache na entrada');
    ok(/Mister · perguntas/.test(t) && !/mister_perguntas/.test(t), 'uso: as perguntas do Mister saem com o nome da tela, não com o do servidor');
    ok(/é só perguntar a ele sobre a loja/.test(t) && !/perguntas chegam nas próximas/.test(t), 'página: a abertura diz que já dá para perguntar');
    ok(/US\$ 0,11/.test(t) && /US\$ 8,96/.test(t) && /sem preço/.test(t), 'uso: o custo em dólar e "sem preço" para o modelo fora da tabela');
    ok(/IA incluída/.test(t) && /2 falhas/.test(t), 'uso: marca o que foi pela IA incluída e as falhas');
    ok(/Total do período: 382 chamadas/.test(t) && /Na sua chave: US\$ 9,07/.test(t) && /IA incluída: US\$ 0,01/.test(t), 'uso: o total por dono da chave');
    ok(/lida em 12\/11\/2026/.test(t) && /Sem preço na tabela \(fora da soma\): modelo-novo/.test(t), 'uso: a data da tabela de preços e o que ficou fora da soma');
    const primeira = daIa(S, 'GET', '/ia/uso')[0]?.consulta ?? '';
    ok(/de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}/.test(primeira), `uso: pede o período (${primeira})`);
    const antes = daIa(S, 'GET', '/ia/uso').length;
    await Promise.all([page.waitForResponse((r) => r.url().includes('/ia/uso')), page.click('button:has-text("7 dias")')]);
    const sete = daIa(S, 'GET', '/ia/uso').at(-1).consulta;
    const [, de, ate] = /de=([\d-]+)&ate=([\d-]+)/.exec(sete) ?? [];
    ok(daIa(S, 'GET', '/ia/uso').length === antes + 1 && (Date.parse(ate) - Date.parse(de)) / 86_400_000 === 6, `atalho "7 dias": pede 7 dias (${sete})`);
    ok((await page.locator('button:has-text("7 dias")').getAttribute('aria-pressed')) === 'true', 'atalho "7 dias": fica marcado');
    // período invertido: avisa e não pede
    const n = daIa(S, 'GET', '/ia/uso').length;
    await page.locator('input[type="date"]').first().fill('2027-01-01');
    await page.waitForSelector('text=A data inicial vem depois da final.');
    await page.waitForTimeout(300);
    ok(daIa(S, 'GET', '/ia/uso').length === n, 'período invertido: avisa e não pede ao servidor');
    // o guia em gaveta: abre, Esc fecha
    await page.click('button:has-text("Como criar a chave, passo a passo")');
    await page.waitForSelector('[role="dialog"]:has-text("Como criar a chave na Anthropic")');
    const guia = await page.locator('[role="dialog"]').innerText();
    const noGuia = (...nomes) => nomes.filter((n) => !guia.includes(n));
    const faltamPt = noGuia('Adicionar saldo', 'Criar workspace', 'Gerenciar workspaces', 'Limites de gastos', 'Ajustar limite', 'Chaves de API', 'Criar chave', 'Continuar com uma chave de API', 'Nunca', 'Conta vinculada', 'Escopo');
    ok(faltamPt.length === 0, `o guia: os botões do console com o nome em português (faltam: ${faltamPt.join(', ')})`);
    const faltamEn = noGuia('Buy credits', 'Create workspace', 'Spend limits', 'Create key', 'Never');
    ok(faltamEn.length === 0, `o guia: o nome em inglês entre parênteses (faltam: ${faltamEn.join(', ')})`);
    ok(!/console da Anthropic é em inglês/.test(guia), 'o guia: não diz mais que o console é em inglês');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    ok(true, 'o guia: Esc fecha');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { estado: comChave(), uso: { ...USO, itens: [], custoEstimadoUsd: { lojista: 0, distribuicao: 0 }, semPreco: [] } });
    await page.waitForSelector('text=Nenhum uso de IA neste período.', { timeout: 20000 });
    ok(true, 'uso vazio: diz que não houve uso');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { estado: comChave(), usoFalha: true });
    await page.waitForSelector('text=Não consegui ler o uso agora.', { timeout: 20000 });
    const n = daIa(S, 'GET', '/ia/uso').length;
    S.usoFalha = false;
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('text=Copiloto do atendimento');
    ok(daIa(S, 'GET', '/ia/uso').length === n + 1, 'uso com erro: avisa e "Tentar de novo" lê de novo');
    await ctx.close();
  }

  // ── cada largura, PESSOAS: a lista, o diálogo de desligar e o de ligar com o código, sem barra lateral ──
  for (const w of larguras) {
    const a = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister' });
    await a.page.locator('text=Marina Alves de Albuquerque Figueiredo >> visible=true').first().waitFor({ timeout: 20000 });
    let m = await medir(a.page);
    ok(m.length === 0, `${w}px: Pessoas — sem barra lateral e com toque grande (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await a.page.screenshot({ path: foto(`${w}-pessoas.png`), fullPage: true });
    await a.page.locator('button:has-text("Desligar") >> visible=true').first().click();
    await a.page.waitForSelector('[role="alertdialog"]');
    m = await medir(a.page);
    ok(m.length === 0, `${w}px: o diálogo de desligar inteiro na tela (${m.join(' | ')})`);
    ok(a.erros.length === 0, `${w}px: Pessoas sem erro (${a.erros.join(' | ')})`);
    await a.ctx.close();
    const b = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister', pessoas: NINGUEM });
    await b.page.locator('button:has-text("Ligar o meu WhatsApp") >> visible=true').first().click();
    await b.page.locator('[role="dialog"] img').waitFor({ timeout: 15000 });
    m = await medir(b.page);
    ok(m.length === 0, `${w}px: o diálogo de ligar, com o código, inteiro na tela (${m.join(' | ')})`);
    if (w === 375) await b.page.screenshot({ path: foto('375-ligar.png') });
    await b.ctx.close();
  }

  // ── cada largura: a página, a gaveta do guia e o diálogo de apagar, sem barra lateral ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { estado: comChave('teto_atingido') });
    // Na tela estreita a tabela vira cartões: os dois existem na página e só um aparece — espera o que está à vista.
    await page.locator('text=Copiloto do atendimento >> visible=true').first().waitFor({ timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: a página sem barra lateral e com toque grande (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-pagina.png`), fullPage: true });
    await page.click('button:has-text("Como criar a chave, passo a passo")');
    await page.waitForSelector('[role="dialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta do guia inteira na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-guia.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.click('button:has-text("Apagar a chave")');
    await page.waitForSelector('[role="alertdialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: o diálogo de apagar inteiro na tela (${m.join(' | ')})`);
    ok(erros.length === 0, `${w}px: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── AVISOS E RELATÓRIOS: o padrão aprovado, o "Mudar" em gaveta, o salvar pela barra e as recusas ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=avisos' });
    await page.waitForSelector('#mister-avisos-titulo', { timeout: 20000 });
    const t0 = await page.locator('main').innerText();
    ok(/11 ajustes em 5 grupos/.test(t0), 'avisos: os nove avisos em quatro grupos e os dois relatórios no quinto');
    ok(['Na loja', 'Servidor da loja', 'Fiscal', 'O próprio Mister'].every((g) => t0.includes(g)), 'avisos: os quatro grupos do protótipo');
    ok(/Vai para:[\s\S]*Tela do Regem na loja[\s\S]*sem resolver em 5 min: WhatsApp do gerente da loja/.test(t0), 'avisos: a impressora vai à tela e, sem resolver em 5 min, ao gerente');
    ok((t0.match(/chega numa próxima entrega/g) ?? []).length === 4, 'avisos: os quatro tipos que ainda não saem dizem que chegam numa próxima entrega');
    ok(t0.includes('Relatórios') && t0.includes('Resumo do dia') && t0.includes('Resumo da semana'), 'relatórios: o resumo do dia e o da semana no grupo Relatórios');
    ok(/Último: não saiu em 13\/11 às 23:31 — a pessoa não falou com o Mister nas últimas 24 horas/.test(t0), 'relatórios: o último envio que não saiu, com o motivo em português');
    ok(t0.includes('falou com o Mister nas') && t0.includes('últimas 24 horas'), 'relatórios: a nota diz quem recebe pelo WhatsApp (a janela de 24 horas)');
    // Desligar o caixa e salvar: a barra conta e o servidor recebe só o tipo que mudou, inteiro.
    await page.click('button[role="switch"][aria-label*="Caixa aberto há mais de 24 horas"]');
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentos[0]) === JSON.stringify({ regras: [{ tipo: 'caixa_24h', ligado: false, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: null }] }), `avisos: salvar manda só o caixa, inteiro (${JSON.stringify(S.salvamentos[0])})`);
    // "Mudar" abre a gaveta com os destinos daquele aviso marcados.
    await page.click('button[aria-label="Mudar para onde vai: Impressora parada"]');
    await page.waitForSelector('[role="dialog"] >> text=Para onde vai: Impressora parada');
    const marcados = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')].filter((c) => c.checked).map((c) => c.parentElement.textContent.trim()));
    ok(JSON.stringify(marcados) === JSON.stringify(['Tela do Regem na loja', 'WhatsApp do gerente da loja']), `gaveta: abre com a tela e o gerente da escala marcados (${marcados.join(', ')})`);
    ok((await page.locator('[role="dialog"] select').inputValue()) === '5', 'gaveta: o "se ninguém resolver" em 5 min');
    // Sem nenhum destino com o aviso ligado, "Aplicar" trava e diz por quê.
    await page.locator('[role="dialog"] label:has-text("Tela do Regem na loja") input').uncheck();
    ok(await page.locator('[role="dialog"] button:has-text("Aplicar")').isDisabled(), 'gaveta: sem destino, "Aplicar" trava');
    ok(await page.locator('[role="dialog"] [role="alert"]:has-text("Escolha pelo menos um destino")').isVisible(), 'gaveta: e diz por quê');
    await page.locator('[role="dialog"] label:has-text("Tela do Regem na loja") input').check();
    await page.locator('[role="dialog"] label:has-text("KDS da cozinha") input').check();
    await page.click('[role="dialog"] button:has-text("Aplicar")');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentos[1]?.regras?.[0]) === JSON.stringify({ tipo: 'impressora', ligado: true, destinos: ['tela', 'kds'], escalaMin: 5, escalaPara: ['gerente'], parametro: null }), `gaveta: "Aplicar" leva para a barra e salvar manda os destinos novos (${JSON.stringify(S.salvamentos[1])})`);
    ok(/Vai para:[\s\S]*Tela do Regem na loja[\s\S]*KDS da cozinha/.test(await page.locator('main').innerText()), 'avisos: a linha mostra o KDS depois de salvar');
    // A recusa do servidor aparece com a frase dele.
    S.recusaDosAvisos = 'Escolha quem fica sabendo se ninguém resolver.';
    await page.click('button[role="switch"][aria-label*="A chave de IA parou"]');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    await page.waitForSelector('text=Escolha quem fica sabendo se ninguém resolver.');
    ok(true, 'avisos: a recusa do servidor aparece com a frase dele');
    // Relatórios: ligar o resumo do dia às 22:00 e salvar pela MESMA barra — só a rota dos relatórios, só o que mudou.
    // A recusa da cena anterior deixou uma alteração pendente: descarta antes (a barra é uma só para a tela inteira).
    S.recusaDosAvisos = null;
    await page.click("button:has-text(\"Descartar\")");
    await page.waitForSelector("text=ainda não salva", { state: "detached" });
    const avisosAntes = S.salvamentos.length;
    await page.fill('input[type="time"] >> nth=0', '22:00');
    await page.click('button[role="switch"][aria-label*="Resumo do dia"]');
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/relatorios') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosRel[0]) === JSON.stringify({ relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '22:00', diaSemana: null }] }), `relatórios: salvar manda só o resumo do dia, inteiro (${JSON.stringify(S.salvamentosRel[0])})`);
    ok(S.salvamentos.length === avisosAntes, 'relatórios: salvar só os relatórios não chama a rota dos avisos');
    await page.waitForSelector('text=Relatórios do Mister salvos.');
    // O resumo da semana: o dia e o horário.
    await page.getByLabel('Dia do resumo da semana').selectOption('7');
    await page.click('button[role="switch"][aria-label*="Resumo da semana"]');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/relatorios') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosRel[1]) === JSON.stringify({ relatorios: [{ tipo: 'resumo_semana', ligado: true, hora: '09:00', diaSemana: 7 }] }), `relatórios: o resumo da semana no domingo (${JSON.stringify(S.salvamentosRel[1])})`);
    ok(erros.length === 0, `avisos: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister?parte=avisos', avisosFalha: true });
    await page.waitForSelector('text=Não consegui ler os avisos agora', { timeout: 20000 });
    S.avisosFalha = false;
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('#mister-avisos-titulo');
    ok(true, 'avisos: erro de leitura avisa e "Tentar de novo" lê de novo');
    await ctx.close();
  }
  {
    // O gerente não entra nos avisos: vê Pessoas e nem chama a rota.
    const { ctx, page, S } = await abrir(1280, 900, { token: GERENTE, caminho: '/mister?parte=avisos', souPresidente: false, pessoas: PESSOAS.slice(0, 1) });
    await page.waitForTimeout(1500);
    ok(!S.doMister.some((x) => x.p === '/mister/avisos'), 'avisos: o gerente não chama a rota dos avisos');
    ok(!(await page.locator('#mister-avisos-titulo').count()), 'avisos: o gerente não vê a parte dos avisos');
    await ctx.close();
  }

  // ── cada largura, AVISOS: a página e a gaveta inteiras, sem barra lateral, e o texto das linhas sem espremer ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister?parte=avisos' });
    await page.waitForSelector('#mister-avisos-titulo', { timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: Avisos — sem barra lateral e com toque grande (${m.join(' | ')})`);
    const espremido = await page.evaluate(() =>
      [...document.querySelectorAll('main span')].filter((s) => /^Uma impressora deixou|^Problemas técnicos do servidor/.test(s.textContent ?? '') && s.getBoundingClientRect().width < 180).map((s) => Math.round(s.getBoundingClientRect().width)),
    );
    ok(espremido.length === 0, `${w}px: Avisos — a descrição não fica espremida (${espremido.join(', ')} px)`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-avisos.png`), fullPage: true });
    if (w === 320 || w === 375 || w === 1440) {
      // O cartão dos relatórios (V45: a página inteira não rola o Shell — a foto é do cartão, depois de rolar até ele).
      const cartao = page.locator("div:has(> div > h3:text-is(\"Relatórios\"))").first();
      await cartao.scrollIntoViewIfNeeded();
      await cartao.screenshot({ path: foto(`${w}-relatorios.png`) });
    }
    await page.locator('button:has-text("Mudar") >> visible=true').nth(5).click();
    await page.waitForSelector('[role="dialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta "Para onde vai" inteira na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-avisos-gaveta.png') });
    ok(erros.length === 0, `${w}px: Avisos sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
