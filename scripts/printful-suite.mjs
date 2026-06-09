#!/usr/bin/env node
/**
 * Printful "FREE SATAN — It's Animal Abuse" apparel suite generator.
 *
 * The bz-music.printful.me storefront is a Quick Store, which Printful
 * locks out of the API entirely. So instead of round-tripping the
 * mockup-tasks API (which 403s for Quick Stores), we pull real blank
 * product photography via the public v2 catalog endpoints and composite
 * the FREE SATAN art on top of the chest via Sharp. Output ships as
 * `/merch/mockups/<slug>.png` + a `suite.json` manifest that the /merch
 * page renders as a grid.
 *
 * To upgrade to true Printful-rendered mockups: switch the Printful
 * store from Quick Store to Manual API store in
 * https://www.printful.com/dashboard/store, then re-run with --api.
 *
 * Usage:
 *   PRINTFUL_API_KEY=$(get-secret PRINTFUL_API_KEY) node scripts/printful-suite.mjs
 *   PRINTFUL_API_KEY=$(get-secret PRINTFUL_API_KEY) node scripts/printful-suite.mjs --force
 */

import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKEN = process.env.PRINTFUL_API_KEY;
const FORCE = process.argv.includes('--force');

if (!TOKEN) {
  console.error('Missing PRINTFUL_API_KEY. Run: PRINTFUL_API_KEY=$(get-secret PRINTFUL_API_KEY) node scripts/printful-suite.mjs');
  process.exit(2);
}

const DESIGN_PATH = resolve(ROOT, 'public/merch/design-free-satan.png');

/** The FREE SATAN — It's Animal Abuse apparel suite. */
const SUITE = [
  {
    slug: 'tee-1717-pepper',
    catalogProductId: 586,
    title: 'FREE SATAN Heavyweight Tee',
    blank: 'Comfort Colors 1717',
    color: 'Pepper',
    blurb: '6.1oz garment-dyed cotton · cream FREE SATAN graffiti + caged-devil on faded black.',
    price: 32,
    variantColorHint: 'pepper',
    placement: 'front',
    overlayScale: 0.40,
    overlayYOffset: 0.02,
    storefrontPath: '/product/free-satan-tee',
  },
  {
    slug: 'long-sleeve-6014',
    catalogProductId: 753,
    title: 'FREE SATAN Long-Sleeve',
    blank: 'Comfort Colors 6014',
    color: 'Pepper',
    blurb: 'Heavyweight garment-dyed long-sleeve. Same art, same Pepper wash. Built for studio winters.',
    price: 42,
    variantColorHint: 'pepper',
    placement: 'front',
    overlayScale: 0.38,
    overlayYOffset: 0.02,
    storefrontPath: '/product/free-satan-long-sleeve',
  },
  {
    slug: 'hoodie-1567',
    catalogProductId: 970,
    title: 'FREE SATAN Hoodie',
    blank: 'Comfort Colors 1567',
    color: 'Black',
    blurb: 'Heavyweight pullover hoodie · cream art screen-bright on faded black.',
    price: 64,
    variantColorHint: 'black',
    placement: 'front',
    overlayScale: 0.38,
    overlayYOffset: 0.06,
    storefrontPath: '/product/free-satan-hoodie',
  },
  {
    slug: 'crewneck-1566',
    catalogProductId: 839,
    title: 'FREE SATAN Crewneck',
    blank: 'Comfort Colors 1566',
    color: 'Pepper',
    blurb: 'Garment-dyed crewneck sweatshirt. Same canvas, no hood. For the pulpit and the corner.',
    price: 58,
    variantColorHint: 'pepper',
    placement: 'front',
    overlayScale: 0.38,
    overlayYOffset: 0.04,
    storefrontPath: '/product/free-satan-crewneck',
  },
  {
    slug: 'tank-9360',
    catalogProductId: 907,
    title: 'FREE SATAN Tank',
    blank: 'Comfort Colors 9360',
    color: 'Pepper',
    blurb: 'Garment-dyed tank · for July sets, gym, and "it’s 92° and we still got work" weather.',
    price: 30,
    variantColorHint: 'pepper',
    placement: 'front',
    overlayScale: 0.34,
    overlayYOffset: 0.00,
    storefrontPath: '/product/free-satan-tank',
  },
  {
    slug: 'pocket-tee-6030',
    catalogProductId: 593,
    title: 'FREE SATAN Pocket Tee',
    blank: 'Comfort Colors 6030',
    color: 'Pepper',
    blurb: 'Heavyweight pocket tee · back-print of the full FREE SATAN art.',
    price: 34,
    variantColorHint: 'pepper',
    placement: 'back',
    overlayScale: 0.46,
    overlayYOffset: 0.04,
    storefrontPath: '/product/free-satan-pocket-tee',
  },
  {
    slug: 'sweatpants-1469',
    catalogProductId: 898,
    title: 'FREE SATAN Sweatpants',
    blank: 'Comfort Colors 1469',
    color: 'Pepper',
    blurb: 'Garment-dyed fleece sweatpants. Pairs with the crewneck or hoodie for the full Pepper set.',
    price: 56,
    variantColorHint: 'pepper',
    placement: 'front',
    overlayScale: 0.22,
    overlayYOffset: 0.02,
    storefrontPath: '/product/free-satan-sweatpants',
  },
  {
    slug: 'tote-allover',
    catalogProductId: 84,
    title: 'FREE SATAN Tote',
    blank: 'All-Over Print Cotton Tote',
    color: 'Natural',
    blurb: 'Heavy cotton tote · carries records, journals, the soup-kitchen volunteer apron.',
    price: 22,
    variantColorHint: '',
    placement: 'front',
    overlayScale: 0.55,
    overlayYOffset: 0.00,
    storefrontPath: '/product/free-satan-tote',
  },
];

const SUITE_OUTPUT = resolve(ROOT, 'public/merch/suite.json');
const MOCKUPS_DIR = resolve(ROOT, 'public/merch/mockups');
const PRINTFUL_STOREFRONT = 'https://bz-music.printful.me';

async function exists(p) { try { await access(p); return true; } catch { return false; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pf(path) {
  const r = await fetch(`https://api.printful.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`Printful GET ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function pickVariant(catalogProductId, colorHint) {
  // paginated; pull all variants then filter
  const res = await pf(`/v2/catalog-products/${catalogProductId}/catalog-variants?limit=100`);
  let all = res.data ?? [];
  // some products have >100 variants — follow paging
  let next = res._links?.next?.href;
  while (next && all.length < 400) {
    const more = await pf(next.replace('https://api.printful.com', ''));
    all = all.concat(more.data ?? []);
    next = more._links?.next?.href;
  }
  if (!all.length) throw new Error(`No variants for product ${catalogProductId}`);
  const hint = (colorHint || '').toLowerCase();
  const byColor = all.filter((v) => (v.color || '').toLowerCase().includes(hint));
  const pool = byColor.length ? byColor : all;
  return pool.find((v) => (v.size || '').toUpperCase() === 'M') ?? pool[0];
}

async function fetchVariantImages(variantId) {
  const res = await pf(`/v2/catalog-variants/${variantId}/images`);
  return res.data?.images ?? [];
}

async function downloadImage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`download ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function buildMockup(item) {
  const outPath = resolve(MOCKUPS_DIR, `${item.slug}.png`);
  if (!FORCE && (await exists(outPath))) {
    console.log(`  ✓ ${item.slug} (cached)`);
    return outPath;
  }

  const variant = await pickVariant(item.catalogProductId, item.variantColorHint);
  console.log(`  → ${item.slug} (variant ${variant.id} · ${variant.color || '?'} ${variant.size || ''})`);

  const images = await fetchVariantImages(variant.id);
  // prefer the requested placement; mug uses "default"
  let img = images.find((i) => i.placement === item.placement)
    ?? images.find((i) => i.placement === 'front')
    ?? images.find((i) => i.placement === 'default')
    ?? images[0];
  if (!img) throw new Error(`No images for variant ${variant.id}`);

  const blankBuf = await downloadImage(img.image_url);
  const designBuf = await readFile(DESIGN_PATH);

  // Resize blank to canonical 1200×1200 work area
  const blank = sharp(blankBuf).resize(1200, 1200, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } });
  const blankMeta = await blank.metadata();

  // Overlay scale relative to canvas width
  const overlayW = Math.round(1200 * item.overlayScale);
  const design = await sharp(designBuf)
    .resize({ width: overlayW, withoutEnlargement: false })
    .png()
    .toBuffer();
  const designMeta = await sharp(design).metadata();

  const left = Math.round((1200 - designMeta.width) / 2);
  const verticalCenter = Math.round((1200 - designMeta.height) / 2);
  const top = verticalCenter + Math.round(1200 * item.overlayYOffset);

  const composited = await blank
    .composite([{ input: design, top, left, blend: 'over' }])
    .png({ quality: 90, compressionLevel: 9 })
    .toBuffer();

  await writeFile(outPath, composited);
  const kb = (composited.length / 1024).toFixed(0);
  console.log(`  ✓ ${item.slug} → ${kb}KB (${blankMeta.width}×${blankMeta.height} base)`);

  return { path: outPath, variant, blankUrl: img.image_url, hex: img.background_color };
}

async function main() {
  await mkdir(MOCKUPS_DIR, { recursive: true });
  console.log(`Generating ${SUITE.length}-item FREE SATAN apparel suite…\n`);

  const manifest = {
    generated_at: new Date().toISOString(),
    storefront: PRINTFUL_STOREFRONT,
    design_url: '/merch/design-free-satan.png',
    note: 'Composited from real Printful catalog photography via /v2/catalog-variants/{id}/images. Quick Store blocks /mockup-tasks; switch to Manual API store to upgrade to Printful-rendered mockups.',
    items: [],
  };

  for (const item of SUITE) {
    try {
      const result = await buildMockup(item);
      manifest.items.push({
        slug: item.slug,
        title: item.title,
        blank: item.blank,
        color: item.color,
        blurb: item.blurb,
        price: item.price,
        catalogProductId: item.catalogProductId,
        variantId: result.variant?.id,
        backgroundHex: result.hex || null,
        mockup: `/merch/mockups/${item.slug}.png`,
        storefrontUrl: `${PRINTFUL_STOREFRONT}${item.storefrontPath}`,
      });
    } catch (e) {
      console.error(`✗ ${item.slug}: ${e.message}`);
      manifest.items.push({
        slug: item.slug,
        title: item.title,
        blank: item.blank,
        color: item.color,
        blurb: item.blurb,
        price: item.price,
        catalogProductId: item.catalogProductId,
        mockup: null,
        error: e.message,
        storefrontUrl: `${PRINTFUL_STOREFRONT}${item.storefrontPath}`,
      });
    }
    await sleep(400);
  }

  await writeFile(SUITE_OUTPUT, JSON.stringify(manifest, null, 2));
  console.log(`\n✓ Wrote ${SUITE_OUTPUT}`);
  console.log(`  ${manifest.items.filter((i) => i.mockup).length}/${manifest.items.length} mockups generated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
