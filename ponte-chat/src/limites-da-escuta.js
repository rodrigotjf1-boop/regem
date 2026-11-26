'use strict';

// A ESCUTA DA REDE SEM GUARDAR TUDO (0.7.9). `Network.enable` sem limites faz o Chromium guardar o corpo de TODA resposta da
// página — scripts, imagens e as chamadas que o Gestor faz a cada poucos segundos — enquanto a escuta está ligada: memória
// e trabalho à toa num PC fraco (medido em 25/11/2026 no servidor da loja, um i5 650: a página do Gestor com 414 MB e a
// ponte inteira com 1,15 GB). A ponte só lê o corpo das respostas JSON do histórico do chat e das chamadas que o diagnóstico
// acompanha, logo que terminam, e recusa o que passa de 2 MB (`corpo_fora`): 3 MB por resposta e 16 MB no total bastam.
const LIMITES_DA_ESCUTA = Object.freeze({ maxTotalBufferSize: 16 * 1024 * 1024, maxResourceBufferSize: 3 * 1024 * 1024 });

module.exports = { LIMITES_DA_ESCUTA };
