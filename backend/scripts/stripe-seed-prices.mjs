// Cria/atualiza os preços dos planos no Stripe (G-6b). Rode UMA vez (e a cada
// mudança de preço). Usa lookup_keys (ex.: completo_mensal) — o checkout resolve
// por eles, então nada de IDs pra colar no código.
//
// Uso (PowerShell):  $env:STRIPE_SECRET_KEY="sk_test_..."; node scripts/stripe-seed-prices.mjs
// Uso (bash):        STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-seed-prices.mjs
//
// IMPORTANTE: mantenha os valores abaixo iguais aos de src/modules/licenca/planos.ts.
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Defina STRIPE_SECRET_KEY (use a de TESTE: sk_test_...).');
  process.exit(1);
}
const stripe = new Stripe(key);

const PLANOS = [
  { chave: 'balcao', nome: 'Regem · Balcão', mensal: 129, semestral: 116, anual: 103 },
  { chave: 'salao', nome: 'Regem · Salão', mensal: 199, semestral: 179, anual: 159 },
  { chave: 'completo', nome: 'Regem · Completo', mensal: 299, semestral: 269, anual: 239 },
];

// Valor exibido é POR MÊS; o Stripe cobra o total do período.
const CICLOS = {
  mensal: (v) => ({ unit_amount: Math.round(v * 100), recurring: { interval: 'month', interval_count: 1 } }),
  semestral: (v) => ({ unit_amount: Math.round(v * 6 * 100), recurring: { interval: 'month', interval_count: 6 } }),
  anual: (v) => ({ unit_amount: Math.round(v * 12 * 100), recurring: { interval: 'year', interval_count: 1 } }),
};

for (const p of PLANOS) {
  let product;
  try {
    const found = await stripe.products.search({ query: `metadata['chave']:'${p.chave}'` });
    product = found.data?.[0];
  } catch {
    /* search pode estar indisponível — cai no create */
  }
  if (!product) product = await stripe.products.create({ name: p.nome, metadata: { chave: p.chave } });
  else await stripe.products.update(product.id, { name: p.nome });

  for (const [ciclo, fn] of Object.entries(CICLOS)) {
    const cfg = fn(p[ciclo]);
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'brl',
      unit_amount: cfg.unit_amount,
      recurring: cfg.recurring,
      lookup_key: `${p.chave}_${ciclo}`,
      transfer_lookup_key: true,
      metadata: { chave: p.chave, ciclo },
    });
    console.log(`OK  ${p.chave}_${ciclo}  ->  ${price.id}  (R$ ${(cfg.unit_amount / 100).toFixed(2)} / ${ciclo})`);
  }
}
console.log('\nPronto. Os lookup_keys foram criados — o checkout resolve por eles (sem colar IDs).');
