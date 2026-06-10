#!/usr/bin/env node
/**
 * Printful product creator — API-creates the full FREE SATAN apparel suite
 * inside Brian's Store (id 18259062, type=native), then pulls real Printful
 * mockups for each created product and writes the merch suite.json manifest
 * that the /merch page consumes.
 *
 * Idempotent: re-running deletes any existing product whose name starts with
 * "FREE SATAN" (so renames/edits work cleanly), then re-creates from scratch.
 *
 *   PRINTFUL_API_KEY=$(get-secret PRINTFUL_API_KEY) \
 *   node scripts/printful-create-products.mjs
 *
 *   # Dry-run (skips create + delete, just lists what would be created):
 *   node scripts/printful-create-products.mjs --dry
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKEN = process.env.PRINTFUL_API_KEY;
const STORE_ID = 18259062;
const DRY = process.argv.includes('--dry');
const DESIGN_URL = 'https://music.megabyte.space/merch/design-free-satan.png';
const PRODUCT_PREFIX = 'FREE SATAN';

if (!TOKEN) {
  console.error(
    'Missing PRINTFUL_API_KEY. PRINTFUL_API_KEY=$(get-secret PRINTFUL_API_KEY) node scripts/printful-create-products.mjs'
  );
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pf(path, opts = {}) {
  const r = await fetch(`https://api.printful.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'X-PF-Store-Id': String(STORE_ID),
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Printful ${opts.method ?? 'GET'} ${path} → ${r.status}: ${txt.slice(0, 500)}`);
  }
  return r.json();
}

/** Each suite entry maps to a Printful catalog product + a list of size
 * variants (M default, optionally include S/L/XL). The script pulls all
 * variants for the product, filters by color hint + sizes, creates one
 * sync product with N sync variants. */
const SUITE = [
  {
    slug: 'tee-1717-pepper',
    catalogId: 586,
    title: 'FREE SATAN Heavyweight Tee',
    blank: 'Comfort Colors 1717',
    color: 'Pepper',
    colorHint: 'pepper',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    price: '32.00',
    placements: [{ name: 'front', url: DESIGN_URL }],
    blurb: '6.1oz garment-dyed cotton · cream FREE SATAN graffiti + caged-devil art.'
  },
  {
    slug: 'long-sleeve-6014',
    catalogId: 753,
    title: 'FREE SATAN Long-Sleeve',
    blank: 'Comfort Colors 6014',
    color: 'Pepper',
    colorHint: 'pepper',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    price: '42.00',
    placements: [{ name: 'front', url: DESIGN_URL }],
    blurb: 'Heavyweight garment-dyed long-sleeve · same Pepper wash, studio winters.'
  },
  {
    slug: 'hoodie-1567',
    catalogId: 970,
    title: 'FREE SATAN Hoodie',
    blank: 'Comfort Colors 1567',
    color: 'Black',
    colorHint: 'black',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    price: '64.00',
    placements: [{ name: 'front', url: DESIGN_URL }],
    blurb: 'Heavyweight pullover hoodie · cream art screen-bright on faded black.'
  },
  {
    slug: 'crewneck-1566',
    catalogId: 839,
    title: 'FREE SATAN Crewneck',
    blank: 'Comfort Colors 1566',
    color: 'Pepper',
    colorHint: 'pepper',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    price: '58.00',
    placements: [{ name: 'front', url: DESIGN_URL }],
    blurb: 'Garment-dyed crewneck sweatshirt · same canvas, no hood.'
  },
  {
    slug: 'tank-9360',
    catalogId: 907,
    title: 'FREE SATAN Tank',
    blank: 'Comfort Colors 9360',
    color: 'Pepper',
    colorHint: 'pepper',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    price: '30.00',
    placements: [{ name: 'front', url: DESIGN_URL }],
    blurb: 'Garment-dyed tank · July sets, gym, "92° and still working" weather.'
  },
  {
    slug: 'pocket-tee-6030',
    catalogId: 593,
    title: 'FREE SATAN Pocket Tee',
    blank: 'Comfort Colors 6030',
    color: 'Pepper',
    colorHint: 'pepper',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    price: '34.00',
    placements: [{ name: 'front', url: DESIGN_URL }],
    blurb: 'Heavyweight pocket tee · cream FREE SATAN art over the pocket.'
  },
  {
    slug: 'sweatpants-1469',
    catalogId: 898,
    title: 'FREE SATAN Sweatpants',
    blank: 'Comfort Colors 1469',
    color: 'Pepper',
    colorHint: 'pepper',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    price: '56.00',
    placements: [{ name: 'front_large', url: DESIGN_URL }],
    blurb: 'Garment-dyed fleece sweatpants · pairs with the crewneck or hoodie.'
  },
  {
    slug: 'tote-allover',
    catalogId: 84,
    title: 'FREE SATAN Tote',
    blank: 'All-Over Print Tote',
    color: 'Black',
    colorHint: '',
    sizes: ['15″×15″'],
    price: '22.00',
    placements: [{ name: 'front', url: DESIGN_URL }],
    blurb: 'Heavy cotton tote · carries records, journals, the apron.'
  }
];

async function pickVariants(item) {
  // Pull all catalog variants for the product (paginated)
  let all = [];
  let next = `/v2/catalog-products/${item.catalogId}/catalog-variants?limit=100`;
  while (next) {
    const res = await pf(next);
    all = all.concat(res.data ?? []);
    const link = res._links?.next?.href;
    next = link ? link.replace('https://api.printful.com', '') : null;
    if (all.length > 500) break;
  }
  const hint = item.colorHint.toLowerCase();
  const byColor = hint ? all.filter(v => (v.color || '').toLowerCase().includes(hint)) : all;
  const pool = byColor.length ? byColor : all;
  // Pick one variant per requested size
  const picked = [];
  for (const size of item.sizes) {
    const want = size.toUpperCase();
    const match = pool.find(v => (v.size || '').toUpperCase() === want);
    if (match) picked.push(match);
  }
  if (!picked.length) {
    // Fallback: first variant in pool
    picked.push(pool[0]);
  }
  return picked;
}

async function deleteExistingFreeSatanProducts() {
  const list = await pf('/store/products?status=all&limit=100');
  const targets = (list.result ?? []).filter(p => (p.name || '').startsWith(PRODUCT_PREFIX));
  for (const p of targets) {
    console.log(`  ⌫ delete ${p.id} ${p.name}`);
    if (!DRY) await pf(`/store/products/${p.id}`, { method: 'DELETE' });
  }
  return targets.length;
}

async function createProduct(item) {
  const variants = await pickVariants(item);
  console.log(`  → ${item.slug} (${variants.length} variants)`);

  const body = {
    sync_product: {
      name: item.title,
      thumbnail: DESIGN_URL
    },
    sync_variants: variants.map(v => ({
      variant_id: v.id,
      retail_price: item.price,
      files: item.placements.map(pl => ({ placement: pl.name, url: pl.url }))
    }))
  };

  if (DRY) {
    console.log(`    (dry) would create with ${variants.length} variants @ ${item.price}`);
    return { id: 0, variants, mockup: null };
  }

  const r = await pf('/store/products', { method: 'POST', body: JSON.stringify(body) });
  const productId = r.result.id;
  console.log(`    ✓ product ${productId}`);

  // Generate a real Printful mockup for the FIRST variant (we use M size by default)
  // and a representative placement (front, fallback to back/leg/default).
  const mockVariant = variants.find(v => (v.size || '').toUpperCase() === 'M') ?? variants[0];
  const mockPlacement = item.placements[0];

  let mockupUrl = null;
  // Throttle to respect 10/min mockup-task limit on free tier
  await sleep(8000);
  try {
    const task = await pf('/v2/mockup-tasks', {
      method: 'POST',
      body: JSON.stringify({
        products: [
          {
            source: 'catalog',
            catalog_product_id: item.catalogId,
            catalog_variant_ids: [mockVariant.id],
            format: 'png',
            placements: [
              {
                placement: mockPlacement.name,
                technique: 'dtg',
                layers: [{ type: 'file', url: mockPlacement.url }]
              }
            ]
          }
        ]
      })
    });
    const taskId = task.data?.[0]?.id;
    if (taskId) {
      for (let i = 0; i < 24; i++) {
        await sleep(2500);
        const status = await pf(`/v2/mockup-tasks?id=${taskId}`);
        const t = status.data?.[0];
        if (t?.status === 'completed') {
          mockupUrl = t.catalog_variant_mockups?.[0]?.mockups?.[0]?.mockup_url ?? null;
          break;
        }
        if (t?.status === 'failed') {
          console.warn(`    ⚠ mockup task failed: ${JSON.stringify(t.failure_reasons)}`);
          break;
        }
      }
    }
  } catch (e) {
    // 429 = rate limit — back off and retry once with longer wait
    if (e.message.includes('429')) {
      console.warn(`    ⚠ rate-limited, waiting 65s then retrying once…`);
      await sleep(65000);
      try {
        const task = await pf('/v2/mockup-tasks', {
          method: 'POST',
          body: JSON.stringify({
            products: [
              {
                source: 'catalog',
                catalog_product_id: item.catalogId,
                catalog_variant_ids: [mockVariant.id],
                format: 'png',
                placements: [
                  {
                    placement: mockPlacement.name,
                    technique: 'dtg',
                    layers: [{ type: 'file', url: mockPlacement.url }]
                  }
                ]
              }
            ]
          })
        });
        const taskId = task.data?.[0]?.id;
        if (taskId) {
          for (let i = 0; i < 24; i++) {
            await sleep(2500);
            const status = await pf(`/v2/mockup-tasks?id=${taskId}`);
            const t = status.data?.[0];
            if (t?.status === 'completed') {
              mockupUrl = t.catalog_variant_mockups?.[0]?.mockups?.[0]?.mockup_url ?? null;
              break;
            }
            if (t?.status === 'failed') break;
          }
        }
      } catch (e2) {
        console.warn(`    ⚠ retry failed: ${e2.message.slice(0, 120)}`);
      }
    } else {
      console.warn(`    ⚠ mockup error: ${e.message.slice(0, 120)}`);
    }
  }

  if (mockupUrl) {
    const localPath = resolve(ROOT, 'public/merch/mockups', `${item.slug}.png`);
    const img = await fetch(mockupUrl);
    if (img.ok) {
      const bytes = new Uint8Array(await img.arrayBuffer());
      await writeFile(localPath, bytes);
      console.log(`    ✓ mockup saved → ${(bytes.length / 1024).toFixed(0)}KB`);
    }
  } else {
    console.log(`    ⚠ no mockup URL`);
  }

  return { id: productId, variants, mockup: mockupUrl };
}

async function main() {
  console.log(`Printful product factory (store ${STORE_ID} · ${DRY ? 'DRY' : 'LIVE'})\n`);

  await mkdir(resolve(ROOT, 'public/merch/mockups'), { recursive: true });

  console.log('Removing existing FREE SATAN products…');
  const removed = await deleteExistingFreeSatanProducts();
  console.log(`  deleted ${removed}\n`);

  console.log('Creating products…');
  const manifest = {
    generated_at: new Date().toISOString(),
    store_id: STORE_ID,
    storefront: 'https://bz-music.printful.me',
    design_url: '/merch/design-free-satan-v2.png',
    note: "Generated via Printful API — real Printful mockups + sync products in Brian's Store (native API).",
    items: []
  };

  for (const item of SUITE) {
    try {
      const result = await createProduct(item);
      manifest.items.push({
        slug: item.slug,
        title: item.title,
        blank: item.blank,
        color: item.color,
        blurb: item.blurb,
        price: parseFloat(item.price),
        catalogProductId: item.catalogId,
        productId: result.id,
        variantCount: result.variants.length,
        mockup: `/merch/mockups/${item.slug}.png`,
        storefrontUrl: `https://bz-music.printful.me`
      });
    } catch (e) {
      console.error(`  ✗ ${item.slug}: ${e.message}`);
      manifest.items.push({
        slug: item.slug,
        title: item.title,
        blank: item.blank,
        color: item.color,
        blurb: item.blurb,
        price: parseFloat(item.price),
        error: e.message
      });
    }
    await sleep(800);
  }

  if (!DRY) {
    await writeFile(resolve(ROOT, 'public/merch/suite.json'), JSON.stringify(manifest, null, 2));
    console.log(`\n✓ wrote public/merch/suite.json`);
  }
  console.log(
    `\n${manifest.items.filter(i => i.productId).length}/${manifest.items.length} products created.`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
