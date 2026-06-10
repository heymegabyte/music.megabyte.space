/**
 * /merch cart + checkout — bootstraps after the merch content-page mounts.
 *
 * Reads suite data from /merch/suite.json on first invocation, binds
 * size-selector + add-to-cart buttons on every .merch-card, manages a
 * localStorage cart, renders a floating cart fab + drawer, and POSTs to
 * /api/merch/checkout on checkout-click → browser redirects to the
 * Stripe Checkout URL the worker returns.
 *
 * Payment routing note: Stripe Checkout is the v1 rail. When Square
 * credentials land, swap the form submit for square.payments tokenize +
 * Worker /v2/payments call. The cart payload stays identical.
 */

type Variant = {
  sync_variant_id: number;
  catalog_variant_id: number;
  name: string;
  size: string;
  color: string;
  retail_price: string;
  currency: string;
  in_stock: boolean;
};

type SuiteItem = {
  slug: string;
  title: string;
  blank: string;
  color: string;
  blurb: string;
  price: number;
  mockup: string;
  storefrontUrl?: string;
  productId?: number;
  variants?: Variant[];
};

type Suite = { items: SuiteItem[] };

type CartLine = {
  slug: string;
  title: string;
  size: string;
  sync_variant_id: number;
  price: number;
  mockup: string;
  quantity: number;
};

const CART_KEY = 'bz-merch-cart-v1';
let suiteCache: Suite | null = null;
let cart: CartLine[] = [];

function loadCart(): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}
function cartTotal(): number {
  return cart.reduce((t, l) => t + l.price * l.quantity, 0);
}
function cartCount(): number {
  return cart.reduce((t, l) => t + l.quantity, 0);
}

async function loadSuite(): Promise<Suite> {
  if (suiteCache) return suiteCache;
  const r = await fetch('/merch/suite.json', { cache: 'no-cache' });
  suiteCache = await r.json();
  return suiteCache!;
}

function findVariant(slug: string, size: string): Variant | null {
  const item = suiteCache?.items.find(i => i.slug === slug);
  return item?.variants?.find(v => v.size === size) ?? null;
}

function findItem(slug: string): SuiteItem | null {
  return suiteCache?.items.find(i => i.slug === slug) ?? null;
}

function ensureFab(): { fab: HTMLButtonElement; badge: HTMLSpanElement; drawer: HTMLDivElement } {
  let fab = document.getElementById('merchFab') as HTMLButtonElement | null;
  if (fab) {
    return {
      fab,
      badge: fab.querySelector('.merch-fab__badge')!,
      drawer: document.getElementById('merchDrawer') as HTMLDivElement
    };
  }
  fab = document.createElement('button');
  fab.id = 'merchFab';
  fab.className = 'merch-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open cart');
  fab.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
    <span class="merch-fab__badge" aria-live="polite">0</span>
  `;
  document.body.appendChild(fab);

  const drawer = document.createElement('div');
  drawer.id = 'merchDrawer';
  drawer.className = 'merch-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'Cart');
  drawer.setAttribute('aria-modal', 'true');
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="merch-drawer__panel">
      <header class="merch-drawer__head">
        <h3>Cart</h3>
        <button type="button" class="merch-drawer__close" id="merchDrawerClose" aria-label="Close cart">✕</button>
      </header>
      <div class="merch-drawer__lines" id="merchDrawerLines"></div>
      <footer class="merch-drawer__foot">
        <div class="merch-drawer__totals">
          <span>Subtotal</span>
          <strong id="merchDrawerSubtotal">$0.00</strong>
        </div>
        <p class="merch-drawer__shipnote">+ $5 US shipping at checkout · 5-7 day fulfillment by Printful</p>
        <button type="button" class="merch-drawer__checkout" id="merchDrawerCheckout">Checkout →</button>
      </footer>
    </div>
    <div class="merch-drawer__scrim" id="merchDrawerScrim"></div>
  `;
  document.body.appendChild(drawer);

  fab.addEventListener('click', () => openDrawer());
  drawer.querySelector('#merchDrawerClose')?.addEventListener('click', closeDrawer);
  drawer.querySelector('#merchDrawerScrim')?.addEventListener('click', closeDrawer);
  drawer.querySelector('#merchDrawerCheckout')?.addEventListener('click', checkout);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
  });

  return { fab, badge: fab.querySelector('.merch-fab__badge')!, drawer };
}

function updateFab() {
  const { fab, badge } = ensureFab();
  const n = cartCount();
  badge.textContent = String(n);
  fab.classList.toggle('merch-fab--has-items', n > 0);
}

function renderDrawer() {
  const { drawer } = ensureFab();
  const lines = drawer.querySelector('#merchDrawerLines')!;
  const subtotal = drawer.querySelector('#merchDrawerSubtotal')!;
  const checkoutBtn = drawer.querySelector('#merchDrawerCheckout') as HTMLButtonElement;
  if (!cart.length) {
    lines.innerHTML = '<p class="merch-drawer__empty">Cart is empty. Pick a size on any item to add it.</p>';
    subtotal.textContent = '$0.00';
    checkoutBtn.disabled = true;
    return;
  }
  lines.innerHTML = cart
    .map(
      (line, i) => `
    <div class="merch-drawer__line" data-idx="${i}">
      <img src="${line.mockup}" alt="" loading="lazy" />
      <div class="merch-drawer__line-body">
        <div class="merch-drawer__line-title">${line.title}</div>
        <div class="merch-drawer__line-meta">Size ${line.size} · $${line.price}</div>
        <div class="merch-drawer__line-qty">
          <button type="button" data-act="dec" data-idx="${i}" aria-label="Decrease quantity">−</button>
          <span>${line.quantity}</span>
          <button type="button" data-act="inc" data-idx="${i}" aria-label="Increase quantity">+</button>
          <button type="button" data-act="rm" data-idx="${i}" class="merch-drawer__line-rm" aria-label="Remove">Remove</button>
        </div>
      </div>
      <div class="merch-drawer__line-price">$${(line.price * line.quantity).toFixed(2)}</div>
    </div>
  `
    )
    .join('');
  subtotal.textContent = `$${cartTotal().toFixed(2)}`;
  checkoutBtn.disabled = false;
  lines.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLElement).dataset.idx!, 10);
      const act = (btn as HTMLElement).dataset.act;
      if (act === 'inc' && cart[idx].quantity < 20) cart[idx].quantity++;
      else if (act === 'dec' && cart[idx].quantity > 1) cart[idx].quantity--;
      else if (act === 'rm') cart.splice(idx, 1);
      saveCart();
      updateFab();
      renderDrawer();
    });
  });
}

function openDrawer() {
  const { drawer } = ensureFab();
  renderDrawer();
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add('merch-drawer--open'));
}
function closeDrawer() {
  const { drawer } = ensureFab();
  drawer.classList.remove('merch-drawer--open');
  setTimeout(() => {
    drawer.hidden = true;
  }, 260);
}

async function checkout() {
  const btn = document.getElementById('merchDrawerCheckout') as HTMLButtonElement;
  if (!cart.length) return;
  btn.disabled = true;
  btn.textContent = 'Redirecting…';
  try {
    const r = await fetch('/api/merch/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(l => {
          const item = findItem(l.slug);
          return {
            slug: l.slug,
            sync_variant_id: l.sync_variant_id,
            size: l.size,
            quantity: l.quantity,
            price: l.price,
            title: l.title,
            mockup: item?.mockup ?? ''
          };
        })
      })
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Checkout failed: ${r.status} ${err.slice(0, 200)}`);
    }
    const data = (await r.json()) as { url?: string };
    if (data.url) window.location.href = data.url;
    else throw new Error('No checkout URL');
  } catch (e) {
    alert(
      `Checkout error — ${(e as Error).message}\n\nIf this persists, you can buy direct at https://bz-music.printful.me`
    );
    btn.disabled = false;
    btn.textContent = 'Checkout →';
  }
}

function buildSelectors(card: HTMLAnchorElement) {
  const slug = card.dataset.slug;
  if (!slug) return;
  const item = findItem(slug);
  if (!item) return;
  const variants = (item.variants ?? []).filter(v => v.in_stock);
  if (!variants.length) return;

  // Keep the storefront href so the card stays a CRAWLABLE link (Lighthouse
  // crawlable-anchors / SEO — stripping it left a dead <a> that search engines
  // can't follow), but preventDefault on bare-card clicks so it reads as an
  // interactive add-to-cart widget instead of navigating away. The size/add
  // buttons stopPropagation, so only clicks on the card chrome are caught here.
  card.classList.add('merch-card--interactive');
  card.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.merch-card__cta')) return;
    e.preventDefault();
  });

  // Find the CTA row and replace its contents
  const cta = card.querySelector('.merch-card__cta');
  if (!cta) return;
  cta.innerHTML = `
    <div class="merch-card__size-picker">
      ${variants.map((v, i) => `<button type="button" class="merch-card__size${i === Math.min(1, variants.length - 1) ? ' is-active' : ''}" data-size="${v.size}">${v.size}</button>`).join('')}
    </div>
    <button type="button" class="merch-card__add">
      <span>Add — $${item.price}</span>
    </button>
  `;

  const sizeBtns = cta.querySelectorAll('.merch-card__size');
  sizeBtns.forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      sizeBtns.forEach(b => b.classList.remove('is-active'));
      (btn as HTMLElement).classList.add('is-active');
    });
  });

  const addBtn = cta.querySelector('.merch-card__add') as HTMLButtonElement;
  addBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const active = cta.querySelector('.merch-card__size.is-active') as HTMLElement;
    const size = active?.dataset.size;
    if (!size) return;
    const variant = findVariant(slug, size);
    if (!variant) return;
    const existing = cart.find(l => l.sync_variant_id === variant.sync_variant_id);
    if (existing) existing.quantity = Math.min(20, existing.quantity + 1);
    else {
      cart.push({
        slug,
        title: item.title,
        size,
        sync_variant_id: variant.sync_variant_id,
        price: parseFloat(variant.retail_price),
        mockup: item.mockup,
        quantity: 1
      });
    }
    saveCart();
    updateFab();
    // Visual feedback
    addBtn.classList.add('merch-card__add--added');
    addBtn.querySelector('span')!.textContent = `Added ✓`;
    setTimeout(() => {
      addBtn.classList.remove('merch-card__add--added');
      addBtn.querySelector('span')!.textContent = `Add — $${item.price}`;
    }, 1200);
    // Tiny haptic on mobile
    if ('vibrate' in navigator) navigator.vibrate(15);
  });

  // Whole-card click → open drawer (or do nothing if the click was on a control)
  card.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('button')) return; // controls handle their own clicks
    e.preventDefault();
    openDrawer();
  });
}

async function renderSuccessIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get('session_id');
  if (!sid) return;
  // Strip session_id from URL so refresh doesn't re-prompt
  const clean = new URL(window.location.href);
  clean.searchParams.delete('session_id');
  history.replaceState({}, '', clean.toString());

  const article = document.querySelector('.contentpage__article');
  if (!article) return;
  const banner = document.createElement('div') as HTMLDivElement;
  banner.className = 'merch-success';
  banner.innerHTML = `
    <div class="merch-success__head">
      <div class="merch-success__icon" aria-hidden="true">✓</div>
      <div>
        <h3 class="merch-success__title">Order received</h3>
        <p class="merch-success__sub">Printful is making this for you now. Tracking arrives in 2-3 business days when it ships.</p>
      </div>
    </div>
    <div class="merch-success__body" id="merchSuccessBody">
      <p>Loading order summary…</p>
    </div>
  `;
  (article as HTMLElement).insertBefore(banner, article.firstChild);

  // Cart is consumed on successful checkout
  cart = [];
  saveCart();
  updateFab();

  try {
    const r = await fetch(`/api/merch/success?session_id=${encodeURIComponent(sid)}`);
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as {
      amount_total: number;
      email: string;
      items?: Array<{ description: string; quantity: number; amount_total: number }>;
    };
    const body = document.getElementById('merchSuccessBody');
    if (body) {
      const total = (data.amount_total / 100).toFixed(2);
      const itemsHtml = (data.items ?? [])
        .map(li => `<li>${li.quantity} × ${li.description} — $${(li.amount_total / 100).toFixed(2)}</li>`)
        .join('');
      body.innerHTML = `
        <p>Receipt sent to <strong>${data.email}</strong>. Order total <strong>$${total}</strong>.</p>
        <ul>${itemsHtml}</ul>
        <p style="font-size:0.85rem;color:var(--ink-mute);">Questions? Reply to the receipt email or <a href="mailto:hey@megabyte.space">hey@megabyte.space</a>.</p>
      `;
    }
  } catch {
    const body = document.getElementById('merchSuccessBody');
    if (body)
      body.innerHTML =
        '<p>Receipt details unavailable, but Printful confirmed the order. Check the email Stripe sent for the receipt.</p>';
  }
}

export async function setupMerchCart(): Promise<void> {
  cart = loadCart();
  ensureFab();
  updateFab();
  await loadSuite();

  // Bind each merch card
  const cards = document.querySelectorAll<HTMLAnchorElement>('.merch-card');
  cards.forEach((c, i) => {
    // Tag the card with its slug from suite order
    const slug = suiteCache?.items.filter(it => it.mockup)[i]?.slug;
    if (slug) {
      c.dataset.slug = slug;
      buildSelectors(c);
    }
  });

  await renderSuccessIfPresent();
  setupTocScrollSpy();
}

/** Highlight the sticky TOC link for whichever merch section is in view. Uses
 *  IntersectionObserver against the section anchors; smooth-scrolls on click
 *  inside the content-page scroll container (not the document). */
function setupTocScrollSpy(): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.merch-toc__link'));
  if (!links.length) return;
  const scroller = document.querySelector('.contentpage__scroll') as HTMLElement | null;

  links.forEach(link => {
    link.addEventListener('click', e => {
      const id = link.dataset.merchToc;
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const byId = new Map(links.map(l => [l.dataset.merchToc, l]));
  const setActive = (id: string | null) => {
    links.forEach(l => l.classList.toggle('is-active', l.dataset.merchToc === id));
  };
  const sections = links
    .map(l => l.dataset.merchToc && document.getElementById(l.dataset.merchToc))
    .filter((el): el is HTMLElement => !!el);
  if (!sections.length) return;

  const io = new IntersectionObserver(
    entries => {
      // Pick the topmost intersecting section.
      const visible = entries
        .filter(en => en.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) {
        const id = visible[0].target.id;
        if (byId.has(id)) setActive(id);
      }
    },
    { root: scroller ?? null, rootMargin: '-10% 0px -70% 0px', threshold: 0 }
  );
  sections.forEach(s => io.observe(s));
  setActive(sections[0].id);
}

/** Called by main.ts after content-page render — checks current slug. */
export function bootIfMerchPage(slug: string): void {
  if (slug === 'merch') {
    setupMerchCart().catch(err => console.warn('merch cart boot failed', err));
  }
}
