#!/usr/bin/env node
/**
 * Pulls the live FREE SATAN sync products from Brian's Store and
 * enriches public/merch/suite.json with per-variant data the frontend
 * cart needs:
 *   - sync_variant_id (used by POST /orders for fulfillment)
 *   - catalog variant id (for shipping rate calc)
 *   - size label
 *   - retail price
 *   - in-stock flag
 *
 * Run after `printful-create-products.mjs` (or any time the storefront
 * changes) so the frontend cart's payload matches reality.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKEN = process.env.PRINTFUL_API_KEY;
const STORE_ID = 18258477; // bz-music store (per /store call below — adjust if Brian's Store id differs)
const REAL_STORE_ID = 18259062; // Brian's Store (native API)
const SUITE_PATH = resolve(ROOT, 'public/merch/suite.json');

if (!TOKEN) {
  console.error('Missing PRINTFUL_API_KEY env');
  process.exit(2);
}

async function pf(path) {
  const r = await fetch(`https://api.printful.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-PF-Store-Id': String(REAL_STORE_ID) }
  });
  if (!r.ok) throw new Error(`Printful ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function main() {
  const suite = JSON.parse(await readFile(SUITE_PATH, 'utf8'));

  // Pull all sync products
  const list = await pf('/store/products?status=all&limit=100');
  const products = list.result ?? [];
  console.log(`Found ${products.length} sync products in store ${REAL_STORE_ID}`);

  // Map product name → product id
  const byName = new Map();
  for (const p of products) byName.set(p.name, p);

  let enriched = 0;
  for (const item of suite.items) {
    const product = byName.get(item.title);
    if (!product) {
      console.warn(`  ⚠ no Printful product for "${item.title}"`);
      item.variants = [];
      continue;
    }

    // Fetch full product detail (includes sync_variants[])
    const detail = await pf(`/store/products/${product.id}`);
    const syncVariants = detail.result?.sync_variants ?? [];
    item.productId = product.id;
    item.variants = syncVariants.map(sv => ({
      sync_variant_id: sv.id,
      catalog_variant_id: sv.variant_id,
      name: sv.name,
      size: sv.size,
      color: sv.color,
      retail_price: sv.retail_price,
      currency: sv.currency,
      in_stock: !sv.is_ignored,
      external_id: sv.external_id
    }));
    enriched++;
    console.log(`  ✓ ${item.slug}: ${item.variants.length} variants`);
  }

  suite.synced_at = new Date().toISOString();
  await writeFile(SUITE_PATH, JSON.stringify(suite, null, 2));
  console.log(`\n✓ Enriched ${enriched}/${suite.items.length} items in ${SUITE_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
