'use strict';

// O iFOOD FICOU SEM LOGIN — quando a ponte chama quem está no PC (0.7.8, 16/11/2026).
//
// Na loja, em 16/11, o Gestor do iFood dentro da ponte caiu para a tela de login às 18:37 (a renovação do acesso ficou sem
// resposta) e ficou assim mais de duas horas: a ponte só dizia "iFood: entre com o login da loja" no ícone perto do
// relógio, ninguém viu, e o chat do iFood ficou sem resposta. Agora a ponte MOSTRA a janela do iFood (sem tomar o teclado
// de quem está no caixa), pisca na barra de tarefas e solta um aviso do Windows:
//  • quando o login cai (depois de 1 min sem voltar — em queda curta de rede o chat reconecta sozinho);
//  • quando o programa abre e o iFood segue sem login (a sessão venceu com o PC desligado);
//  • de novo a cada 10 min, enquanto seguir sem login (a pessoa pode ter fechado a janela).
// Regra pura (o `main.js` só executa), testável sem abrir o programa.

const CONFIRMAR_MS = 60 * 1000;
const REPETIR_MS = 10 * 60 * 1000;

/**
 * A ponte deve chamar a pessoa para o login do iFood agora? Devolve o motivo, ou null.
 * Nunca chama: em "só observar", sem pareamento, pausada neste PC, ou com a ponte desligada nos ajustes do Regem — aí o
 * login não faz falta a ninguém.
 * @param {{ agora: number, logado: boolean, semLoginDesde: number, chamouEm: number, jaEsteveLogado: boolean,
 *           pareada: boolean, pausada: boolean, ligada: boolean, soObservar: boolean }} e
 *   `semLoginDesde` = desde quando está sem login (a partida do programa ou a queda; 0 = logado);
 *   `chamouEm` = a última vez que chamou (0 = nunca).
 * @returns {null | 'caiu' | 'abriu_sem_login' | 'continua_sem_login'}
 */
function motivoParaChamar(e, { confirmarMs = CONFIRMAR_MS, repetirMs = REPETIR_MS } = {}) {
  if (!e || e.soObservar || !e.pareada || e.pausada || !e.ligada) return null;
  if (e.logado || !(e.semLoginDesde > 0)) return null;
  if (e.agora - e.semLoginDesde < confirmarMs) return null;
  // ainda não chamou por ESTA queda (a chamada de uma queda anterior não conta)
  if (!(e.chamouEm > 0) || e.chamouEm < e.semLoginDesde) return e.jaEsteveLogado ? 'caiu' : 'abriu_sem_login';
  return e.agora - e.chamouEm >= repetirMs ? 'continua_sem_login' : null;
}

/** "há 12 min" / "há 2 h 05 min" — para o aviso que insiste. */
function haQuanto(ms) {
  const min = Math.max(1, Math.floor(ms / 60000));
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

const O_QUE_FAZER = 'Entre com o login da loja na janela "Regem · Ponte do chat" para o chat do iFood voltar a ser respondido.';

/**
 * Os textos de uma chamada: `aviso` (o aviso do Windows) e `registro` (a linha do ícone e do jornal).
 * @param {'caiu' | 'abriu_sem_login' | 'continua_sem_login'} motivo
 * @param {number} semLoginMs há quanto tempo está sem login
 */
function textosDaChamada(motivo, semLoginMs) {
  if (motivo === 'caiu') return { aviso: `O iFood saiu do login neste PC. ${O_QUE_FAZER}`, registro: 'o iFood saiu do login: a janela foi mostrada' };
  if (motivo === 'abriu_sem_login')
    return { aviso: `O iFood está sem login neste PC. ${O_QUE_FAZER}`, registro: 'o iFood abriu sem login: a janela foi mostrada' };
  const quanto = haQuanto(semLoginMs);
  return { aviso: `O iFood segue sem login neste PC ${quanto}. ${O_QUE_FAZER}`, registro: `o iFood segue sem login ${quanto}: a janela foi mostrada de novo` };
}

module.exports = { CONFIRMAR_MS, REPETIR_MS, motivoParaChamar, textosDaChamada, haQuanto };
