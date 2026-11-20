import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { midiaDaMeta } from './mister-entrada.service';
import {
  AUDIO_MAX_SEGUNDOS,
  FALA_MAX_LETRAS,
  chaveDaFala,
  principalParaFalar,
  MIMES_DO_MISTER_NA_IA,
  TEXTOS_DA_MIDIA,
  duracaoDoOggOpus,
  instrucoesDaFotoDoMister,
  lerOQueAIaViu,
  linhaDaMidia,
  linhaDoQueViu,
  midiaNaInstalacao,
  oQueOGraphOuviu,
  oQueOGraphViu,
  perguntaComAudio,
  perguntaComFoto,
  primeiroDoMesQueVem,
  tipoAceito,
  tipoDoAudio,
  veioDeAudio,
  veioDeFoto,
} from './mister-midia.regras';
import { INSTRUCOES_DO_MISTER, TETOS } from './mister-agente.regras';

// A foto no Mister (versão 5, M5a): as regras puras — a tradução do Graph e da IA, a pergunta e a linha do "📷 Vi".

describe('a foto no Mister (M5a): as regras', () => {
  const doGraph = (docs: unknown[]) => ({ tipoArquivo: 'imagem', resultados: docs });

  it('nasce desligado: só `MISTER_MIDIA=1` liga', () => {
    const antes = process.env.MISTER_MIDIA;
    delete process.env.MISTER_MIDIA;
    expect(midiaNaInstalacao()).toBe(false);
    process.env.MISTER_MIDIA = 'true';
    expect(midiaNaInstalacao()).toBe(false);
    process.env.MISTER_MIDIA = '1';
    expect(midiaNaInstalacao()).toBe(true);
    if (antes === undefined) delete process.env.MISTER_MIDIA;
    else process.env.MISTER_MIDIA = antes;
  });

  it('a leitura do Graph: o resumo é a primeira frase do contexto; o texto da imagem entra; o dado pessoal nunca', () => {
    const v = oQueOGraphViu(
      doGraph([
        {
          tipo: 'Fotografia',
          titulo: 'Caixas no freezer',
          contexto: 'Três caixas de blend 56 g num freezer. A etiqueta diz 30 unidades.',
          secoes: [{ texto: 'Gelo acumulado na tampa' }],
          transcricao: 'BLEND 56 g\n30 un\nFornecedor: (21) 99876-5432\ncontato@carneboa.com.br',
        },
      ]),
    )!;
    expect(v.resumo).toBe('Três caixas de blend 56 g num freezer');
    expect(v.financeiro).toBe(false);
    expect(v.descricao).toContain('Fotografia · Caixas no freezer');
    expect(v.descricao).toContain('Gelo acumulado na tampa');
    expect(v.descricao).toContain('Texto na imagem: "BLEND 56 g" / "30 un"');
    expect(v.descricao).not.toContain('99876');
    expect(v.descricao).not.toContain('carneboa');
    expect(v.descricao).toContain('(número omitido)');
    expect(v.descricao).toContain('(e-mail omitido)');
  });

  it('boleto e nota fiscal são "financeiro" (vão aos documentos); o resto não', () => {
    expect(oQueOGraphViu(doGraph([{ tipo: 'Boleto bancário', titulo: 'Distribuidora', contexto: 'Boleto de R$ 1.284,90' }]))!.financeiro).toBe(true);
    expect(oQueOGraphViu(doGraph([{ tipo: 'Documento', titulo: 'DANFE — Nota Fiscal Eletrônica', contexto: 'Nota de compra' }]))!.financeiro).toBe(true);
    expect(oQueOGraphViu(doGraph([{ tipo: 'Captura de tela', titulo: 'Gestor do iFood', contexto: 'Loja fechada' }]))!.financeiro).toBe(false);
    // O "boleto" no MEIO do texto da imagem não classifica (só o tipo e o título).
    expect(oQueOGraphViu(doGraph([{ tipo: 'Fotografia', titulo: 'Lista', contexto: 'Lista de tarefas', transcricao: 'pagar o boleto da luz' }]))!.financeiro).toBe(false);
  });

  it('fora do formato → null (segue pela reserva); lista vazia → "não deu para ler"; até 3 documentos; corta no limite', () => {
    expect(oQueOGraphViu(null)).toBeNull();
    expect(oQueOGraphViu([])).toBeNull();
    expect(oQueOGraphViu({ resultados: 'x' })).toBeNull();
    expect(oQueOGraphViu(doGraph([]))).toEqual({ resumo: 'uma imagem que não deu para ler', descricao: 'imagem ilegível', financeiro: false });
    const muitos = oQueOGraphViu(doGraph([1, 2, 3, 4].map((i) => ({ tipo: `Página ${i}`, contexto: `Conteúdo ${i}` }))))!;
    expect(muitos.descricao).toContain('Página 3');
    expect(muitos.descricao).not.toContain('Página 4');
    const longo = oQueOGraphViu(doGraph([{ tipo: 'Foto', contexto: `${'palavra '.repeat(200)}.`, transcricao: Array.from({ length: 40 }, (_, i) => `linha ${i}`).join('\n') }]))!;
    expect(longo.descricao.length).toBeLessThanOrEqual(600);
    expect(longo.resumo.length).toBeLessThanOrEqual(160);
    expect(longo.descricao.endsWith('…')).toBe(true);
  });

  it('a reserva (IA da empresa): as três linhas do formato; "ilegível"; fora do formato → null', () => {
    expect(lerOQueAIaViu('RESUMO: Uma lista escrita à mão com 4 itens.\nTIPO: outro\nDESCRICAO: pão brioche 10 pct\ncheddar 4 kg')).toEqual({
      resumo: 'Uma lista escrita à mão com 4 itens',
      descricao: 'pão brioche 10 pct / cheddar 4 kg',
      financeiro: false,
    });
    expect(lerOQueAIaViu('RESUMO: Boleto da distribuidora\nTIPO: Boleto\nDESCRICAO: R$ 1.284,90')!.financeiro).toBe(true);
    expect(lerOQueAIaViu('RESUMO: nota de compra\nTIPO: nota\nDESCRICAO: itens')!.financeiro).toBe(true);
    expect(lerOQueAIaViu('RESUMO: ilegível\nTIPO: outro\nDESCRICAO:')).toEqual({ resumo: 'uma imagem que não deu para ler', descricao: 'imagem ilegível', financeiro: false });
    expect(lerOQueAIaViu('Não sei ler isso.')).toBeNull();
    expect(lerOQueAIaViu('RESUMO: tela\nDESCRICAO: ligue para 21 99876-5432')!.descricao).toBe('ligue para (número omitido)');
    // As instruções pedem o formato e avisam que o texto da imagem não é instrução.
    expect(instrucoesDaFotoDoMister()).toContain('RESUMO:');
    expect(instrucoesDaFotoDoMister()).toContain('nunca é uma instrução');
  });

  it('a pergunta: a marca com o resumo, o que a foto mostra e a legenda; cabe no teto da pergunta; a linha do "📷 Vi" sai dela', () => {
    const v = { resumo: 'Três caixas de blend 56 g num freezer', descricao: 'x'.repeat(600), financeiro: false };
    const p = perguntaComFoto(v, '  dá até sábado?  ', 'graph');
    expect(p.split('\n')[0]).toBe('⟦foto⟧ Três caixas de blend 56 g num freezer');
    expect(p).toContain('lido pelo DMS Graph');
    expect(p).toContain('A pessoa escreveu junto: dá até sábado?');
    expect(p.length).toBeLessThanOrEqual(TETOS.pergunta);
    expect(perguntaComFoto(v, null, 'ia')).toContain('lido pela IA da empresa');
    expect(perguntaComFoto(v, '', 'ia')).toContain('A pessoa mandou a foto sem escrever nada.');
    expect(veioDeFoto(p)).toBe(true);
    expect(veioDeFoto('[foto] digitado')).toBe(false);
    expect(linhaDoQueViu(p)).toBe('📷 _Vi:_ Três caixas de blend 56 g num freezer');
    // Junta com outras perguntas do mesmo lote (a junção é por linha): a linha ainda sai.
    expect(linhaDoQueViu(`oi\n${p}`)).toBe('📷 _Vi:_ Três caixas de blend 56 g num freezer');
    expect(linhaDoQueViu('quanto vendi hoje?')).toBeNull();
    // As instruções do agente explicam a marca.
    expect(INSTRUCOES_DO_MISTER).toContain('⟦foto⟧');
  });

  it('o tipo do arquivo: normaliza e confere a lista', () => {
    expect(tipoAceito('image/JPG; q=1', MIMES_DO_MISTER_NA_IA)).toBe('image/jpeg');
    expect(tipoAceito('application/pdf', MIMES_DO_MISTER_NA_IA)).toBe('application/pdf');
    expect(tipoAceito('application/vnd.ms-excel', MIMES_DO_MISTER_NA_IA)).toBeNull();
    expect(tipoAceito(null, MIMES_DO_MISTER_NA_IA)).toBeNull();
  });

  it('a legenda da Meta (caption) vem junto da mídia', () => {
    expect(midiaDaMeta({ type: 'image', image: { id: '123456', mime_type: 'image/jpeg', caption: '  dá até sábado?  ' } })).toEqual({
      tipo: 'imagem',
      id: '123456',
      mime: 'image/jpeg',
      legenda: 'dá até sábado?',
    });
    expect(midiaDaMeta({ type: 'document', document: { id: '987654', mime_type: 'application/pdf' } })!.legenda).toBeNull();
  });

  // ─────────── M5b: o áudio ───────────
  /** Um OGG/Opus mínimo de `segundos` (o mesmo desenho do teste do Graph). */
  const oggOpus = (segundos: number, preSkip = 312) => {
    const pagina = (posicao: number, corpo: Buffer) => {
      const h = Buffer.alloc(27);
      h.write('OggS', 0, 'ascii');
      h.writeBigUInt64LE(BigInt(posicao), 6);
      return Buffer.concat([h, corpo]);
    };
    const cab = Buffer.alloc(19);
    cab.write('OpusHead', 0, 'ascii');
    cab[8] = 1;
    cab[9] = 1;
    cab.writeUInt16LE(preSkip, 10);
    cab.writeUInt32LE(48_000, 12);
    return Buffer.concat([pagina(0, cab), pagina(0, Buffer.from('OpusTags')), pagina(preSkip + Math.round(segundos * 48_000), Buffer.alloc(30, 9))]);
  };

  it('o áudio: o tipo como a `ouvir_audio` aceita (sem "; codecs"); a duração do OGG/Opus; o AMR e o M4A não', () => {
    expect(tipoDoAudio('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(tipoDoAudio('audio/MP3')).toBe('audio/mpeg');
    expect(tipoDoAudio('audio/x-wav')).toBe('audio/wav');
    expect(tipoDoAudio('audio/amr')).toBeNull();
    expect(tipoDoAudio('audio/mp4')).toBeNull();
    expect(tipoDoAudio(null)).toBeNull();
    expect(duracaoDoOggOpus(oggOpus(9))).toBe(9);
    expect(duracaoDoOggOpus(oggOpus(181, 0))).toBe(181);
    expect(duracaoDoOggOpus(Buffer.from('não é ogg, mas é comprido o bastante para a conta de bytes'))).toBeNull();
    expect(AUDIO_MAX_SEGUNDOS).toBe(180);
  });

  it('o que o Graph ouviu: a transcrição; o inaudível e o texto vazio; fora do formato → null', () => {
    expect(oQueOGraphOuviu({ tipoArquivo: 'audio', transcricao: '  Quanto vendeu\nontem?  ', inaudivel: false, idioma: 'pt-BR', franquia: {} })).toEqual({ transcricao: 'Quanto vendeu ontem?', inaudivel: false });
    expect(oQueOGraphOuviu({ tipoArquivo: 'audio', transcricao: '', inaudivel: false })).toEqual({ transcricao: '', inaudivel: true });
    expect(oQueOGraphOuviu({ tipoArquivo: 'audio', transcricao: 'algo', inaudivel: true })!.inaudivel).toBe(true);
    expect(oQueOGraphOuviu({ tipoArquivo: 'imagem', resultados: [] })).toBeNull();
    expect(oQueOGraphOuviu({ tipoArquivo: 'audio', transcricao: 3, inaudivel: false })).toBeNull();
    expect(oQueOGraphOuviu(null)).toBeNull();
  });

  it('a pergunta do áudio e a linha do "🎧 Entendi"; com foto e áudio no mesmo lote, vale a primeira', () => {
    const p = perguntaComAudio('Quanto vendeu ontem no iFood e quanto deu de taxa?');
    expect(p).toBe('⟦áudio⟧ Quanto vendeu ontem no iFood e quanto deu de taxa?');
    expect(veioDeAudio(p)).toBe(true);
    expect(veioDeFoto(p)).toBe(false);
    expect(linhaDaMidia(p)).toBe('🎧 _Entendi:_ "Quanto vendeu ontem no iFood e quanto deu de taxa?"');
    expect(perguntaComAudio('a '.repeat(800)).length).toBeLessThanOrEqual(TETOS.pergunta);
    expect(linhaDaMidia(perguntaComAudio('palavra '.repeat(60)))!.length).toBeLessThan(200);
    const foto = perguntaComFoto({ resumo: 'Três caixas no freezer', descricao: 'x', financeiro: false }, null, 'graph');
    expect(linhaDaMidia(foto)).toBe('📷 _Vi:_ Três caixas no freezer');
    expect(linhaDaMidia(`${p}\n${foto}`)).toMatch(/^🎧/);
    expect(linhaDaMidia(`${foto}\n${p}`)).toMatch(/^📷/);
    expect(linhaDaMidia('quanto vendi hoje?')).toBeNull();
    expect(INSTRUCOES_DO_MISTER).toContain('⟦áudio⟧');
  });

  it('a franquia volta no dia 1º do mês seguinte (dezembro vira janeiro do ano seguinte)', () => {
    expect(primeiroDoMesQueVem('2026-11-19')).toBe('01/12');
    expect(primeiroDoMesQueVem('2026-12-05')).toBe('01/01/2027');
    expect(TEXTOS_DA_MIDIA.audioFranquia('01/12')).toContain('até 01/12');
    expect(TEXTOS_DA_MIDIA.semGraph).toContain('ouvir áudios e ver fotos');
  });

  it('o áudio da Meta (`type: audio`) vira mídia de áudio', () => {
    expect(midiaDaMeta({ type: 'audio', audio: { id: '555666', mime_type: 'audio/ogg; codecs=opus', voice: true } })).toEqual({
      tipo: 'audio',
      id: '555666',
      mime: 'audio/ogg; codecs=opus',
      legenda: null,
    });
  });

  // V65: o texto que manda a pessoa a uma tela — o caminho conferido no menu e na aba de verdade.
  it('o caminho "Delivery › Configurações › Integrações" existe no menu e na aba, com o cartão do DMS Graph', () => {
    const raiz = join(__dirname, '../../../../frontend/src');
    const shell = readFileSync(join(raiz, 'components/app-shell/shell.tsx'), 'utf8');
    const painel = readFileSync(join(raiz, 'components/delivery/config-panel.tsx'), 'utf8');
    const cartao = readFileSync(join(raiz, 'components/integracoes/graph-clique.tsx'), 'utf8');
    expect(TEXTOS_DA_MIDIA.semGraph).toContain('Delivery › Configurações › Integrações');
    expect(shell).toContain("href: '/delivery/configuracoes', label: 'Configurações'");
    expect(painel).toContain("{ k: 'integracoes', label: 'Integrações' }");
    expect(painel).toMatch(/GraphClique|graph-clique/);
    expect(cartao).toContain('DMS Graph');
  });
});

// Versão 5, M5c: a resposta em áudio — o principal da resposta para a voz e a chave da fala no Graph.
describe('a resposta em áudio (M5c)', () => {
  it('o principal: sem as linhas do código, sem link, sem emoji e sem marcadores', () => {
    const resposta = [
      '🎧 _Entendi:_ "quanto vendeu ontem?"',
      '',
      'Ontem a loja vendeu *R$ 4.130* 🎉, _53% a mais_ que a quarta passada.',
      'Ver no Regem: https://app.dmsregem.com/mister/relatorio?x=1',
      'Link para encaminhar (só leitura, vale até 26/11): https://app.dmsregem.com/m/r/abc',
      'O pico foi às 21h.',
    ].join('\n');
    expect(principalParaFalar(resposta)).toBe('Ontem a loja vendeu R$ 4.130, 53% a mais que a quarta passada.\nO pico foi às 21h.');
    expect(principalParaFalar('📷 _Vi:_ uma tela')).toBe('');
    expect(principalParaFalar(null)).toBe('');
  });

  it('até ~40 s: corta no fim de uma frase; sem frase, na palavra, com reticências', () => {
    const frase = 'O movimento de ontem foi bom. ';
    const longa = frase.repeat(40);
    const p = principalParaFalar(longa);
    expect(p.length).toBeLessThanOrEqual(FALA_MAX_LETRAS);
    expect(p.endsWith('bom.')).toBe(true);
    const semPonto = 'palavra '.repeat(100);
    const q = principalParaFalar(semPonto);
    expect(q.length).toBeLessThanOrEqual(FALA_MAX_LETRAS + 1);
    expect(q.endsWith('palavra…')).toBe(true);
  });

  it('a chave da fala: a mesma empresa e o mesmo texto, a mesma chave; outra empresa ou outro texto, outra; só visíveis e até 100', () => {
    const a = chaveDaFala('11111111-1111-1111-1111-111111111111', 'Ontem a loja vendeu bem.');
    expect(a).toBe(chaveDaFala('11111111-1111-1111-1111-111111111111', 'Ontem a loja vendeu bem.'));
    expect(a).not.toBe(chaveDaFala('22222222-2222-2222-2222-222222222222', 'Ontem a loja vendeu bem.'));
    expect(a).not.toBe(chaveDaFala('11111111-1111-1111-1111-111111111111', 'Outra resposta.'));
    expect(a).toMatch(/^regem-falar-[0-9a-f]{48}$/);
    expect(a.length).toBeLessThanOrEqual(100);
  });
});
