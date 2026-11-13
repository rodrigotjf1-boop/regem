// Roteiro de tela do MISTER › IA E USO (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026), com a API simulada.
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
    { recurso: 'mister-investigacao', provedor: 'anthropic', modelo: 'claude-sonnet-5-5', origem: 'lojista', chamadas: 28, falhas: 0, tokens: { entrada: 400_000, cacheEscrita: 500_000, cacheLeitura: 2_500_000, saida: 224_000 }, custoEstimadoUsd: 8.96 },
    { recurso: 'prova', provedor: 'anthropic', modelo: 'modelo-novo', origem: 'lojista', chamadas: 2, falhas: 0, tokens: { entrada: 16, cacheEscrita: 0, cacheLeitura: 0, saida: 32 }, custoEstimadoUsd: null },
  ],
  custoEstimadoUsd: { lojista: 9.069, distribuicao: 0.014 },
  semPreco: ['modelo-novo'],
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('main *, [role="dialog"] *, [role="alertdialog"] *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
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
    const S = { modulo: o.modulo ?? true, estado: o.estado ?? SEM_CHAVE, uso: o.uso === undefined ? USO : o.uso, usoFalha: !!o.usoFalha, recusa: o.recusa ?? null, pedidos: [], modulos: [] };
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
    await page.goto(base + (o.caminho ?? '/mister'));
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

  // ── gerente: área restrita, sem chamada ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: GERENTE });
    await page.waitForSelector('text=Área restrita', { timeout: 20000 });
    ok(S.pedidos.length === 0, `gerente: área restrita e nenhuma chamada às rotas da IA (${S.pedidos.length})`);
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
}
