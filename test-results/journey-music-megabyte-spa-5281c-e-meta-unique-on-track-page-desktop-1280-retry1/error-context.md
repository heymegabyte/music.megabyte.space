# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journey.spec.ts >> music.megabyte.space — golden journey >> per-route meta unique on track page
- Location: tests/journey.spec.ts:122:3

# Error details

```
Error: expect(received).toMatch(expected)

Expected pattern: /<title>Birch-Swing Heaven[^<]+<\/title>/
Received string:  "<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\" />
    <meta name=\"color-scheme\" content=\"dark\" />
    <title>Touch The Sky · bZ · Hustle gospel from Canopy Dispatch</title>
    <meta name=\"description\" content=\"Touch The Sky by bZ on Canopy Dispatch: &quot;When the world gets heavy I want to climb high.&quot; Digital-age signals from ancient roots.\" />
    <link rel=\"canonical\" href=\"https://music.megabyte.space/canopy/birch-swing-heaven\" />
    <meta name=\"robots\" content=\"index,follow,max-image-preview:large\" />
    <meta name=\"theme-color\" content=\"#060610\" />
    <meta name=\"application-name\" content=\"Panda Desiiignare\" />
    <meta name=\"apple-mobile-web-app-title\" content=\"Panda\" />
    <meta name=\"apple-mobile-web-app-capable\" content=\"yes\" />
    <meta name=\"mobile-web-app-capable\" content=\"yes\" />
    <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\" />
    <link rel=\"manifest\" href=\"/site.webmanifest\" />
    <link rel=\"icon\" href=\"/favicon.ico\" sizes=\"any\" />
    <link rel=\"icon\" type=\"image/png\" sizes=\"32x32\" href=\"/favicon-32x32.png\" />
    <link rel=\"icon\" type=\"image/png\" sizes=\"16x16\" href=\"/favicon-16x16.png\" />
    <link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/apple-touch-icon.png\" />·
    <meta property=\"og:type\" content=\"music.song\" />
    <meta property=\"og:title\" content=\"Touch The Sky — bZ\" />
    <meta property=\"og:description\" content=\"Touch The Sky by bZ on Canopy Dispatch: &quot;When the world gets heavy I want to climb high.&quot; Digital-age signals from ancient roots.\" />
    <meta property=\"og:url\" content=\"https://music.megabyte.space/canopy/birch-swing-heaven\" />
    <meta property=\"og:site_name\" content=\"Panda Desiiignare\" />
    <meta property=\"og:locale\" content=\"en_US\" />
    <meta property=\"og:image\" content=\"https://music.megabyte.space/og/track-birch-swing-heaven.jpg\" />
    <meta property=\"og:image:secure_url\" content=\"https://music.megabyte.space/og/track-birch-swing-heaven.jpg\" />
    <meta property=\"og:image:width\" content=\"1200\" />
    <meta property=\"og:image:height\" content=\"630\" />
    <meta property=\"og:image:type\" content=\"image/jpeg\" />
    <meta property=\"og:image:alt\" content=\"Touch The Sky — bZ · Canopy Dispatch share card\" />·
    <meta name=\"twitter:card\" content=\"player\" />
    <meta name=\"twitter:title\" content=\"Touch The Sky — bZ\" />
    <meta name=\"twitter:description\" content=\"Touch The Sky by bZ on Canopy Dispatch: &quot;When the world gets heavy I want to climb high.&quot; Digital-age signals from ancient roots.\" />
    <meta name=\"twitter:image\" content=\"https://music.megabyte.space/og/track-birch-swing-heaven.jpg\" />
    <meta name=\"twitter:image:alt\" content=\"Touch The Sky — bZ · Canopy Dispatch share card\" />·
    <meta property=\"og:audio\" content=\"https://music.megabyte.space/audio/Birch_Swing_Heaven.mp3\" />
    <meta property=\"og:audio:secure_url\" content=\"https://music.megabyte.space/audio/Birch_Swing_Heaven.mp3\" />
    <meta property=\"og:audio:type\" content=\"audio/mpeg\" />
    <meta name=\"twitter:player\" content=\"https://music.megabyte.space/embed/birch-swing-heaven\" />
    <meta name=\"twitter:player:width\" content=\"480\" />
    <meta name=\"twitter:player:height\" content=\"160\" />
    <meta name=\"twitter:player:stream\" content=\"https://music.megabyte.space/audio/Birch_Swing_Heaven.mp3\" />
    <meta name=\"twitter:player:stream:content_type\" content=\"audio/mpeg\" />
    <link rel=\"alternate\" type=\"application/json+oembed\" href=\"https://music.megabyte.space/api/oembed?url=https%3A%2F%2Fmusic.megabyte.space%2Fcanopy%2Fbirch-swing-heaven&format=json\" title=\"bZ — oEmbed JSON\" />·
    <link rel=\"dns-prefetch\" href=\"https://www.gstatic.com\" />
    <link rel=\"preconnect\" href=\"https://www.gstatic.com\" crossorigin />·
    <script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"MusicRecording\",\"name\":\"Touch The Sky\",\"url\":\"https://music.megabyte.space/canopy/birch-swing-heaven\",\"image\":\"https://music.megabyte.space/og/track-birch-swing-heaven.jpg\",\"duration\":\"PT3M30S\",\"audio\":\"https://music.megabyte.space/audio/Birch_Swing_Heaven.mp3\",\"embedUrl\":\"https://music.megabyte.space/embed/birch-swing-heaven\",\"byArtist\":{\"@type\":\"MusicGroup\",\"name\":\"bZ\",\"url\":\"https://music.megabyte.space\"},\"inAlbum\":{\"@type\":\"MusicAlbum\",\"name\":\"Canopy Dispatch\",\"url\":\"https://music.megabyte.space/canopy\",\"image\":\"https://music.megabyte.space/art/cover-canopy-dispatch.png\"},\"genre\":\"Hustle gospel\",\"description\":\"\\\"Use absence to increase respect and honor\\\" — Greene, Law 16\"}</script><script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"BreadcrumbList\",\"itemListElement\":[{\"@type\":\"ListItem\",\"position\":1,\"name\":\"Music\",\"item\":\"https://music.megabyte.space\"},{\"@type\":\"ListItem\",\"position\":2,\"name\":\"Canopy Dispatch\",\"item\":\"https://music.megabyte.space/canopy\"},{\"@type\":\"ListItem\",\"position\":3,\"name\":\"Touch The Sky\",\"item\":\"https://music.megabyte.space/canopy/birch-swing-heaven\"}]}</script>
    <script type=\"module\" crossorigin src=\"/assets/main-cC_QDYRq.js\"></script>
    <link rel=\"modulepreload\" crossorigin href=\"/assets/modulepreload-polyfill-B5Qt9EMX.js\">
    <link rel=\"modulepreload\" crossorigin href=\"/assets/data-DvE2dBwx.js\">
    <link rel=\"modulepreload\" crossorigin href=\"/assets/cast-protocol-DHnQJCgo.js\">
    <link rel=\"stylesheet\" crossorigin href=\"/assets/data-C0wo-j7h.css\">
  </head>
  <body>
    <div id=\"app\"></div>
  </body>
</html>
"
```

# Test source

```ts
  26  |     page.on('pageerror', e => errs.push(e.message));
  27  |     page.on('console', m => {
  28  |       if (m.type() === 'error' && !/sw register failed|favicon|Failed to load resource|net::ERR_|speculation rules/i.test(m.text())) {
  29  |         errs.push(m.text());
  30  |       }
  31  |     });
  32  |     await gotoHome(page);
  33  |     await expect(page.locator('#heroTitle')).toBeVisible();
  34  |     expect(errs).toEqual([]);
  35  |   });
  36  | 
  37  |   test('share-chip-row never overlaps trackrow stats', async ({ page, isMobile }) => {
  38  |     await gotoHome(page);
  39  |     const wrap = page.locator('.trackrow-wrap').first();
  40  |     await wrap.scrollIntoViewIfNeeded();
  41  |     if (!isMobile) await wrap.hover();
  42  |     const stats = wrap.locator('.trackrow__stats');
  43  |     const chip = wrap.locator('.share-chip--row');
  44  |     await expect(stats).toBeVisible();
  45  |     await expect(chip).toBeVisible();
  46  |     const sb = await stats.boundingBox();
  47  |     const cb = await chip.boundingBox();
  48  |     if (!sb || !cb) throw new Error('no boxes');
  49  |     const overlap = sb.x + sb.width > cb.x && cb.x + cb.width > sb.x;
  50  |     expect(overlap, `stats(${sb.x}+${sb.width})=${sb.x + sb.width} vs chip(${cb.x})=${cb.x}`).toBe(false);
  51  |   });
  52  | 
  53  |   test('install banner Later button persists dismissal', async ({ page, context }) => {
  54  |     await context.clearCookies();
  55  |     await gotoHome(page);
  56  |     await page.evaluate(() => localStorage.clear());
  57  |     await page.goto('/?install=1', { waitUntil: 'domcontentloaded' });
  58  |     await page.waitForSelector('#heroTitle');
  59  |     const banner = page.locator('#installBanner');
  60  |     await expect(banner).toBeVisible({ timeout: 10000 });
  61  |     await page.locator('#installDismiss').click();
  62  |     await expect(banner).toBeHidden();
  63  |     const snooze = await page.evaluate(() => localStorage.getItem('bz:installSnoozeUntil'));
  64  |     expect(snooze).toBeTruthy();
  65  |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  66  |     await page.waitForSelector('#heroTitle');
  67  |     await expect(page.locator('#installBanner')).toBeHidden();
  68  |   });
  69  | 
  70  |   test('seek bar click jumps audio to mid-track', async ({ page, browserName, isMobile }) => {
  71  |     test.skip(browserName !== 'chromium', 'Chromium-only autoplay tweak');
  72  |     test.setTimeout(90000);
  73  |     await page.goto(`/canopy/${FIRST_TRACK}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  74  |     await page.waitForFunction(() => {
  75  |       const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement | null;
  76  |       return !!a && Number.isFinite(a.duration) && a.duration > 0;
  77  |     }, { timeout: 30000 });
  78  |     await page.evaluate(async () => {
  79  |       const dialog = document.querySelector('#autoplayPrompt') as HTMLDialogElement | null;
  80  |       if (dialog?.open) dialog.close();
  81  |       document.documentElement.classList.remove('is-autoplay-prompt');
  82  |       const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement;
  83  |       try { await a.play(); } catch {}
  84  |     });
  85  |     await page.waitForFunction(() => {
  86  |       const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement | null;
  87  |       return !!a && !a.paused && a.readyState >= 2;
  88  |     }, { timeout: 15000 });
  89  |     const dur = await page.evaluate(() => (document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement).duration);
  90  |     expect(dur).toBeGreaterThan(10);
  91  | 
  92  |     const bar = page.locator('#bar').first();
  93  |     await bar.scrollIntoViewIfNeeded();
  94  |     await page.waitForFunction(() => {
  95  |       const b = document.querySelector('#bar') as HTMLElement | null;
  96  |       return !!b && b.getBoundingClientRect().width > 50;
  97  |     }, { timeout: 10000 });
  98  |     const fireScrub = async (ratio: number) => {
  99  |       const box = await bar.boundingBox();
  100 |       if (!box) throw new Error('no bar');
  101 |       await bar.click({ position: { x: box.width * ratio, y: box.height / 2 }, force: true });
  102 |     };
  103 |     await fireScrub(0.5);
  104 |     await page.waitForFunction(() => {
  105 |       const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement;
  106 |       return a && a.currentTime > 5;
  107 |     }, { timeout: 30000 });
  108 |     const after = await page.evaluate(() => {
  109 |       const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement;
  110 |       return { currentTime: a.currentTime, duration: a.duration, paused: a.paused, readyState: a.readyState };
  111 |     });
  112 |     expect(after.currentTime, `seek state ${JSON.stringify(after)}`).toBeGreaterThan(dur * 0.4);
  113 |     expect(after.currentTime).toBeLessThan(dur * 0.6);
  114 | 
  115 |     if (!isMobile) {
  116 |       await fireScrub(0.85);
  117 |       const after2 = await page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).currentTime);
  118 |       expect(after2).toBeGreaterThan(dur * 0.78);
  119 |     }
  120 |   });
  121 | 
  122 |   test('per-route meta unique on track page', async ({ request }) => {
  123 |     const r = await request.get(`/canopy/${FIRST_TRACK}`);
  124 |     expect(r.status()).toBe(200);
  125 |     const html = await r.text();
> 126 |     expect(html).toMatch(/<title>Birch-Swing Heaven[^<]+<\/title>/);
      |                  ^ Error: expect(received).toMatch(expected)
  127 |     expect(html).toContain(`og/${FIRST_TRACK}.png`);
  128 |     const titleLen = html.match(/<title>([^<]+)<\/title>/)?.[1].length ?? 0;
  129 |     expect(titleLen).toBeGreaterThanOrEqual(50);
  130 |     expect(titleLen).toBeLessThanOrEqual(60);
  131 |   });
  132 | 
  133 |   test('share dialog opens from track row chip', async ({ page, isMobile }) => {
  134 |     await gotoHome(page);
  135 |     const wrap = page.locator('.trackrow-wrap').first();
  136 |     await wrap.scrollIntoViewIfNeeded();
  137 |     if (!isMobile) await wrap.hover();
  138 |     await page.locator('.share-chip--row').first().click();
  139 |     await expect(page.locator('#share')).toBeVisible();
  140 |     const link = await page.locator('#shareLink').inputValue();
  141 |     expect(link).toMatch(/^https:\/\/music\.megabyte\.space\//);
  142 |     await page.locator('#shareClose').click();
  143 |     await expect(page.locator('#share')).toBeHidden();
  144 |   });
  145 | 
  146 |   test('notify modal collects email and posts to /api/subscribe', async ({ page, context }) => {
  147 |     let captured: { email?: string; source?: string } | null = null;
  148 |     await context.route('**/api/subscribe', async route => {
  149 |       const req = route.request();
  150 |       try { captured = JSON.parse(req.postData() || '{}'); } catch { captured = {}; }
  151 |       await route.fulfill({
  152 |         status: 200,
  153 |         contentType: 'application/json',
  154 |         body: JSON.stringify({ ok: true, listmonk: 'subscribed', push: 'skipped' })
  155 |       });
  156 |     });
  157 |     await gotoHome(page);
  158 |     await page.evaluate(() => localStorage.removeItem('bz:notify:email'));
  159 |     const nudge = page.locator('.album__subscribe').first();
  160 |     await nudge.scrollIntoViewIfNeeded();
  161 |     await expect(nudge).toBeVisible();
  162 |     await nudge.click();
  163 |     const dlg = page.locator('#notifyDialog');
  164 |     await expect(dlg).toBeVisible();
  165 |     const email = `playwright+${Date.now()}@megabyte.space`;
  166 |     await page.locator('#notifyEmail').fill(email);
  167 |     await page.locator('#notifySubmit').click();
  168 |     await expect(dlg).toBeHidden();
  169 |     expect(captured?.email).toBe(email);
  170 |     const stored = await page.evaluate(() => localStorage.getItem('bz:notify:email'));
  171 |     expect(stored).toBe(email);
  172 |     await expect(page.locator('.album__subscribe').first()).toBeHidden();
  173 |   });
  174 | 
  175 |   test('notify modal rejects empty email with inline error', async ({ page }) => {
  176 |     await gotoHome(page);
  177 |     await page.evaluate(() => localStorage.removeItem('bz:notify:email'));
  178 |     await page.locator('.album__subscribe').first().scrollIntoViewIfNeeded();
  179 |     await page.locator('.album__subscribe').first().click();
  180 |     await expect(page.locator('#notifyDialog')).toBeVisible();
  181 |     await page.locator('#notifyEmail').fill('not-an-email');
  182 |     await page.locator('#notifySubmit').click();
  183 |     await expect(page.locator('#notifyError')).toBeVisible();
  184 |     await expect(page.locator('#notifyError')).toContainText(/valid email/i);
  185 |     await expect(page.locator('#notifyDialog')).toBeVisible();
  186 |   });
  187 | });
  188 | 
```