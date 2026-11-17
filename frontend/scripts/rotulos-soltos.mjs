// O detector do rótulo SOLTO (ERR-510), usado pela conferência `check-rotulos.mjs`. Um rótulo (<Label> ou <label>) é
// solto quando não tem `htmlFor`, não tem `id` (o nome de um grupo por aria-labelledby), não repassa as props
// (`{...props}`, um componente de rótulo) e não envolve um controle (input, select, textarea, Input…).
// Uso avulso: node scripts/rotulos-soltos.mjs <arquivo.tsx> [...]  → lista as linhas dos soltos.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// O que conta como controle quando está DENTRO do rótulo (o <label> envolvendo liga sozinho). `button` é elemento
// rotulável no HTML (o <label> que envolve a chave feita de botão dá o nome a ela).
export const CONTROLES = new Set(['input', 'select', 'textarea', 'button', 'Input', 'InputMoeda', 'Textarea', 'Select', 'Checkbox', 'Switch', 'Chave', 'Button']);

/** Os rótulos soltos de um fonte .tsx: [{ linha, texto }]. */
export function rotulosSoltos(texto, nome = 'x.tsx') {
  const sf = ts.createSourceFile(nome, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados = [];
  const temControle = (no) => {
    let achou = false;
    const ver = (n) => {
      if (achou) return;
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && CONTROLES.has(n.tagName.getText(sf))) achou = true;
      else ts.forEachChild(n, ver);
    };
    ts.forEachChild(no, ver);
    return achou;
  };
  const visitar = (no) => {
    const abertura = ts.isJsxElement(no) ? no.openingElement : ts.isJsxSelfClosingElement(no) ? no : null;
    if (abertura && ['Label', 'label'].includes(abertura.tagName.getText(sf))) {
      const attrs = abertura.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf));
      // `id` no rótulo: ele é o nome de um grupo ou campo por `aria-labelledby` (o grupo do `Campo`); `aria-hidden`: é
      // espaçador de alinhamento, sem texto, fora da leitura (o `<label>&nbsp;</label>` da conta do cardápio)
      const ligado = attrs.includes('htmlFor') || attrs.includes('id') || attrs.includes('aria-hidden') || (ts.isJsxElement(no) && temControle(no));
      // `{...props}` repassa o htmlFor de quem usa (um componente de rótulo): não dá para saber daqui
      const repassa = abertura.attributes.properties.some(ts.isJsxSpreadAttribute);
      if (!ligado && !repassa) {
        const { line } = sf.getLineAndCharacterOfPosition(no.getStart(sf));
        achados.push({ linha: line + 1, texto: no.getText(sf).replace(/\s+/g, ' ').slice(0, 80) });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return achados;
}

/**
 * Os rótulos com `htmlFor` FIXO (texto literal) dentro de um laço (`.map(...)`): cada item repete o mesmo id, e o rótulo
 * de todos aponta para o primeiro campo. Dentro de laço o id leva o item (`htmlFor={`x-${i}`}`). [{ linha, texto }]
 */
export function idFixoEmLaco(texto, nome = 'x.tsx') {
  const sf = ts.createSourceFile(nome, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados = [];
  const emLaco = (no) => {
    for (let p = no.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === 'map') return true;
    }
    return false;
  };
  const visitar = (no) => {
    const abertura = ts.isJsxElement(no) ? no.openingElement : ts.isJsxSelfClosingElement(no) ? no : null;
    if (abertura && ['Label', 'label'].includes(abertura.tagName.getText(sf))) {
      const para = abertura.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'htmlFor');
      if (para?.initializer && ts.isStringLiteral(para.initializer) && emLaco(no)) {
        const { line } = sf.getLineAndCharacterOfPosition(no.getStart(sf));
        achados.push({ linha: line + 1, texto: no.getText(sf).replace(/\s+/g, ' ').slice(0, 80) });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return achados;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const arq of process.argv.slice(2)) {
    const texto = readFileSync(arq, 'utf8');
    const s = rotulosSoltos(texto, arq);
    const l = idFixoEmLaco(texto, arq);
    console.log(`${arq}: ${s.length}${l.length ? ` · ${l.length} com id fixo em laço` : ''}`);
    for (const r of s) console.log(`  linha ${r.linha}: ${r.texto}`);
    for (const r of l) console.log(`  linha ${r.linha} (id fixo em laço): ${r.texto}`);
  }
}
