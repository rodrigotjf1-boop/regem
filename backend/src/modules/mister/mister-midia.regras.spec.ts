import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { midiaDaMeta } from './mister-entrada.service';
import {
  MIMES_DO_MISTER_NA_IA,
  TEXTOS_DA_MIDIA,
  instrucoesDaFotoDoMister,
  lerOQueAIaViu,
  linhaDoQueViu,
  midiaNaInstalacao,
  oQueOGraphViu,
  perguntaComFoto,
  tipoAceito,
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
