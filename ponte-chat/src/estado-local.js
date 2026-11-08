'use strict';

// O ESTADO DA PONTE NESTE PC, num lugar só (peça 6 do protótipo de conexão, "a janela da ponte" e "o ícone do Regem"):
//  • o RESUMO — o que a janela "Estado da ponte" mostra e o que vai para o arquivo `estado-da-ponte.json` (na pasta de dados
//    do programa). O arquivo é o canal com o ícone "Regem neste PC" do mesmo PC: ele lê a linha da ponte dali e, para
//    pausar, retomar ou abrir, chama este programa com `--pausar`, `--retomar` ou `--abrir` (o Windows entrega o pedido ao
//    programa que já está aberto — uma ponte por PC). Nada de segredo no arquivo: nem o segredo do pareamento, nem texto
//    de conversa;
//  • os TEXTOS da janela (`paraAJanela`), para a regra ficar testável sem abrir o programa;
//  • os COMANDOS da linha de comando (`comandoDe`).

const fs = require('fs');
const path = require('path');

const ARQUIVO = 'estado-da-ponte.json';

/** O comando que veio na linha de comando (o 1º que valer) — ou null. */
function comandoDe(argv) {
  const lista = Array.isArray(argv) ? argv.map(String) : [];
  for (const a of lista) {
    if (a === '--pausar') return 'pausar';
    if (a === '--retomar') return 'retomar';
    if (a === '--abrir') return 'estado';
    if (a === '--abrir-ifood') return 'abrir-ifood';
  }
  return null;
}

/** "14:32" no relógio deste PC (sem data; a janela é de agora). */
function hora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const NUVEM = {
  ok: 'conectado',
  aguardando: 'falando com a nuvem…',
  rede: 'sem conexão com a nuvem — tentando de novo',
  servidor: 'a nuvem falhou — tentando de novo',
  limite: 'muitas chamadas — esperando um pouco',
  nao_reconhecido: 'o Regem não reconheceu este PC — tentando de novo',
  revogado: 'a ponte deste PC foi revogada — pareie de novo',
  recusado: 'a nuvem recusou o pedido',
};

/**
 * O resumo do estado (o que a janela e o arquivo levam). `e` é o estado do programa; o resto vem de fora para o teste
 * montar sem Electron.
 */
function resumo(e, o = {}) {
  return {
    versao: o.versao || null,
    maquina: o.maquina || null,
    pareada: !!o.pareada,
    nome: o.nome || null,
    soObservar: !!o.soObservar,
    pausadaEm: o.pausadaEm || null,
    ligada: !!e.ligada,
    papel: e.papel || 'fora',
    nuvem: e.nuvem || 'aguardando',
    ifood: { logado: !!e.logadoNoIfood },
    // a 99: lida neste PC? logada? responde por ela (4b — "Responder pela 99 neste PC") e o papel de agora
    n99: { usar: !!o.usar99, logado: !!e.logadoNa99, responder: !!o.responder99, papel: e.papel99 || 'fora' },
    lidas: Number(e.enviadas) || 0,
    saida: o.saida ? { situacao: String(o.saida.situacao || ''), enviadas: Number(o.saida.enviadas) || 0 } : null,
    saida99: o.saida99 ? { situacao: String(o.saida99.situacao || ''), enviadas: Number(o.saida99.enviadas) || 0 } : null,
    ultimoAviso: e.ultimoErro || null,
    // para o ícone do Regem abrir/pausar/retomar ESTE programa (o caminho do executável e, no modo de teste, a pasta)
    abrir: o.abrir || null,
    atualizadoEm: (o.agora || new Date()).toISOString(),
  };
}

/** A 99 do resumo (um resumo antigo, gravado antes da 4a, não tem). */
const n99 = (r) => (r && r.n99 && typeof r.n99 === 'object' ? r.n99 : { usar: false, logado: false, responder: false, papel: 'fora' });

/** O selo do topo da janela: a palavra e o tom (ok | aviso | neutro). */
function selo(r) {
  if (r.soObservar) return { tom: 'neutro', texto: 'só observando' };
  if (!r.pareada) return { tom: 'aviso', texto: 'falta parear' };
  if (r.pausadaEm) return { tom: 'aviso', texto: 'pausada neste PC' };
  if (r.nuvem === 'revogado') return { tom: 'aviso', texto: 'revogada' };
  if (r.nuvem !== 'ok') return { tom: 'aviso', texto: 'sem a nuvem' };
  if (!r.ligada) return { tom: 'neutro', texto: 'desligada nos ajustes' };
  if (!r.ifood.logado) return { tom: 'aviso', texto: 'iFood sem login' };
  if (r.papel === 'responde') return { tom: 'ok', texto: 'responde o chat' };
  if (r.papel === 'reserva') return { tom: 'ok', texto: 'reserva' };
  return { tom: 'neutro', texto: 'no ar' };
}

/**
 * O que a janela "Estado da ponte" mostra: o selo, UMA faixa com o que fazer agora (ou nenhuma), os pares rótulo/valor e
 * os botões. Os nomes dos botões são os do menu do ícone (as telas do Regem citam "Retomar a ponte neste PC" — V65).
 */
function paraAJanela(r) {
  let faixa = null;
  if (r.soObservar) faixa = { tom: 'neutro', texto: 'Modo só observar: a ponte não fala com o Regem (diagnóstico ligado).', acao: null };
  else if (!r.pareada) faixa = { tom: 'aviso', texto: 'Falta parear este PC com o Regem.', acao: 'parear' };
  else if (r.pausadaEm)
    faixa = {
      tom: 'aviso',
      texto: `A ponte está pausada neste PC desde ${hora(r.pausadaEm)}: não lê nem responde o chat. A reserva, se houver, assume.`,
      acao: 'retomar',
    };
  else if (r.nuvem === 'revogado') faixa = { tom: 'aviso', texto: 'A ponte deste PC foi revogada no Regem. Pareie de novo com um código novo.', acao: 'parear' };
  else if (r.nuvem === 'ok' && !r.ligada)
    faixa = {
      tom: 'neutro',
      texto: 'A ponte está desligada nos ajustes do Regem (Delivery › Configurações › Atendimento): nada do chat vai ao Regem.',
      acao: null,
    };
  else if (r.nuvem === 'ok' && !r.ifood.logado)
    faixa = { tom: 'aviso', texto: 'O iFood está sem login neste PC. Abra o iFood e entre com o login da loja.', acao: 'abrir-ifood' };
  else if (r.nuvem === 'ok' && n99(r).usar && !n99(r).logado)
    faixa = {
      tom: 'aviso',
      // 0.7.3 (decisão do dono, 08/11/2026): a CONTA PRINCIPAL — o usuário extra da 99 tem conversas próprias e não recebe o
      // chat dos clientes (medido em 07/11). A 99 aceita um login por conta (ERR-365): a 99 fica aberta SÓ aqui.
      texto: 'A 99 está sem login neste PC. Abra a 99 e entre com a CONTA PRINCIPAL da loja (é com ela que o cliente conversa). A 99 aceita um login por conta: deixe a 99 aberta só aqui — entrar em outro aparelho derruba esta.',
      acao: 'abrir-99',
    };

  const ifood = r.ifood.logado
    ? `logado${r.ligada && !r.pausadaEm ? (r.papel === 'responde' ? ' · este PC responde o chat' : r.papel === 'reserva' ? ' · reserva (assume se a outra parar)' : '') : ''}`
    : 'sem login';
  const papel99 = n99(r).papel === 'responde' ? ' · este PC responde o chat' : n99(r).papel === 'reserva' ? ' · reserva' : '';
  const da99 = !n99(r).usar
    ? 'não é lida neste PC (para ler o chat dela: Abrir a 99, com a conta principal da loja)'
    : !n99(r).logado
      ? 'sem login — entre com a conta principal da loja'
      : n99(r).responder
        ? `logada · lê e RESPONDE o chat${r.ligada && !r.pausadaEm ? papel99 : ''}`
        : 'logada · só LÊ o chat (as mensagens entram no Atendimento; responda pelo portal da 99 — ou ligue "Responder pela 99 neste PC")';
  const pares = [
    ['Regem', r.soObservar ? 'não fala com a nuvem (só observando)' : !r.pareada ? 'falta parear' : `${NUVEM[r.nuvem] || r.nuvem}${r.nuvem === 'ok' && r.nome ? ` · ${r.nome}` : ''}`],
    ['iFood', ifood],
    ['99Food', da99],
    ['Mensagens', `${r.lidas} levada${r.lidas === 1 ? '' : 's'} ao Regem desde que o programa abriu`],
  ];
  if (r.saida) pares.push(['Fila de saída', `${r.saida.situacao || '—'} · ${r.saida.enviadas} enviada${r.saida.enviadas === 1 ? '' : 's'} por este PC`]);
  if (r.saida99) pares.push(['Fila de saída da 99', `${r.saida99.situacao || '—'} · ${r.saida99.enviadas} enviada${r.saida99.enviadas === 1 ? '' : 's'} por este PC`]);
  if (r.ultimoAviso) pares.push(['Último aviso', String(r.ultimoAviso)]);

  const botoes = [{ acao: 'abrir-ifood', texto: 'Abrir o iFood' }];
  if (!r.soObservar) botoes.push({ acao: 'abrir-99', texto: 'Abrir a 99' });
  // os nomes são os do menu do ícone
  if (n99(r).usar && r.pareada && !r.soObservar)
    botoes.push(n99(r).responder ? { acao: 'so-ler-99', texto: 'Só ler a 99 (parar de responder)' } : { acao: 'responder-99', texto: 'Responder pela 99 neste PC' });
  if (n99(r).usar && !r.soObservar) botoes.push({ acao: 'parar-99', texto: 'Parar de ler a 99 neste PC' });
  if (r.pareada && !r.soObservar) botoes.push(r.pausadaEm ? { acao: 'retomar', texto: 'Retomar a ponte neste PC' } : { acao: 'pausar', texto: 'Pausar a ponte neste PC' });
  if (!r.pareada && !r.soObservar) botoes.push({ acao: 'parear', texto: 'Parear este PC' });
  botoes.push({ acao: 'atendimento', texto: 'Abrir o Atendimento' });

  return { titulo: 'Ponte do chat', sub: [r.maquina, r.nome].filter(Boolean).join(' · '), selo: selo(r), faixa, pares, botoes, versao: r.versao };
}

/** O endereço da tela Atendimento do Regem (o app na nuvem; `REGEM_PONTE_APP` troca no teste). */
function enderecoDoAtendimento(env = process.env) {
  const base = String(env.REGEM_PONTE_APP || '').trim() || 'https://app.dmsregem.com';
  return `${base.replace(/\/+$/, '')}/atendimento`;
}

/** Grava o resumo de uma vez (nunca meio arquivo: o ícone do Regem pode ler a qualquer hora). */
function gravar(pasta, r) {
  const arq = path.join(pasta, ARQUIVO);
  fs.mkdirSync(pasta, { recursive: true });
  const tmp = `${arq}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2));
  fs.renameSync(tmp, arq);
  return arq;
}

module.exports = { ARQUIVO, comandoDe, resumo, paraAJanela, selo, hora, enderecoDoAtendimento, gravar };
