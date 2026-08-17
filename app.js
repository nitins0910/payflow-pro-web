// ============================================================
// PayFlow Pro — Single-file app
// (Firebase config + Firestore API + Auth + Email Verification + Dashboard)
// ============================================================

// ---------------------------------------------------------
// 1. FIREBASE CONFIG
// These values are PUBLIC and safe to have in client code —
// real security is enforced by Firestore rules + Firebase Auth.
// ---------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyC17VDG73Klmg8IwCA_cTbtMdIG9trwd5k",
  authDomain: "payflow-pro-4070a.firebaseapp.com",
  projectId: "payflow-pro-4070a",
  storageBucket: "payflow-pro-4070a.firebasestorage.app",
  messagingSenderId: "769845474274",
  appId: "1:769845474274:web:0c2c6fd093ccd41715bfbb"
};

firebase.initializeApp(firebaseConfig);

// ---------------------------------------------------------
// 1a. THEME (Dark / Light)
// Light is the default theme everywhere. In the CSS (style.css), the
// dark-navy palette lives on :root and the light palette is the
// html[data-theme="light"] override — that mapping is unchanged, we
// just make sure "light" is what gets applied by default now. This
// preference only ever applies to the DASHBOARD; the sign-in/sign-up
// /verification screens are always forced to light, for every user,
// no exceptions — that's handled centrally in showScreen() below.
//
// The preference is synced two ways so it follows the user across
// devices, not just this one browser:
//   - localStorage: a same-device cache, applied instantly so there's
//     no flash of the wrong theme while Firestore is still loading.
//   - Firestore (users/{uid}.theme): the source of truth. Written on
//     every toggle, and re-read on every dashboard boot (loadUserTheme)
//     so a change made on one device shows up on another next time
//     that device opens/refreshes the dashboard.
// ---------------------------------------------------------
const THEME_STORAGE_KEY = 'payflow-theme';

function getStoredTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { return null; }
}
function isLightTheme() { return document.documentElement.getAttribute('data-theme') === 'light'; }
function applyTheme(theme, opts) {
  opts = opts || {};
  if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
  try { localStorage.setItem(THEME_STORAGE_KEY, theme === 'dark' ? 'dark' : 'light'); } catch (e) { /* ignore */ }

  const toggle = document.getElementById('darkModeToggle');
  if (toggle) toggle.checked = theme === 'dark';

  // Persist to the user's Firestore profile too, so the preference
  // follows them to any other device/browser they sign in on — not
  // just this one (localStorage above is purely a same-device cache
  // used to avoid a flash-of-wrong-theme before Firestore responds).
  // Skipped when we're just applying a value we already loaded FROM
  // Firestore (loadUserTheme below), and silently ignored if the
  // write fails (e.g. offline) — the toggle still works locally and
  // will sync again next time it succeeds.
  if (!opts.skipRemoteSave && currentUserId) {
    userRef().set({ theme }, { merge: true }).catch(() => { /* non-fatal */ });
  }
}
function wireThemeToggle() {
  const toggle = document.getElementById('darkModeToggle');
  if (!toggle) return;
  toggle.checked = !isLightTheme();
  toggle.addEventListener('change', () => {
    applyTheme(toggle.checked ? 'dark' : 'light');
  });
}

// Called once per dashboard boot (alongside loadEmployees/loadCompanyProfile)
// to pull the user's saved theme from Firestore and apply it — so a
// preference set on one device (e.g. switched to light on mobile) shows
// up on another (e.g. desktop, on its next refresh) instead of each
// browser only ever remembering its own localStorage value. Falls back
// silently to whatever showScreen() already applied from the local
// device cache if the fetch fails or no preference is saved yet.
async function loadUserTheme() {
  try {
    const snap = await userRef().get();
    const saved = snap.exists ? snap.data().theme : null;
    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved, { skipRemoteSave: true });
    }
  } catch (e) { /* offline / permissions blip — keep current theme as-is */ }
}

// ---------------------------------------------------------
// 1b. APP CHECK — blocks scripted / bot signups & requests
// that don't come from this real web app, so someone can't
// just hammer createUserWithEmailAndPassword in a loop and
// burn through the free Firebase quota.
//
// SETUP REQUIRED (one-time, in Firebase Console):
//   1. Console → Build → App Check → Apps → register this web app
//      with the "reCAPTCHA v3" provider.
//   2. Copy the site key it gives you and paste it below in place
//      of "PASTE_YOUR_RECAPTCHA_V3_SITE_KEY_HERE".
//   3. Console → App Check → APIs tab → mark "Firestore" and
//      "Authentication" as Enforced (not just Monitored).
// Until you do this, App Check runs in a harmless no-op state —
// it does NOT block anything on its own.
// ---------------------------------------------------------
const RECAPTCHA_V3_SITE_KEY = "6LcGm4UtAAAAAE6U6J4olvwUW4RDKVcJ0cHTMZ54";
if (RECAPTCHA_V3_SITE_KEY && RECAPTCHA_V3_SITE_KEY.indexOf("PASTE_YOUR") !== 0) {
  firebase.appCheck().activate(
    new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
    true // auto-refresh the token
  );
} else {
  console.warn('[App Check] Not activated — RECAPTCHA_V3_SITE_KEY is still a placeholder. Signups are NOT yet protected from bot abuse. See comment above.');
}

const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// LOCAL persistence (Firebase's own default, and what almost every
// consumer web app uses — Gmail, banking apps, etc.): the sign-in
// state lives in durable, origin-scoped storage (IndexedDB), not tied
// to a single browser tab. Users stay signed in across reloads, new
// tabs, and even fully closing and reopening the browser — until they
// explicitly tap "Logout".
//
// We used to use SESSION persistence (tab-scoped sessionStorage) so
// that closing the tab/browser would auto sign-out. That backfired on
// mobile: opening the Terms/Privacy link (target="_blank") spawns a
// new tab, and on memory-constrained phones the browser would often
// silently discard and later reload the original app tab in the
// background. SESSION storage doesn't reliably survive that, so
// returning to the app after just reading the Terms could dump the
// user back on the Sign In screen mid-consent, even though they never
// actually logged out. LOCAL persistence isn't tied to any one tab's
// lifecycle, so that whole class of bug goes away.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
  console.warn('[Auth] Could not set persistence:', err.message);
});

// IMPORTANT: this must be your real, live Firebase Hosting URL
// (or custom domain once you attach one). It's what makes the
// verification email link open THIS app instead of Firebase's
// generic default page.
const SITE_URL = "https://nitins0910.github.io/payflow-pro-web/";
const actionCodeSettings = { url: SITE_URL, handleCodeInApp: true };

// ---------------------------------------------------------
// 1b. BILLING CONFIG — credit wallet
// Every new user gets FREE_SIGNUP_CREDITS free credits on signup (50,
// see api/lib/creditPacks.js). Every export costs
// EXPORT_COST_CREDITS credits, deducted from the wallet balance
// (free or purchased credits spend the same way). When the balance
// runs out, the user buys a credit pack — bigger packs cost less per
// credit. The functions below live on Vercel (see /api) and do the
// actual enforcement + Razorpay verification server-side, so none of
// this can be bypassed by editing this file in devtools.
//
// This list mirrors api/lib/creditPacks.js for rendering only — the
// ACTUAL price charged always comes from that server-side file, never
// from here, so editing this array client-side changes nothing about
// what gets billed.
//
// IMPORTANT: point this at wherever the Vercel functions are actually
// deployed. If this static site is hosted on the SAME Vercel project as
// the functions, "" (relative) is correct as-is. If the site stays on
// GitHub Pages (or anywhere else) while only the functions live on
// Vercel — which is the current setup — this needs the full Vercel
// deployment URL, e.g. "https://payflow-pro-web-three.vercel.app".
// ---------------------------------------------------------
const FUNCTIONS_BASE_URL = "https://payflow-pro-web-three.vercel.app/"; // "" = same origin, or "https://your-project.vercel.app"

const EXPORT_COST_CREDITS = 5;

// Bump this whenever the Terms of Service / Privacy Policy materially
// change — existing users whose stored termsVersion is lower than this
// will see the consent gate again on their next login.
const TERMS_VERSION = 1;

const CREDIT_PACKS = [
  { id: 'pack_5', credits: 5, priceRupees: 50, discountPct: 0, label: 'Quick top-up' },
  { id: 'pack_15', credits: 15, priceRupees: 135, discountPct: 10, label: '' },
  { id: 'pack_30', credits: 30, priceRupees: 240, discountPct: 20, label: 'Popular' },
  { id: 'pack_60', credits: 60, priceRupees: 420, discountPct: 30, label: '' },
  { id: 'pack_120', credits: 120, priceRupees: 720, discountPct: 40, label: 'Best value' }
];

// The pack whose credits exactly match one export's cost — this is what
// "Pay via Razorpay" on the export-confirm modal charges directly (flat
// ₹50, no pack picker). Bulk-discount packs are only ever offered from
// the Wallet page itself, not mid-export.
const EXPORT_RAZORPAY_PACK = CREDIT_PACKS.find(p => p.credits === EXPORT_COST_CREDITS) || CREDIT_PACKS[0];

// Biggest bulk-discount percentage across all packs — used to tease the
// Wallet page's recharge discounts from the export-confirm modal without
// actually showing the pack picker there.
const MAX_PACK_DISCOUNT_PCT = Math.max(...CREDIT_PACKS.map(p => p.discountPct));

// ---------------------------------------------------------
// CUSTOM CREDIT AMOUNT — mirrors api/lib/creditPacks.js's
// CUSTOM_CREDIT_DISCOUNT_TIERS / priceForCustomCredits() exactly, for
// live preview only, the same way CREDIT_PACKS above mirrors the fixed
// packs. The ₹ amount actually charged always comes back from
// create-order.js (server-side) — this is display-only.
// ---------------------------------------------------------
const CUSTOM_CREDIT_MIN = 1;
const CUSTOM_CREDIT_MAX = 100000;
const CUSTOM_CREDIT_DISCOUNT_TIERS = [
  { minCredits: 120, discountPct: 40 },
  { minCredits: 60, discountPct: 30 },
  { minCredits: 30, discountPct: 20 },
  { minCredits: 15, discountPct: 10 },
  { minCredits: 1, discountPct: 0 }
];
function previewCustomCreditPrice(credits) {
  if (!Number.isInteger(credits) || credits < CUSTOM_CREDIT_MIN || credits > CUSTOM_CREDIT_MAX) return null;
  const tier = CUSTOM_CREDIT_DISCOUNT_TIERS.find(t => credits >= t.minCredits);
  const discountPct = tier ? tier.discountPct : 0;
  const priceRupees = Math.round(credits * BASE_RUPEES_PER_CREDIT * (1 - discountPct / 100));
  return { credits, priceRupees, discountPct };
}
// Mirrors BASE_RUPEES_PER_CREDIT from api/lib/creditPacks.js, for the
// preview calculation above only.
const BASE_RUPEES_PER_CREDIT = 10;

let walletBalance = 0;

async function callBillingFunction(name, body) {
  // Strip any trailing slash on FUNCTIONS_BASE_URL before joining, so we
  // never end up with a double slash like ".app//api/...".
  const base = FUNCTIONS_BASE_URL.replace(/\/+$/, '');
  const idToken = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(`${base}/api/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    // Network failure or a CORS-blocked response lands here as a
    // rejected fetch — surface it as a normal "not ok" result instead
    // of letting it throw, so callers never hang.
    return { ok: false, status: 0, data: { error: 'Could not reach the billing server. Check your connection and try again.' } };
  }
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

// Called once per dashboard boot (every login). Idempotent server-side —
// only the very first call for a given user actually grants the free
// signup credits; every call after that just reads the current balance back.
// Returns the server response ({ credits, granted }) so bootDashboard()
// can decide how to schedule the guided tour, or null on failure.
async function initWallet() {
  const res = await callBillingFunction('init-wallet');
  if (!res.ok) {
    toast((res.data && res.data.error) || 'Could not load your wallet.', 'error');
    return null;
  }
  setWalletBalance(res.data.credits);
  if (res.data.granted) {
    showFreeCreditsModal(res.data.credits);
  }
  return res.data;
}

function setWalletBalance(credits) {
  walletBalance = Number(credits) || 0;
  const chip = document.getElementById('walletBalanceValue');
  if (chip) chip.textContent = walletBalance;
  const chipBtn = document.getElementById('walletChip');
  if (chipBtn) chipBtn.title = `Wallet — ${walletBalance} credit${walletBalance === 1 ? '' : 's'}`;
  const mobileChip = document.getElementById('walletBalanceValueMobile');
  if (mobileChip) mobileChip.textContent = walletBalance;
  const mobileChipBtn = document.getElementById('walletChipMobile');
  if (mobileChipBtn) mobileChipBtn.title = `Wallet — ${walletBalance} credit${walletBalance === 1 ? '' : 's'}`;
  const pageBalance = document.getElementById('walletPageBalance');
  if (pageBalance) pageBalance.textContent = walletBalance;
}

function showFreeCreditsModal(credits) {
  const modal = document.getElementById('freeCreditsModal');
  if (!modal) return;
  document.getElementById('freeCreditsAmount').textContent = credits;
  modal.classList.remove('hidden');
}

// Set right before showing the free-credits modal for a brand-new
// signup — tells closeFreeCreditsModal() to launch the guided tour
// immediately once the user dismisses the "Congratulations" dialog,
// so the walkthrough feels like the very next step of onboarding
// rather than a separate, disconnected popup later.
let pendingTourAfterCredits = false;

function closeFreeCreditsModal() {
  const modal = document.getElementById('freeCreditsModal');
  if (modal) modal.classList.add('hidden');
  if (pendingTourAfterCredits) {
    pendingTourAfterCredits = false;
    // Small delay so the modal-close feels finished before the tour's
    // spotlight overlay appears, instead of the two fighting on-screen.
    setTimeout(() => startTour(), 300);
  }
}

function wireFreeCreditsModal() {
  const closeBtn = document.getElementById('freeCreditsCloseBtn');
  const goBtn = document.getElementById('freeCreditsGoBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeFreeCreditsModal);
  if (goBtn) goBtn.addEventListener('click', closeFreeCreditsModal);
}

// ---------------------------------------------------------
// "Add to Home Screen" guide — reachable from Settings (after
// sign-in) as an in-app modal. Switches between an Android/Chrome
// tab and an iOS/Safari tab, since the two platforms use different
// menus to install a site as a home-screen app.
//
// The login-screen entry point (before sign-in, mobile only) is now
// a plain link to the standalone add-to-home-screen.html page
// instead of this modal — see authPwaGuideLink in wirePwaGuideModal().
// ---------------------------------------------------------
function openPwaGuideModal() {
  const modal = document.getElementById('pwaGuideModal');
  if (modal) modal.classList.remove('hidden');
}

// ---------------------------------------------------------
// Real install trigger. Previously both "Add to Home Screen" buttons
// only ever opened the manual how-to guide — which works, but reads
// as "the button doesn't do anything" on Android/Chrome, where the
// browser can actually install the app natively with one tap. Chrome/
// Edge fire `beforeinstallprompt` once the site meets installability
// criteria (a web app manifest + a registered service worker, both
// added alongside this — see manifest.json / sw.js); we capture that
// event and fire it on demand instead of letting the browser show its
// own mini-infobar.
//
// iOS Safari has no such API at all, and Chrome won't fire the event
// if the app is already installed or the browser hasn't decided it's
// installable yet — triggerInstallOrGuide() below always falls back
// to the manual guide in every one of those cases, so the button never
// does nothing.
// ---------------------------------------------------------
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('PayFlow Pro installed — find it on your home screen.', 'success');
});

// Already running as an installed app (standalone display mode)? Hide
// both install entry points instead of showing a guide for something
// that's already done. Covers Android/Chrome (display-mode media
// query) and iOS Safari (navigator.standalone) with the same check.
function isRunningInstalled() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
}

async function triggerInstallOrGuide() {
  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    promptEvent.prompt();
    try {
      const { outcome } = await promptEvent.userChoice;
      if (outcome !== 'accepted') openPwaGuideModal();
    } catch (e) {
      openPwaGuideModal();
    }
    return;
  }
  // No native prompt ready (iOS Safari, not installable yet, or this
  // is a repeat call) — the manual guide always works as a fallback.
  openPwaGuideModal();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('[PWA] Service worker registration failed:', err.message);
    });
  });
}

// ---------------------------------------------------------
// Sidebar expand/collapse — desktop only (the mobile drawer is a
// temporary overlay with its own hamburger open/close and always
// shows full labels, see the max-width:800px CSS block). Collapsed
// (icon rail only) is the default; clicking the toggle expands it,
// and clicking anywhere outside the sidebar — or the toggle again —
// collapses it back. The choice is remembered across visits via
// localStorage.
// ---------------------------------------------------------
const SIDEBAR_COLLAPSE_KEY = 'pfp_sidebar_collapsed';

function wireSidebarCollapse() {
  const sidebar = document.querySelector('.sidebar');
  const toggleBtn = document.getElementById('sidebarCollapseBtn');
  if (!sidebar || !toggleBtn) return;

  const applyState = (collapsed) => {
    sidebar.classList.toggle('is-collapsed', collapsed);
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('data-tooltip', collapsed ? 'Expand' : 'Collapse');
  };

  const setCollapsed = (collapsed) => {
    applyState(collapsed);
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(collapsed)); } catch (e) { /* ignore */ }
  };

  // Collapsed is the default the very first time (nothing saved yet)
  // — only an explicit past choice keeps it expanded on load.
  let collapsed = true;
  try {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (saved !== null) collapsed = saved === 'true';
  } catch (e) { /* ignore */ }
  applyState(collapsed);

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setCollapsed(!sidebar.classList.contains('is-collapsed'));
  });

  // Clicking anywhere outside the sidebar — the main content, empty
  // space, anywhere — collapses it back if it's currently expanded.
  // Desktop only: on the mobile drawer, .is-collapsed has no layout
  // effect (see the max-width:800px CSS), and the drawer already has
  // its own open/close via the hamburger, backdrop, and × button.
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 800) return;
    if (sidebar.classList.contains('is-collapsed')) return;
    if (sidebar.contains(e.target)) return;
    setCollapsed(true);
  });
}

function wirePwaGuideModal() {
  registerServiceWorker();

  // Login screen (mobile, pre-auth): a plain link straight to
  // add-to-home-screen.html — a full standalone guide page — instead
  // of a button that opens the in-app modal. Nothing to wire up here
  // except hiding it once the app is already installed.
  const authLink = document.getElementById('authPwaGuideLink');
  const settingsBtn = document.getElementById('openPwaGuideBtn');
  if (isRunningInstalled()) {
    if (authLink) authLink.classList.add('hidden');
    if (settingsBtn) settingsBtn.classList.add('hidden');
  } else {
    if (settingsBtn) settingsBtn.addEventListener('click', triggerInstallOrGuide);
  }

  const tabs = document.querySelectorAll('.pwa-guide-tab');
  const panels = { android: document.getElementById('pwaGuideAndroid'), ios: document.getElementById('pwaGuideIos') };
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.pwaTab;
      Object.keys(panels).forEach(key => {
        if (panels[key]) panels[key].classList.toggle('hidden', key !== target);
      });
    });
  });

  // Default to the platform the visitor is actually on, so the more
  // relevant tab is already open when the modal appears.
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isIOS) {
    const iosTab = document.querySelector('.pwa-guide-tab[data-pwa-tab="ios"]');
    if (iosTab) iosTab.click();
  }
}

// Opens Razorpay's hosted checkout for a specific credit pack. Resolves
// true only after the payment has been verified server-side
// (verify-payment.js) — never on the client-side success callback alone.
//
// `purpose` tags WHY the money is being paid — 'recharge' (topping up
// the wallet from the Wallet page, to spend later) or 'export' (the
// export-confirm modal's "Pay via Razorpay" button, paying for exactly
// one export right now). It travels through create-order's order notes
// and comes back on the verified transaction record, so the Payment
// History page can show what each real payment was actually for. It
// has no effect on price or credits — those still only ever come from
// the server-side pack lookup.
function buyCreditPack(pack, purpose = 'recharge') {
  return new Promise(async (resolve) => {
    const orderBody = { packId: pack.id, purpose };
    // pack.id === 'custom' comes from the Wallet page's "load a custom
    // amount" input (see wireCustomCreditPurchase()) — the requested
    // credit count has to travel to create-order.js so it can look up
    // the correct volume-discount tier server-side; pack.priceRupees
    // here is display-only and never what actually gets charged.
    if (pack.id === 'custom') orderBody.customCredits = pack.credits;
    const order = await callBillingFunction('create-order', orderBody);
    if (!order.ok) {
      toast((order.data && order.data.error) || 'Could not start payment. Please try again.', 'error');
      resolve(false);
      return;
    }
    if (typeof Razorpay === 'undefined') {
      toast('Payment library failed to load. Please check your connection and try again.', 'error');
      resolve(false);
      return;
    }

    const rzp = new Razorpay({
      key: order.data.keyId,
      order_id: order.data.orderId,
      amount: order.data.amount,
      currency: order.data.currency,
      name: 'PayFlow Pro',
      description: `${pack.credits} export credits`,
      prefill: { email: currentUser ? currentUser.email : '' },
      theme: { color: '#2563EB' },
      handler: async function (response) {
        const verify = await callBillingFunction('verify-payment', {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature
        });
        if (verify.ok && verify.data.verified) {
          setWalletBalance(verify.data.creditsRemaining);
          if (verify.data.alreadyProcessed) {
            toast(`Balance updated — ${verify.data.creditsRemaining} credits.`, 'success');
          } else {
            toast(`Payment successful — ${verify.data.creditsAdded} credits added.`, 'success');
          }
          resolve(true);
        } else {
          toast((verify.data && verify.data.error) || 'Payment verification failed.', 'error');
          resolve(false);
        }
      },
      modal: {
        ondismiss: function () { resolve(false); }
      }
    });
    rzp.on('payment.failed', function () {
      toast('Payment failed. Please try again.', 'error');
      resolve(false);
    });
    rzp.open();
  });
}

// Renders the pack cards into any container (the low-balance modal or
// the full Wallet page share this markup) and wires each Buy button.
// onBought is called (with the new balance already applied) after a
// verified purchase.
function renderCreditPacks(container, onBought) {
  container.innerHTML = CREDIT_PACKS.map(p => `
    <div class="credit-pack-card">
      ${p.label ? `<span class="credit-pack-card__badge">${p.label}</span>` : ''}
      ${p.discountPct ? `<span class="credit-pack-card__discount">${p.discountPct}% off</span>` : ''}
      <div class="credit-pack-card__credits">${p.credits} credits</div>
      <div class="credit-pack-card__price">₹${p.priceRupees}</div>
      <div class="credit-pack-card__rate">₹${(p.priceRupees / p.credits).toFixed(1)}/credit</div>
      <button type="button" class="btn-inline primary" style="width:100%;" data-pack="${p.id}">Buy</button>
    </div>
  `).join('');

  container.querySelectorAll('button[data-pack]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pack = CREDIT_PACKS.find(p => p.id === btn.dataset.pack);
      const prevLabel = btn.textContent;
      btn.disabled = true; btn.textContent = 'Opening payment...';
      const ok = await buyCreditPack(pack, 'recharge');
      btn.disabled = false; btn.textContent = prevLabel;
      if (ok && onBought) onBought();
    });
  });
}

function renderWalletPage() {
  setWalletBalance(walletBalance);
  const grid = document.getElementById('walletPackGrid');
  if (grid) renderCreditPacks(grid, () => {});
  renderWalletTransactions();
}

// Wires the "load a custom amount" box on the Wallet page — lets a user
// type any number of credits instead of only picking a fixed pack size,
// priced with the same volume-discount tiers the packs use (see
// previewCustomCreditPrice() above and priceForCustomCredits() in
// api/lib/creditPacks.js, which is what actually decides the charge).
function wireCustomCreditPurchase() {
  const input = document.getElementById('customCreditInput');
  const preview = document.getElementById('customCreditPreview');
  const btn = document.getElementById('buyCustomCreditBtn');
  if (!input || !preview || !btn) return;

  function updatePreview() {
    const credits = parseInt(input.value, 10);
    const priced = previewCustomCreditPrice(credits);
    if (!priced) {
      preview.textContent = input.value ? `Enter a whole number between ${CUSTOM_CREDIT_MIN} and ${CUSTOM_CREDIT_MAX}.` : '';
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    const rate = (priced.priceRupees / priced.credits).toFixed(1);
    preview.textContent = priced.discountPct
      ? `₹${priced.priceRupees} for ${priced.credits} credits (₹${rate}/credit — ${priced.discountPct}% off)`
      : `₹${priced.priceRupees} for ${priced.credits} credits (₹${rate}/credit)`;
  }
  input.addEventListener('input', updatePreview);
  updatePreview();

  btn.addEventListener('click', async () => {
    const credits = parseInt(input.value, 10);
    const priced = previewCustomCreditPrice(credits);
    if (!priced) return;
    const prevLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Opening payment...';
    const ok = await buyCreditPack({ id: 'custom', credits: priced.credits, priceRupees: priced.priceRupees }, 'recharge');
    btn.textContent = prevLabel;
    updatePreview();
    if (ok) input.value = '';
  });
}

// Labels/icons for each transaction type written by the billing
// functions (see consume-credits.js, verify-payment.js, init-wallet.js).
const TRANSACTION_TYPE_META = {
  credit_purchase: { label: 'Credit Purchase', icon: '🛒', cls: 'txn-credit' },
  export_debit: { label: 'Payroll Export', icon: '📤', cls: 'txn-debit' },
  free_signup_credit: { label: 'Free Signup Credits', icon: '🎉', cls: 'txn-credit' }
};

function formatTxnTimestamp(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '—';
  const d = ts.toDate();
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Pulls the signed-in user's credit transaction history (purchases,
// export debits, free-signup grant) and renders it as a table on the
// Wallet page. Read-only data — see firestore.rules and
// Api.getTransactions().
async function renderWalletTransactions() {
  const body = document.getElementById('walletTxnTableBody');
  const emptyState = document.getElementById('walletTxnEmptyState');
  const loading = document.getElementById('walletTxnLoading');
  if (!body) return;

  if (loading) loading.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');
  body.innerHTML = '';

  let rows = [];
  try {
    rows = await Api.getTransactions();
  } catch (e) {
    if (loading) loading.classList.add('hidden');
    body.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--danger, #e5484d);">Could not load transaction history.</td></tr>`;
    return;
  }
  if (loading) loading.classList.add('hidden');

  if (!rows.length) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  body.innerHTML = rows.map(r => {
    const meta = TRANSACTION_TYPE_META[r.type] || { label: r.type || 'Transaction', icon: '•', cls: '' };
    const isCredit = Number(r.credits) > 0;
    const creditsLabel = `${isCredit ? '+' : ''}${r.credits} credits`;
    const amount = r.type === 'credit_purchase' && r.amountRupees ? `₹${Number(r.amountRupees).toFixed(2)}` : '—';
    return `
      <tr>
        <td data-label="Date">${formatTxnTimestamp(r.createdAt)}</td>
        <td data-label="Type"><span class="txn-type ${meta.cls}">${meta.icon} ${escapeHtml(meta.label)}</span></td>
        <td data-label="Credits" class="${isCredit ? 'txn-amount-positive' : 'txn-amount-negative'}">${creditsLabel}</td>
        <td data-label="Amount">${amount}</td>
      </tr>
    `;
  }).join('');
}

// Labels for the `purpose` tag stored on every 'credit_purchase'
// transaction (set in buyCreditPack() -> create-order -> verify-payment).
// Older payments made before this field existed have no `purpose` at
// all — those are shown as "Wallet Recharge" too, since that was the
// only kind of payment possible back then.
const PAYMENT_PURPOSE_META = {
  export: { label: 'Payroll export payment', icon: '📤' },
  recharge: { label: 'Wallet recharge', icon: '🔋' }
};

// Payment History page — real-money receipts only (every Razorpay
// payment that actually charged the user), pulled from the same
// users/{uid}/transactions collection as the Wallet page's credit
// ledger but filtered down to type === 'credit_purchase' and shown
// with what the payment was actually FOR. Read-only, same data source
// as renderWalletTransactions() (Api.getTransactions()) — nothing new
// to fetch, just a different view of it.
async function renderPaymentHistory() {
  const body = document.getElementById('paymentHistoryTableBody');
  const emptyState = document.getElementById('paymentHistoryEmptyState');
  const loading = document.getElementById('paymentHistoryLoading');
  if (!body) return;

  if (loading) loading.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');
  body.innerHTML = '';

  let rows = [];
  try {
    const all = await Api.getTransactions();
    rows = all.filter(r => r.type === 'credit_purchase');
  } catch (e) {
    if (loading) loading.classList.add('hidden');
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger, #e5484d);">Could not load payment history.</td></tr>`;
    return;
  }
  if (loading) loading.classList.add('hidden');

  if (!rows.length) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  body.innerHTML = rows.map(r => {
    const purposeMeta = PAYMENT_PURPOSE_META[r.purpose] || PAYMENT_PURPOSE_META.recharge;
    const amount = r.amountRupees ? `₹${Number(r.amountRupees).toFixed(2)}` : '—';
    const paymentId = r.paymentId ? `<span style="font-family:var(--font-mono); font-size:12px;">${escapeHtml(r.paymentId)}</span>` : '—';
    return `
      <tr>
        <td data-label="Date">${formatTxnTimestamp(r.createdAt)}</td>
        <td data-label="Paid for"><span class="txn-type">${purposeMeta.icon} ${escapeHtml(purposeMeta.label)}</span></td>
        <td data-label="Amount">${amount}</td>
        <td data-label="Credits" class="txn-amount-positive">+${r.credits} credits</td>
        <td data-label="Payment ID">${paymentId}</td>
        <td data-label="Status"><span class="txn-type txn-credit">✓ Paid</span></td>
      </tr>
    `;
  }).join('');
}

// ---------------------------------------------------------
// 2. FIRESTORE DATA LAYER (unchanged from firestore-api.js)
// ---------------------------------------------------------
let currentUserId = null;

async function initUserContext(uid) {
  currentUserId = uid;
}

function userRef() {
  return db.collection('users').doc(currentUserId);
}

// ---------------------------------------------------------
// 1c. TERMS & PRIVACY CONSENT GATE
// Blocks the entire app — nothing behind the modal is reachable, since
// it's a full-screen .modal-backdrop with no close button — until the
// signed-in user explicitly agrees to the Terms of Service and Privacy
// Policy. Runs BEFORE initWallet(), so it always appears ahead of the
// "Congratulations, free credits" modal on a brand-new signup, and
// ahead of everything else on every other login too.
//
// Consent is recorded on the user's own Firestore doc (allowed by
// firestore.rules — only the wallet fields are locked to server-only
// writes) with a server-generated timestamp, so the write itself can't
// be backdated from devtools even though the client performs it.
// termsVersion lets a future policy update re-prompt existing users:
// bump TERMS_VERSION above and everyone with an older stored version
// sees the gate again on their next login.
async function ensureTermsAccepted() {
  let alreadyAccepted = false;
  try {
    const snap = await userRef().get();
    const data = snap.exists ? snap.data() : {};
    alreadyAccepted = Number(data.termsVersion || 0) >= TERMS_VERSION;
  } catch (e) {
    // Can't confirm consent was ever recorded — safer to show the gate
    // again than to silently let it slide.
    alreadyAccepted = false;
  }
  if (alreadyAccepted) return;

  await new Promise((resolve) => {
    const modal = document.getElementById('termsGateModal');
    const checkbox = document.getElementById('termsGateCheckbox');
    const agreeBtn = document.getElementById('termsGateAgreeBtn');
    const errEl = document.getElementById('termsGateError');
    if (!modal || !checkbox || !agreeBtn) { resolve(); return; }

    errEl.textContent = '';
    checkbox.checked = false;
    agreeBtn.disabled = true;
    agreeBtn.textContent = 'Agree & Continue';
    modal.classList.remove('hidden');

    checkbox.onchange = () => { agreeBtn.disabled = !checkbox.checked; };

    agreeBtn.onclick = async () => {
      if (!checkbox.checked) return;
      agreeBtn.disabled = true;
      agreeBtn.textContent = 'Saving...';
      errEl.textContent = '';
      try {
        await userRef().set({
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        modal.classList.add('hidden');
        resolve();
      } catch (e) {
        errEl.textContent = 'Could not save your acceptance. Please check your connection and try again.';
        agreeBtn.disabled = false;
        agreeBtn.textContent = 'Agree & Continue';
      }
    };
  });
}

const Api = {
  async getEmployees() {
    const snap = await userRef().collection('employees').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async addEmployee(emp) {
    const existing = await userRef().collection('employees')
      .where('accountNumber', '==', emp.accountNumber).limit(1).get();
    if (!existing.empty) throw new Error(`Account ${emp.accountNumber} already exists.`);
    await userRef().collection('employees').add({
      ...emp, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },
  async updateEmployee(id, emp) {
    await userRef().collection('employees').doc(id).set({
      ...emp, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  async deleteEmployee(id) {
    await userRef().collection('employees').doc(id).delete();
  },
  async bulkAddEmployees(rows) {
    let batch = db.batch();
    let count = 0;
    for (const r of rows) {
      const ref = userRef().collection('employees').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      count++;
      if (count === 450) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  },
  async getCompanyProfile() {
    const doc = await userRef().get();
    const d = doc.exists ? doc.data() : {};
    return {
      name: d.companyName || '',
      accountNumber: d.accountNumber || '',
      ifsc: d.ifsc || '',
      sysId: d.sysId || '',
      bankName: d.bankName || 'SBI',
      // Bank-specific identifiers, only ever relevant/required when
      // that bank is selected — see HDFC/ICICI BankFormatters.
      hdfcClientCode: d.hdfcClientCode || '',
      iciciCorporateId: d.iciciCorporateId || ''
    };
  },
  async updateCompanyProfile({ name, accountNumber, ifsc, sysId, bankName, hdfcClientCode, iciciCorporateId }) {
    await userRef().set({
      companyName: name, accountNumber, ifsc, sysId, bankName,
      hdfcClientCode: hdfcClientCode || '', iciciCorporateId: iciciCorporateId || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  // Runs inside a Firestore transaction, so even if the user has two
  // tabs open and both hit "Export" at the same instant, each export
  // still reads-and-writes the counter atomically — nobody can ever
  // walk away with the same number. That's what actually guarantees
  // uniqueness here, not the number format itself.
  //
  // The counter value is encoded in base-36 (0-9 then A-Z) instead of
  // plain decimal, so the code stays alphanumeric like before but
  // packs far more values into the same width: 4 base-36 characters
  // give 36^4 = ~1.68 million unique exports before the code needs to
  // grow past 4 characters on its own (it never repeats either way —
  // padStart just keeps the width tidy for as long as possible).
  // Need more headroom later? Bump the padStart number below (e.g.
  // 5 or 6) — everything downstream just treats this as a string.
  async getAndIncrementCounter() {
    const counterRef = userRef().collection('meta').doc('fileCounter');
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? (snap.data().value || 1) : 1;
      tx.set(counterRef, { value: current + 1 }, { merge: true });
      return current.toString(36).toUpperCase().padStart(4, '0');
    });
  },
  async addDisbursementRows(rows) {
    let batch = db.batch();
    rows.forEach(r => {
      const ref = userRef().collection('disbursements').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  },
  async getDisbursementHistory() {
    const snap = await userRef().collection('disbursements').orderBy('createdAt', 'desc').limit(500).get();
    return snap.docs.map(d => d.data());
  },
  // Stashes what each employee was actually paid in the batch that was
  // just exported, so the next payroll cycle's Disbursement page can
  // pre-fill the same figure instead of starting blank every time.
  // Silently skips any account number that no longer matches a current
  // employee (e.g. they were deleted after this batch was exported).
  async updateEmployeeLastAmounts(items) {
    const byAcc = new Map(employees.map(e => [String(e.accountNumber), e.id]));
    let batch = db.batch();
    let count = 0;
    for (const { accountNumber, amount } of items) {
      const id = byAcc.get(String(accountNumber));
      if (!id) continue;
      batch.set(userRef().collection('employees').doc(id), { lastAmount: amount }, { merge: true });
      count++;
      if (count === 450) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
  },
  async logAudit(userEmail, userName, action, details) {
    await userRef().collection('auditTrail').add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userEmail, userName, action, details
    });
  },
  async getAuditTrail() {
    const snap = await userRef().collection('auditTrail').orderBy('timestamp', 'desc').limit(300).get();
    return snap.docs.map(d => d.data());
  },
  // Credit transaction history (free-signup grant, purchases, export
  // debits). These rows are written ONLY by the billing functions
  // (Admin SDK) — see firestore.rules, the client has read-only access
  // to this subcollection, same as the credits field itself.
  async getTransactions() {
    const snap = await userRef().collection('transactions').orderBy('createdAt', 'desc').limit(200).get();
    return snap.docs.map(d => d.data());
  }
};

// ---------------------------------------------------------
// 2b. HTML ESCAPING
// Any user-entered value (employee name, audit details, etc.) that
// gets inserted via innerHTML/template strings MUST go through this
// first, or a value like <img src=x onerror=...> in a name field
// would execute as script instead of displaying as text.
// ---------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ---------------------------------------------------------
// 2d. TOAST / CONFIRM SYSTEM
// Replaces native alert()/confirm() everywhere in the app. Native
// dialogs block the whole tab, can't be styled, and look out of place
// next to the rest of the UI. toast() is fire-and-forget (success,
// error, info); confirmDialog() returns a Promise<boolean> so existing
// `if (!confirm(...)) return;` call sites become
// `if (!(await confirmDialog(...))) return;` with minimal disruption.
// ---------------------------------------------------------
// `options` (optional) supports an inline action button, e.g.
// toast('Employee deleted.', 'success', { actionLabel: 'Undo', duration: 5000, onAction: fn })
function toast(message, kind, options) {
  const opts = options || {};
  const host = document.getElementById('toastHost');
  if (!host) { console.warn('[toast]', message); return; }
  const el = document.createElement('div');
  el.className = `toast toast-${kind || 'info'}`;

  const remove = () => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 200);
  };

  if (opts.actionLabel && typeof opts.onAction === 'function') {
    const row = document.createElement('div');
    row.className = 'toast-actions';
    const textEl = document.createElement('span');
    textEl.className = 'toast-text';
    textEl.textContent = message;
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-undo-btn';
    actionBtn.textContent = opts.actionLabel;
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onAction();
      remove();
    });
    row.appendChild(textEl);
    row.appendChild(actionBtn);
    el.appendChild(row);
  } else {
    el.textContent = message;
    el.addEventListener('click', remove);
  }

  // Keyboard dismiss (previously click-only) — pressing Escape closes
  // whatever toasts are currently visible. See the document-level
  // listener at the bottom of this file.
  el._toastRemove = remove;

  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(remove, opts.duration || (kind === 'error' ? 6000 : 4000));
}

function confirmDialog(message, { title = 'Please confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').textContent = message;
    const okBtn = document.getElementById('confirmModalOkBtn');
    const cancelBtn = document.getElementById('confirmModalCancelBtn');
    okBtn.className = danger ? 'btn-inline danger' : 'btn-inline';
    backdrop.classList.remove('hidden');

    function cleanup(result) {
      backdrop.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ---------------------------------------------------------
// 2c. MULTI-BANK BULK PAYMENT FILE SUPPORT
//
// BANKS: the master list backing the Company Profile "bank" dropdown.
//   key         — stable internal id, stored in Firestore as bankName
//   label       — text shown in the dropdown
//   ifscPrefix  — the 4-letter IFSC bank code used to detect an
//                 "internal / same-bank" transfer for that bank
//
// BankFormatters: one entry per BANKS key, keyed the same way, each
// providing the file extension/MIME type and a generate() function
// that turns a batch into that bank's exact file layout. This is the
// single place to touch when a bank changes its file spec or a new
// bank needs to be added — nothing else in the export pipeline is
// bank-specific.
//
// NOTE: the exact CSV/TXT column layouts below follow "Corporate Bulk
// Payment File Specifications" (PNB IBS / HDFC CBX-ENET / ICICI CIB
// PAB-SAL master spec doc). SBI's layout was supplied separately.
// Confirm the live column order with each bank's CMS / corporate net
// banking portal before using these in production, since banks do
// revise their bulk-upload formats from time to time.
//
// supportsRtgs / supportsImps reflect each bank's bulk-file spec
// exactly — they are NOT generic capability flags:
//   - PNB:   Supported Transfer Modes = Internal(PMT), NEFT, RTGS.
//            No IMPS credit line exists in this file format.
//   - HDFC:  Supported Transfer Modes = Internal(I), NEFT(N), RTGS(R).
//            No IMPS credit line exists in this file format.
//   - ICICI: Supported Transfer Modes = Internal(MCW), NEFT(MCO) only.
//            No RTGS and no IMPS credit line exists in this format —
//            every cross-bank credit record is a fixed "NFT" literal.
// ---------------------------------------------------------
const BANKS = [
  { key: 'SBI',   label: 'State Bank of India (SBI)',  ifscPrefix: 'SBIN', supportsRtgs: true,  supportsImps: true  },
  { key: 'HDFC',  label: 'HDFC Bank (HDFC)',            ifscPrefix: 'HDFC', supportsRtgs: true,  supportsImps: false },
  { key: 'ICICI', label: 'ICICI Bank (ICICI)',          ifscPrefix: 'ICIC', supportsRtgs: false, supportsImps: false },
  { key: 'PNB',   label: 'Punjab National Bank (PNB)',  ifscPrefix: 'PUNB', supportsRtgs: true,  supportsImps: false },
];
const BANK_BY_KEY = Object.fromEntries(BANKS.map(b => [b.key, b]));

// Wraps a CSV field in quotes if it contains a comma, quote, or newline.
function csvField(value) {
  const s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(values) { return values.map(csvField).join(','); }

// SBI and ICICI's bulk files use a single character (# or ^) as the
// field separator instead of CSV-style quoting. If a company or
// employee name ever contained that exact character, the row would
// silently split into an extra column and the whole batch would be
// misread — or bounced — by the bank's upload portal. Strip any
// stray delimiter characters and line breaks before they go in.
function sanitizeForDelimitedFile(value, ...reservedChars) {
  let s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  reservedChars.forEach(ch => { s = s.split(ch).join(''); });
  return s.trim();
}

// Determines NEFT / RTGS / IMPS / Same Bank for a single transaction on
// any non-SBI bank, per the rules in the spec:
//  - Same Bank / Internal: beneficiary IFSC starts with the company's
//    own bank's 4-letter code
//  - otherwise RTGS if amount >= ₹2,00,000, else NEFT
//  - IMPS is an optional override toggle for any cross-bank transfer
function determineTransactionMode(bankKey, ifsc, amount, preferImps) {
  const bank = BANK_BY_KEY[bankKey];
  if (!bank) return 'NEFT';
  const sameBank = bank.ifscPrefix && String(ifsc || '').toUpperCase().startsWith(bank.ifscPrefix);
  if (sameBank) return 'Same Bank';
  if (preferImps && bank.supportsImps) return 'IMPS';
  // ICICI's bulk file (MCO record) has no RTGS credit type at all — every
  // cross-bank credit is NEFT regardless of amount. PNB/HDFC do support
  // RTGS per their spec, so the ₹2L threshold still applies to them.
  if (bank.supportsRtgs === false) return 'NEFT';
  return amount >= 200000 ? 'RTGS' : 'NEFT';
}

// "Same Bank" / "NEFT" / "RTGS" / "IMPS" are UI-only labels (used for
// the mode badge on the Payroll Run screen). Each bank's real bulk
// file has its OWN literal code for the same concept — e.g. PNB wants
// "PMT" for an intra-bank transfer while HDFC wants "I" for the exact
// same thing — so a single shared code was never going to be correct
// for more than one bank at a time. This is the single place that
// converts the generic UI mode into the bank-specific file code.
function bankTxnCode(bankKey, mode) {
  if (bankKey === 'PNB') {
    if (mode === 'Same Bank') return 'PMT';
    if (mode === 'RTGS') return 'RTG';
    return 'NFT'; // NEFT
  }
  if (bankKey === 'HDFC') {
    if (mode === 'Same Bank') return 'I';
    if (mode === 'RTGS') return 'R';
    return 'N'; // NEFT
  }
  // Fallback for any bank without its own bulk-file spec on file yet.
  return mode === 'Same Bank' ? 'NEFT' : mode;
}

// HDFC's bulk file requires the beneficiary's bank NAME as free text
// (column 26 — e.g. "HDFC BANK", "SBI BANK") in addition to the IFSC.
// Best-effort lookup covering the most common Indian banks by their
// 4-letter IFSC prefix; anything not in the table falls back to
// "<PREFIX> BANK", which is still a safe, parseable value.
const IFSC_BANK_NAMES = {
  SBIN: 'SBI BANK', HDFC: 'HDFC BANK', ICIC: 'ICICI BANK', PUNB: 'PNB BANK',
  UTIB: 'AXIS BANK', KKBK: 'KOTAK BANK', BARB: 'BANK OF BARODA', CNRB: 'CANARA BANK',
  UBIN: 'UNION BANK', IDIB: 'INDIAN BANK', IOBA: 'INDIAN OVERSEAS BANK', IDFB: 'IDFC FIRST BANK',
  YESB: 'YES BANK', INDB: 'INDUSIND BANK', RATN: 'RBL BANK', FDRL: 'FEDERAL BANK',
  CBIN: 'CENTRAL BANK OF INDIA', MAHB: 'BANK OF MAHARASHTRA', PSIB: 'PUNJAB & SIND BANK',
  UCBA: 'UCO BANK', BKID: 'BANK OF INDIA', SIBL: 'SOUTH INDIAN BANK', DCBL: 'DCB BANK'
};
function bankNameFromIfsc(ifsc) {
  const prefix = String(ifsc || '').trim().toUpperCase().slice(0, 4);
  return IFSC_BANK_NAMES[prefix] || (prefix ? `${prefix} BANK` : '');
}

// ICICI's File Header Record wants the execution date as MM/DD/YYYY —
// the one field in the whole app that isn't DD/MM/YYYY. Converts the
// already-picked Transfer Date just for that one field.
function ddmmyyyyToMmddyyyy(ddmmyyyy) {
  const [d, m, y] = String(ddmmyyyy || '').split('/');
  if (!d || !m || !y) return ddmmyyyy || '';
  return `${m}/${d}/${y}`;
}

// ctx passed to every generate() below:
//   companyProfile { name, accountNumber, sysId, bankName }
//   lines[]  { acc, empCode, name, ifsc, amount, mode }
//   total, batchId, txnDate ('DD/MM/YYYY'), monthName, year, tft
const BankFormatters = {
  // SBI Bulk INTER Bank Transaction Upload Format (RTGS/NEFT to other
  // banks) — confirmed against the real sample workbook. 8 '#'-delimited
  // fields, NO header/column-label row, NO trailing '#'. Row 1 (serial
  // 001) is always the DEBIT row (the company's own SBI account); every
  // row after that is a CREDIT row (one per employee):
  //   DEBIT row:  AccNo # BranchCode # Date # DrAmount # (blank) # UniqueRef # AccountName # Description
  //   CREDIT row: AccNo # IFSC       # Date # (blank) # CrAmount # UniqueRef # AccountName # Description
  // Field 2 differs by row type: the debit row uses the company's own
  // SBI BRANCH CODE (sysId — there's no IFSC needed for your own SBI
  // account), while every credit row uses the beneficiary's FULL IFSC
  // code (e.g. "UTIB0000000") — confirmed by the sample file's credit
  // rows, which show complete 11-char IFSCs, not a stripped branch code.
  // A stripped branch-code fragment on credit rows was the old (wrong)
  // behavior here and would misroute or bounce every cross-bank credit.
  SBI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '#');
      // Each row's reference reuses ctx.batchId — which already carries
      // this export's unique counter value — plus the employee code.
      // Previously this only combined month + empCode, so exporting the
      // same month twice produced identical row codes both times. Tying
      // it to batchId means every row from every export is unique, while
      // still telling you which employee (and which batch) it belongs to.
      const empLines = ctx.lines.map(l => {
        const seqStr = `${ctx.batchId}E${l.empCode}`;
        return `${d(l.acc)}#${d(l.ifsc)}#${ctx.txnDate}##${l.amount.toFixed(2)}#${seqStr}#${d(l.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}`;
      });
      const header = `${d(ctx.companyProfile.accountNumber)}#${d(ctx.companyProfile.sysId)}#${ctx.txnDate}#${ctx.total.toFixed(2)}##${ctx.batchId}#${d(ctx.companyProfile.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}`;
      return [header, ...empLines].join('\n') + '\n';
    }
  },
  // SBI Bulk INTRA Bank Transaction Upload Format (SBI-to-SBI only —
  // used for "Same Bank" exports, uploaded via SBI Net Banking's
  // File Upload > Transactions > "Intra Bank Transfer", NOT the same
  // upload screen as the Inter-Bank file above). Confirmed against
  // SBI's own reference sample workbook + its accompanying upload
  // instructions (a widely-used public corporate-net-banking guide,
  // not PayFlow Pro's own bank-issued sample — treat as best-effort
  // like PNB/HDFC's public specs, not a bank-confirmed production
  // file). Two concrete differences from the Inter-Bank format above,
  // both taken directly from the sample file's actual data rows
  // (not just the instructions text):
  //   1. Field 2 is the SBI BRANCH CODE, not the IFSC — every account
  //      in this file is already at some SBI branch, so no bank/IFSC
  //      lookup is needed, just which branch. Derived from each
  //      beneficiary's own SBI IFSC via branchCodeFromIfsc(), same
  //      helper already used (and confirmed) for the company's own
  //      debit-row branch code in the Inter-Bank format above.
  //   2. Every row ends with a TRAILING '#' — the sample's raw upload
  //      strings all end in "...#DESCRIPTION#", unlike the Inter-Bank
  //      file which explicitly has none. Dropped this and the bank's
  //      parser would likely misread the row.
  //   DEBIT row:  AccNo # BranchCode # Date # DrAmount # (blank) # UniqueRef # AccountName # Description #
  //   CREDIT row: AccNo # BranchCode # Date # (blank) # CrAmount # UniqueRef # AccountName # Description #
  SBI_INTRA: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '#');
      const empLines = ctx.lines.map(l => {
        const seqStr = `${ctx.batchId}E${l.empCode}`;
        const branchCode = branchCodeFromIfsc(l.ifsc);
        return `${d(l.acc)}#${d(branchCode)}#${ctx.txnDate}##${l.amount.toFixed(2)}#${seqStr}#${d(l.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      });
      const header = `${d(ctx.companyProfile.accountNumber)}#${d(ctx.companyProfile.sysId)}#${ctx.txnDate}#${ctx.total.toFixed(2)}##${ctx.batchId}#${d(ctx.companyProfile.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      return [header, ...empLines].join('\n') + '\n';
    }
  },
  // PNB IBS — "Combined" bulk NEFT/RTGS/Within-PNB file. 7 comma-delimited
  // columns exactly per spec: TxnType(NFT/RTG/PMT), 16-digit DebitAcc,
  // Amount, Currency(always INR), BenAcc, IFSC, Remarks (<=30 chars,
  // optional). NO header row — confirmed against PNB's own sample .txt
  // and .xlsx files (User Guide for Corporate Internet Banking Users,
  // Section 10.C "Bulk NEFT/RTGS Transfer File"), both of which start
  // directly with a data row (e.g. "NFT,1120010101111,4000,INR,...").
  // A header here would either get bounced or misread as a transaction,
  // same reasoning as HDFC below.
  PNB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const remarks = `SALARY OF ${ctx.monthName} ${ctx.year}`.slice(0, 30);
      const rows = ctx.lines.map(l => csvRow([
        bankTxnCode('PNB', l.mode),
        ctx.companyProfile.accountNumber,
        l.amount.toFixed(2),
        'INR',
        l.acc,
        l.ifsc,
        remarks
      ]));
      return rows.join('\r\n') + '\r\n'; // deliberately no header row
    }
  },
  // HDFC CBX/ENET — strict 28-column CSV, NO header row (HDFC's parser
  // treats row 1 as a transaction if a header is present, so the file
  // must start directly with data). Column indices below are 0-based
  // (col N in the spec = cols[N-1] here); every column not explicitly
  // set stays blank, matching the spec's optional fields.
  HDFC: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      // "No special characters" per spec — keep this alphanumeric only.
      const custRef = `SALARY${(ctx.monthName || '').slice(0, 3).toUpperCase()}${ctx.year}`;
      const rows = ctx.lines.map(l => {
        const isInternal = l.mode === 'Same Bank';
        const cols = new Array(28).fill('');
        cols[0]  = bankTxnCode('HDFC', l.mode);   // 1  Transaction Type: I / N / R
        cols[1]  = isInternal ? l.acc : '';        // 2  Beneficiary Code (Internal only)
        cols[2]  = l.acc;                          // 3  Beneficiary Account No.
        cols[3]  = l.amount.toFixed(2);            // 4  Instrument Amount
        cols[4]  = l.name.slice(0, 40);            // 5  Beneficiary Name (spec max 40 chars)
        // 6-7 Drawee/Print Location, 8-12 Bene Address 1-5, 13 Instruction Ref — blank
        cols[13] = custRef;                        // 14 Customer Reference No.
        // 15-21 Payment Details 1-7, 22 Cheque Number — blank
        cols[22] = ctx.txnDate;                    // 23 Chq / Trn Date (DD/MM/YYYY)
        // 24 MICR Number — blank
        // 25 IFSC Code — always populated, even for internal (I) transfers.
        // The written spec only calls IFSC mandatory for N/R, but the real
        // production sample file fills it on every row including internal
        // ones, so we no longer blank it out for isInternal.
        cols[24] = l.ifsc;
        cols[25] = bankNameFromIfsc(l.ifsc);       // 26 Bene Bank Name
        // 27 Bene Branch Name — blank
        cols[27] = '';                             // 28 Beneficiary Email ID (not collected today)
        return csvRow(cols);
      });
      return rows.join('\r\n') + '\r\n'; // deliberately no header row
    },
    // Strict HDFC naming convention: "ABCDDDMM.001" = 4-char Corporate
    // Client Code + transfer day + transfer month + a 3-digit batch
    // sequence. The app's own export counter is a single running
    // alphanumeric value (not a per-day reset), so it's folded into a
    // 1-999 range here to keep the extension valid — if more than one
    // HDFC batch is uploaded on the same day, double-check the .00X
    // suffix doesn't collide with one already used with HDFC that day.
    fileName(ctx) {
      const code = (ctx.companyProfile.hdfcClientCode || 'XXXX').toUpperCase().slice(0, 4).padEnd(4, 'X');
      const [dd, mm] = String(ctx.txnDate || '').split('/');
      const seqNum = ((parseInt(ctx.seq, 36) || 1) % 999) + 1;
      return `${code}${dd || '01'}${mm || '01'}.${String(seqNum).padStart(3, '0')}`;
    }
  },
  // ICICI CIB PAB-SAL — pipe (|) delimited fields, caret (^) record
  // terminator (one per line, not a field separator). Every file needs
  // a File Header Record (FHR) + Master Debit Record (MDR), then one
  // Beneficiary Credit Record per employee: MCW (within ICICI, exactly
  // 12-digit account, IFSC blank) or MCO (other bank — this format only
  // ever credits via NEFT, the "NFT" literal is fixed, not variable).
  ICICI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = (v, max) => {
        const s = sanitizeForDelimitedFile(v, '|', '^');
        return max ? s.slice(0, max) : s;
      };
      // Beneficiary Name specifically: CIB spec says "No special character
      // is allowed but Space is allowed" — alphanumeric + space only.
      // Scoped to name fields only (not debitAcc/IFSC/corporateId, which
      // have their own separate, already-correct rules above).
      const dName = (v, max) => {
        const s = d(v).replace(/[^A-Za-z0-9 ]/g, '');
        return max ? s.slice(0, max) : s;
      };
      const totalRecords = ctx.lines.length + 1; // credit lines + the MDR debit line
      const execDate = ddmmyyyyToMmddyyyy(ctx.txnDate); // ICICI wants MM/DD/YYYY here
      const externalRef = `SALARY_${(ctx.monthName || '').slice(0, 3).toUpperCase()}${ctx.year}`;
      const debitAcc = d(ctx.companyProfile.accountNumber, 12);
      const corporateId = d(ctx.companyProfile.iciciCorporateId, 20);
      const narration = d(`SALARY OF ${ctx.monthName} ${ctx.year}`, 30);

      const fhr = `FHR|${totalRecords}|${execDate}|${externalRef}|${ctx.total.toFixed(2)}|INR|${debitAcc}|0011^`;
      const mdr = `MDR|${debitAcc}|0011|${corporateId}|${ctx.total.toFixed(2)}|INR|${narration}|ICIC0000011|WIB^`;

      const creditLines = ctx.lines.map(l => {
        const name = dName(l.name, 32);
        const remarks = d(`SAL ${ctx.monthName}`, 30);
        if (l.mode === 'Same Bank') {
          return `MCW|${d(l.acc, 12)}|0011|${name}|${l.amount.toFixed(2)}|INR|${remarks}|ICIC0000011|WIB^`;
        }
        return `MCO|${d(l.acc, 34)}|0011|${name}|${l.amount.toFixed(2)}|INR|${remarks}|NFT|${d(l.ifsc)}^`;
      });

      return [fhr, mdr, ...creditLines].join('\n') + '\n';
    }
  },
};

// Wires up the 4-bank selector button group in the Company Details
// edit view (SBI / HDFC / ICICI / PNB). Replaces the old <select>
// dropdown with a clear set of buttons — only one is ever active.
let selectedCompanyBankKey = 'SBI';
function setSelectedCompanyBank(key) {
  if (!BANK_BY_KEY[key]) return;
  selectedCompanyBankKey = key;
  document.querySelectorAll('#companyBankGroup .bank-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bank === key);
  });
  // HDFC's strict filename convention needs a 4-char Corporate Client
  // Code, and ICICI's Master Debit Record needs a Corporate Login ID —
  // neither field means anything for the other banks, so only show
  // whichever one is actually relevant to the bank just selected.
  const hdfcWrap = document.getElementById('companyHdfcClientCodeWrap');
  const iciciWrap = document.getElementById('companyIciciCorporateIdWrap');
  if (hdfcWrap) hdfcWrap.classList.toggle('hidden', key !== 'HDFC');
  if (iciciWrap) iciciWrap.classList.toggle('hidden', key !== 'ICICI');
}
function wireCompanyBankButtons() {
  document.querySelectorAll('#companyBankGroup .bank-select-btn').forEach(btn => {
    btn.addEventListener('click', () => setSelectedCompanyBank(btn.dataset.bank));
  });
}

// ---------------------------------------------------------
// 3. SCREEN ROUTER
// Only one of these top-level screens is visible at a time.
// ---------------------------------------------------------
const SCREENS = ['auth', 'verify-pending', 'verifying', 'reset-password', 'complete-profile', 'dashboard'];
function showScreen(name) {
  SCREENS.forEach(s => {
    document.getElementById('screen-' + s).classList.toggle('hidden', s !== name);
  });

  if (name === 'dashboard') {
    // Restore this device's last-known theme immediately (avoids a
    // flash of the wrong theme while Firestore is still loading).
    // loadUserTheme() reconciles this against Firestore right after,
    // in case another device changed the preference more recently.
    applyTheme(getStoredTheme() === 'dark' ? 'dark' : 'light', { skipRemoteSave: true });
  } else {
    // Sign-in, sign-up, verification, and reset-password screens are
    // always light — for every user, every time — no matter what
    // dark/light preference is saved for their dashboard.
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

// ---------------------------------------------------------
// 4. FRIENDLY ERROR MESSAGES
// ---------------------------------------------------------
function mapAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password should be at least 8 characters.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before completing.',
    'auth/requires-recent-login': 'For your security, please re-enter your current password to confirm this change.',
    'auth/email-already-exists': 'That email is already in use by another account.',
    'auth/invalid-phone-number': 'Please enter a valid phone number with country code, e.g. +91XXXXXXXXXX.',
    'auth/invalid-verification-code': 'That verification code is incorrect.',
    'auth/code-expired': 'That verification code has expired. Please request a new one.',
    'auth/missing-verification-code': 'Please enter the code sent to your phone.',
  };
  return map[err.code] || err.message;
}

function showAuthError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.classList.add('show');
}
function clearAuthError() {
  const box = document.getElementById('errorBox');
  box.textContent = '';
  box.classList.remove('show');
}
function showAuthSuccess(msg) {
  const box = document.getElementById('successBox');
  box.textContent = msg;
  box.classList.add('show');
}
function clearAuthSuccess() {
  const box = document.getElementById('successBox');
  box.textContent = '';
  box.classList.remove('show');
}

// ---------------------------------------------------------
// 4b. PASSWORD SHOW/HIDE TOGGLE (works for any .pw-toggle button
// paired with an input via data-target, on any screen — login,
// signup, and later the Settings page).
// ---------------------------------------------------------
function wirePasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      if (input.classList.contains('mask-value')) {
        // Account number etc: plain type="text" input, masked via CSS
        // (-webkit-text-security) rather than type="password", so
        // toggle the mask class instead of the input type.
        const showing = input.classList.toggle('pw-visible');
        btn.classList.toggle('is-visible', showing);
        btn.setAttribute('aria-label', showing ? 'Hide account number' : 'Show account number');
        return;
      }
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.classList.toggle('is-visible', !showing);
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}

// ---------------------------------------------------------
// 4c. SIGNUP PASSWORD STRENGTH METER
// Purely a visual UX aid — does NOT relax or replace the real
// validation (minlength=8 on the input, and whatever Firebase Auth
// itself enforces). Scores on length + character variety.
// ---------------------------------------------------------
function passwordStrengthScore(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

function wirePasswordStrengthMeter() {
  const input = document.getElementById('signupPassword');
  const bar = document.getElementById('pwStrengthBar');
  const label = document.getElementById('pwStrengthLabel');
  if (!input || !bar || !label || input.dataset.strengthWired) return;
  input.dataset.strengthWired = '1';

  const LEVELS = [
    { cls: '', text: 'At least 8 characters.' },
    { cls: 'is-weak', text: 'Weak — try adding numbers or a symbol.' },
    { cls: 'is-fair', text: 'Fair — mix upper/lowercase, numbers or symbols.' },
    { cls: 'is-good', text: 'Good password.' },
    { cls: 'is-strong', text: 'Strong password.' }
  ];

  input.addEventListener('input', () => {
    const score = input.value ? Math.max(1, passwordStrengthScore(input.value)) : 0;
    const level = LEVELS[input.value ? score : 0];
    bar.className = 'pw-strength' + (level.cls ? ' ' + level.cls : '');
    label.textContent = level.text;
  });
}

// Always land on the LOGIN form (not signup) whenever we route back
// to the auth screen — fixes "stuck on signup form" after verifying
// email, logging out, or clicking "use a different account".
function goToAuthScreen() {
  clearAuthError();
  clearAuthSuccess();
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('forgotPasswordForm').classList.add('hidden');
  document.getElementById('forgotPwInstructions').classList.remove('hidden');
  document.getElementById('forgotEmailField').classList.remove('hidden');
  document.getElementById('forgotSubmitBtn').classList.remove('hidden');
  document.getElementById('forgotSendAgainRow').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('switchModeWrap').classList.remove('hidden');
  document.getElementById('authDivider').classList.remove('hidden');
  document.getElementById('googleBtn').classList.remove('hidden');
  document.getElementById('switchToLoginWrap').classList.add('hidden');
  document.getElementById('switchToSignupWrap').classList.remove('hidden');
  showScreen('auth');
}

// ---------------------------------------------------------
// 5. AUTH SCREEN (login / signup / google)
// ---------------------------------------------------------
function wireAuthForms() {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const switchToSignup = document.getElementById('switchToSignup');
  const switchToLogin = document.getElementById('switchToLogin');

  switchToSignup.onclick = () => {
    clearAuthError(); clearAuthSuccess();
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    document.getElementById('switchToSignupWrap').classList.add('hidden');
    document.getElementById('switchToLoginWrap').classList.remove('hidden');
  };
  switchToLogin.onclick = () => {
    clearAuthError(); clearAuthSuccess();
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('switchToLoginWrap').classList.add('hidden');
    document.getElementById('switchToSignupWrap').classList.remove('hidden');
  };

  // ---- Forgot password ----
  const forgotForm = document.getElementById('forgotPasswordForm');
  function resetForgotFormVisibility() {
    document.getElementById('forgotPwInstructions').classList.remove('hidden');
    document.getElementById('forgotEmailField').classList.remove('hidden');
    document.getElementById('forgotSubmitBtn').classList.remove('hidden');
    document.getElementById('forgotSendAgainRow').classList.add('hidden');
  }
  function hideForgotFormAfterSend() {
    document.getElementById('forgotPwInstructions').classList.add('hidden');
    document.getElementById('forgotEmailField').classList.add('hidden');
    document.getElementById('forgotSubmitBtn').classList.add('hidden');
    document.getElementById('forgotSendAgainRow').classList.remove('hidden');
  }
  document.getElementById('forgotPasswordLink').onclick = () => {
    clearAuthError(); clearAuthSuccess();
    resetForgotFormVisibility();
    loginForm.classList.add('hidden');
    forgotForm.classList.remove('hidden');
    document.getElementById('switchModeWrap').classList.add('hidden');
    document.getElementById('authDivider').classList.add('hidden');
    document.getElementById('googleBtn').classList.add('hidden');
    document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value || '';
  };
  document.getElementById('forgotBackBtn').onclick = () => {
    clearAuthError(); clearAuthSuccess();
    forgotForm.reset();
    resetForgotFormVisibility();
    forgotForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('switchModeWrap').classList.remove('hidden');
    document.getElementById('authDivider').classList.remove('hidden');
    document.getElementById('googleBtn').classList.remove('hidden');
  };
  document.getElementById('forgotSendAgainBtn').onclick = () => {
    clearAuthSuccess();
    resetForgotFormVisibility();
    document.getElementById('forgotEmail').focus();
  };
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError(); clearAuthSuccess();
    const btn = document.getElementById('forgotSubmitBtn');
    const email = document.getElementById('forgotEmail').value.trim();
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      await auth.sendPasswordResetEmail(email, actionCodeSettings);
      // Same message whether or not the account exists — avoids
      // leaking which emails are registered.
      showAuthSuccess('If an account exists for that email, a password reset link is on its way. Check your spam folder too.');
      forgotForm.reset();
      hideForgotFormAfterSend();
    } catch (err) {
      if (err.code === 'auth/invalid-email') {
        showAuthError(mapAuthError(err));
      } else {
        // Still show the generic success message for anything else
        // (e.g. user-not-found) so we don't reveal account existence.
        showAuthSuccess('If an account exists for that email, a password reset link is on its way. Check your spam folder too.');
        forgotForm.reset();
        hideForgotFormAfterSend();
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Send Reset Link';
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      await auth.signInWithEmailAndPassword(email, password);
      // routeUser() fires automatically via onAuthStateChanged
    } catch (err) {
      showAuthError(mapAuthError(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const btn = document.getElementById('signupBtn');
    btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const name = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value;
      const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

      if (password !== passwordConfirm) {
        showAuthError('Passwords do not match.');
        return;
      }

      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      await cred.user.sendEmailVerification(actionCodeSettings);
      // Do NOT leave the user signed in unverified — sign out and
      // make them explicitly verify + log in. This is what fixes
      // "shows registered but isn't really".
      await auth.signOut();

      signupForm.reset();
      document.getElementById('verifyPendingEmail').textContent = email;
      showScreen('verify-pending');
    } catch (err) {
      showAuthError(mapAuthError(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });

  document.getElementById('googleBtn').onclick = async () => {
    clearAuthError();
    try {
      suppressAutoRoute = true; // hold the router while we check if this is a new user
      const result = await auth.signInWithPopup(googleProvider);
      await handleGoogleSignInResult(result);
    } catch (err) {
      // Popups get blocked or silently fail in a lot of mobile browsers,
      // in-app webviews (opened from WhatsApp/LinkedIn, etc.), and some
      // corporate/managed-device setups. Rather than dead-ending with an
      // error in exactly those cases, fall back to a full-page redirect
      // flow, which works everywhere a popup doesn't.
      const popupFailureCodes = [
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment'
      ];
      if (popupFailureCodes.includes(err.code)) {
        try {
          await auth.signInWithRedirect(googleProvider);
          // Page will navigate away here; result is handled by
          // getRedirectResult() in boot() after the redirect back.
          return;
        } catch (redirectErr) {
          suppressAutoRoute = false;
          showAuthError(mapAuthError(redirectErr));
          return;
        }
      }
      suppressAutoRoute = false;
      showAuthError(mapAuthError(err));
    }
  };
}

// Shared by both the popup and redirect Google sign-in paths so new vs.
// returning users are routed identically no matter which one fired.
async function handleGoogleSignInResult(result) {
  const isNewUser = result.additionalUserInfo && result.additionalUserInfo.isNewUser;
  if (isNewUser) {
    document.getElementById('googleNameInput').value = result.user.displayName || '';
    showScreen('complete-profile');
  } else {
    suppressAutoRoute = false;
    routeUser(result.user);
  }
}

// ---------------------------------------------------------
// 5b. COMPLETE PROFILE SCREEN (new Google sign-ups only)
// ---------------------------------------------------------
function wireCompleteProfileForm() {
  document.getElementById('completeProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('completeProfileBtn');
    const name = document.getElementById('googleNameInput').value.trim();
    if (!name) return;
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await auth.currentUser.updateProfile({ displayName: name });
      suppressAutoRoute = false;
      routeUser(auth.currentUser);
    } catch (err) {
      toast('Could not save name: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Continue';
    }
  });
}

// ---------------------------------------------------------
// 6. "CHECK YOUR EMAIL" SCREEN (post-signup, pre-verification)
// ---------------------------------------------------------
let resendCooldown = false;
function wireVerifyPending() {
  document.getElementById('resendVerifyBtn').onclick = async () => {
    if (resendCooldown) return;
    const btn = document.getElementById('resendVerifyBtn');
    try {
      let user = auth.currentUser;
      if (!user) {
        toast('Please sign in again to resend the verification email.', 'error');
        showScreen('auth');
        return;
      }
      await user.sendEmailVerification(actionCodeSettings);
      resendCooldown = true;
      btn.textContent = 'Sent — check your inbox (and spam folder)';
      setTimeout(() => {
        resendCooldown = false;
        btn.textContent = 'Resend verification email';
      }, 60000);
    } catch (err) {
      toast('Could not resend: ' + mapAuthError(err), 'error');
    }
  };

  document.getElementById('verifyPendingRefreshBtn').onclick = async () => {
    const user = auth.currentUser;
    if (!user) { goToAuthScreen(); return; }
    await user.reload();
    routeUser(auth.currentUser);
  };

  document.getElementById('verifyPendingLogoutBtn').onclick = () => auth.signOut();
}

// ---------------------------------------------------------
// 7. VERIFICATION LINK HANDLER (?mode=verifyEmail&oobCode=...)
// This is what makes the link open THIS page's own UI instead
// of Firebase's generic default page.
// ---------------------------------------------------------
let suppressAutoRoute = false;

async function handleVerifyEmailAction(oobCode) {
  suppressAutoRoute = true;
  showScreen('verifying');
  const icon = document.getElementById('verifyIcon');
  const text = document.getElementById('verifyText');
  const btn = document.getElementById('verifyContinueBtn');

  try {
    await auth.applyActionCode(oobCode);
    icon.textContent = '✅';
    text.innerHTML = 'Your email has been verified!<br>You can now sign in.';
  } catch (err) {
    icon.textContent = '❌';
    if (err.code === 'auth/invalid-action-code') {
      text.textContent = 'This link has expired or was already used. Please sign in — if you\'re still unverified, request a new link from the login page.';
    } else {
      text.textContent = 'Could not verify your email: ' + err.message;
    }
  }

  // Clean the ?mode=&oobCode= out of the URL so a refresh doesn't re-trigger it.
  history.replaceState({}, '', window.location.pathname);
  btn.classList.remove('hidden');
  btn.onclick = async () => {
    if (auth.currentUser) await auth.signOut();
    suppressAutoRoute = false;
    goToAuthScreen();
  };
}

// ---------------------------------------------------------
// 7b. PASSWORD RESET LINK HANDLER (?mode=resetPassword&oobCode=...)
// Without this, clicking the reset-password email link just lands
// back on the normal auth screen with no way to actually set a new
// password — this is what shows the "new password" form instead.
// ---------------------------------------------------------
async function handleResetPasswordAction(oobCode) {
  suppressAutoRoute = true;
  showScreen('reset-password');

  const checkingMsg = document.getElementById('resetPwCheckingMsg');
  const form = document.getElementById('resetPasswordForm');
  const backBtn = document.getElementById('resetPwBackToSignInBtn');
  const errBox = document.getElementById('resetPwErrorBox');
  const okBox = document.getElementById('resetPwSuccessBox');

  let email;
  try {
    email = await auth.verifyPasswordResetCode(oobCode);
  } catch (err) {
    checkingMsg.classList.add('hidden');
    errBox.textContent = err.code === 'auth/invalid-action-code'
      ? 'This reset link has expired or was already used. Please request a new one from the sign-in page.'
      : mapAuthError(err);
    errBox.classList.add('show');
    backBtn.classList.remove('hidden');
    history.replaceState({}, '', window.location.pathname);
    return;
  }

  checkingMsg.classList.add('hidden');
  document.getElementById('resetPwEmail').textContent = email;
  form.classList.remove('hidden');
  history.replaceState({}, '', window.location.pathname);

  form.addEventListener('submit', async function onSubmit(e) {
    e.preventDefault();
    errBox.classList.remove('show'); errBox.textContent = '';
    const newPw = document.getElementById('resetPwNew').value;
    const confirmPw = document.getElementById('resetPwConfirm').value;
    if (newPw !== confirmPw) {
      errBox.textContent = 'Passwords do not match.';
      errBox.classList.add('show');
      return;
    }
    const btn = document.getElementById('resetPwSubmitBtn');
    btn.disabled = true; btn.textContent = 'Setting password...';
    try {
      await auth.confirmPasswordReset(oobCode, newPw);
      form.classList.add('hidden');
      okBox.textContent = 'Password updated. You can now sign in with your new password.';
      okBox.classList.add('show');
      backBtn.classList.remove('hidden');
      form.removeEventListener('submit', onSubmit);
    } catch (err) {
      errBox.textContent = err.code === 'auth/invalid-action-code'
        ? 'This reset link has expired or was already used. Please request a new one from the sign-in page.'
        : mapAuthError(err);
      errBox.classList.add('show');
    } finally {
      btn.disabled = false; btn.textContent = 'Set New Password';
    }
  }, { once: true });

  backBtn.onclick = () => {
    suppressAutoRoute = false;
    goToAuthScreen();
  };
}

// ---------------------------------------------------------
// 8. ROUTER — decides which screen to show based on auth state
// ---------------------------------------------------------
function routeUser(user) {
  if (suppressAutoRoute) return; // we're busy handling a verification link
  if (!user) { goToAuthScreen(); return; }

  if (!user.emailVerified) {
    // This is the key fix: unverified users never reach the dashboard.
    document.getElementById('verifyPendingEmail').textContent = user.email;
    showScreen('verify-pending');
    return;
  }

  showScreen('dashboard');
  bootDashboard(user);
}

// ---------------------------------------------------------
// 9. BOOT SEQUENCE
// Each wiring function is independent (different buttons/forms), so
// one throwing must never stop the rest from running — otherwise a
// single bug (even on one specific browser) silently breaks every
// button wired after it, and clicking any of them does nothing with
// no visible error. wirePwaGuideModal() also now runs FIRST, since
// it's needed on the auth screen itself, before any login/signup form
// interaction even happens.
// ---------------------------------------------------------
function safeInit(name, fn) {
  try { fn(); } catch (err) {
    console.error(`[Boot] ${name}() failed — other setup continues:`, err);
  }
}
safeInit('wirePwaGuideModal', wirePwaGuideModal);
safeInit('wireSidebarCollapse', wireSidebarCollapse);
safeInit('wireAuthForms', wireAuthForms);
safeInit('wireVerifyPending', wireVerifyPending);
safeInit('wireCompleteProfileForm', wireCompleteProfileForm);
safeInit('wirePasswordToggles', wirePasswordToggles);
safeInit('wirePasswordStrengthMeter', wirePasswordStrengthMeter);

(function boot() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  if (mode === 'verifyEmail' && oobCode) {
    handleVerifyEmailAction(oobCode);
  } else if (mode === 'resetPassword' && oobCode) {
    handleResetPasswordAction(oobCode);
  }

  // Picks up the result after a signInWithRedirect() round-trip (the
  // Google fallback for blocked/unsupported popups). Resolves to null
  // on every normal page load where no redirect sign-in was pending —
  // that's expected, not an error.
  suppressAutoRoute = true;
  auth.getRedirectResult().then(async (result) => {
    if (result && result.user) {
      await handleGoogleSignInResult(result);
    } else {
      // No redirect was in flight (the normal case on every page load) —
      // release the hold and route based on whatever auth state we
      // actually have, since the onAuthStateChanged call below may have
      // already fired and been suppressed while this was pending.
      suppressAutoRoute = false;
      routeUser(auth.currentUser);
    }
  }).catch((err) => {
    suppressAutoRoute = false;
    if (err && err.code) showAuthError(mapAuthError(err));
    routeUser(auth.currentUser);
  });

  auth.onAuthStateChanged(routeUser);
})();

// ---------------------------------------------------------
// 10. DASHBOARD (unchanged logic from dashboard.js, wrapped so it
//     boots only once verification is confirmed)
// ---------------------------------------------------------
let employees = [];
let editingEmployeeId = null;
let salaryInputs = {};
let companyProfile = { name: '', accountNumber: '', ifsc: '', sysId: '', bankName: 'SBI', hdfcClientCode: '', iciciCorporateId: '' };
let dashboardBooted = false;
let currentUser = null;

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function formatDateDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ---------------------------------------------------------
// Google account UI — profile photo in the sidebar, and hiding the
// "change email/password" settings for accounts signed in via Google
// (those credentials live with Google, not with Firebase's email/
// password provider, so there's nothing here to change).
// ---------------------------------------------------------
function getInitials(name, email) {
  const src = (name || email || '').trim();
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function isGoogleAccount(user) {
  return !!user && Array.isArray(user.providerData) &&
    user.providerData.some(p => p.providerId === 'google.com');
}
function applyUserProfileUI(user) {
  const imgEl = document.getElementById('userAvatarImg');
  const fallbackEl = document.getElementById('userAvatarFallback');

  if (user.photoURL) {
    imgEl.src = user.photoURL;
    imgEl.classList.remove('hidden');
    fallbackEl.classList.add('hidden');
    // Google photo URLs can occasionally fail to load (revoked, rate
    // limited, offline) — fall back to initials instead of a broken image.
    imgEl.onerror = () => {
      imgEl.classList.add('hidden');
      fallbackEl.classList.remove('hidden');
    };
  } else {
    imgEl.classList.add('hidden');
    fallbackEl.textContent = getInitials(user.displayName, user.email);
    fallbackEl.classList.remove('hidden');
  }

  const google = isGoogleAccount(user);
  document.getElementById('settingsCredentialsList').classList.toggle('hidden', google);
  document.getElementById('settingsGoogleNotice').classList.toggle('hidden', !google);
}

async function bootDashboard(user) {
  currentUser = user;
  document.getElementById('userName').textContent = user.displayName || 'PayFlow User';
  document.getElementById('userEmail').textContent = user.email;
  applyUserProfileUI(user);

  try {
    await initUserContext(user.uid);
  } catch (err) {
    toast('Could not load your account: ' + err.message, 'error');
    return;
  }

  await ensureTermsAccepted();

  const walletInitPromise = initWallet();
  initDisbursementDateFields();
  await Promise.all([loadEmployees(), loadCompanyProfile(), loadUserTheme()]);
  renderEmployeeKpis();
  const walletInit = await walletInitPromise;

  if (!dashboardBooted) {
    dashboardBooted = true;
    safeInit('wireNav', wireNav);
    safeInit('wireMobileDrawer', wireMobileDrawer);
    safeInit('wireEmployeeForm', wireEmployeeForm);
    safeInit('wireEmployeeTableControls', wireEmployeeTableControls);
    safeInit('wireBulkImport', wireBulkImport);
    safeInit('wireDisbursement', wireDisbursement);
    safeInit('wireAudit', wireAudit);
    safeInit('wireExportHistory', wireExportHistory);
    safeInit('wireCompanyForm', wireCompanyForm);
    safeInit('wireSettingsForms', wireSettingsForms);
    safeInit('wirePasswordToggles', wirePasswordToggles);
    safeInit('wireModalCloseButtons', wireModalCloseButtons);
    safeInit('wireHelpSupport', wireHelpSupport);
    safeInit('wireFreeCreditsModal', wireFreeCreditsModal);
    safeInit('wireGuidedTour', wireGuidedTour);
    safeInit('wireCustomCreditPurchase', wireCustomCreditPurchase);
    document.getElementById('logoutBtn').onclick = () => auth.signOut();
    const walletChip = document.getElementById('walletChip');
    if (walletChip) walletChip.addEventListener('click', () => { closeMobileDrawer(); showAppPage('wallet'); });
    document.getElementById('employeeSearch').addEventListener('input', renderEmployeeTable);

    // First-ever dashboard visit for this browser: auto-start the tour.
    // Small delay so the employee table/KPIs have finished rendering and
    // the topbar/sidebar are laid out before we measure element rects.
    // localStorage can throw in private-browsing/locked-down contexts —
    // fall back to just always showing the tour rather than erroring out.
    let tourAlreadySeen = false;
    try { tourAlreadySeen = !!localStorage.getItem('payflow-tour-seen'); } catch (e) { /* ignore */ }

    if (walletInit && walletInit.granted) {
      // Brand-new signup: the "Congratulations, free credits" modal is
      // already showing (triggered inside initWallet()). Don't also fire
      // the tour on a timer — closeFreeCreditsModal() starts it the
      // instant the user dismisses that dialog, so the walkthrough reads
      // as the very next step of onboarding instead of two separate,
      // uncoordinated popups.
      pendingTourAfterCredits = true;
    } else if (!tourAlreadySeen) {
      setTimeout(() => startTour(), 600);
    }
  }
}

// ---------------------------------------------------------
// GUIDED TOUR — first-login spotlight walkthrough.
// Each step points at a real, always-visible element (topbar tabs,
// sidebar icons, the Employees-page action buttons) so nothing needs
// to be faked — no page switch required since the Employees page is
// already the default active page when the tour starts.
// ---------------------------------------------------------
const TOUR_STEPS = [
  {
    target: '.nav-item[data-page="settings"]',
    title: 'Start with Company Details',
    body: 'First, come here and fill in your company name, bank, and account number. These details are printed on every exported payment file.'
  },
  {
    target: '#addEmployeeBtn',
    title: 'Add an employee',
    body: 'Click here to add each employee\'s name, account number, IFSC, mobile, and email one at a time.'
  },
  {
    target: '#bulkImportBtn',
    title: 'Add many employees at once',
    body: 'Need to add the whole list in one go? Download the sample CSV, fill it in, and bulk import it here. You\'ll see a preview before importing, with any invalid rows highlighted.'
  },
  {
    target: '.topbar__tabs .nav-item[data-page="disbursement"]',
    title: 'Payroll Run',
    body: 'Enter this month\'s amount next to each employee, choose the transfer type, and export a bank-ready file.'
  },
  {
    target: '.topbar__tabs .nav-item[data-page="exports"]',
    title: 'Exports',
    body: 'Every batch you\'ve exported before shows up here — you can re-download them anytime.'
  },
  {
    target: '.sidebar-icons .nav-item[data-page="audit"]',
    title: 'Activity Log',
    body: 'Every add, edit, delete, and export is tracked here automatically — who did what, and when.'
  },
  {
    target: '.user-chip',
    title: 'Your profile',
    body: 'Your name and email show up here, with a Logout button below it. That\'s it — go explore!'
  }
];

let tourStepIndex = 0;
let tourEls = null; // { backdrop, spotlight, card }

function wireGuidedTour() {
  const helpBtn = document.getElementById('tourHelpBtn');
  if (helpBtn) helpBtn.addEventListener('click', () => startTour());

  const replayBtn = document.getElementById('replayTourBtn');
  if (replayBtn) replayBtn.addEventListener('click', () => {
    showAppPage('employees'); // tour steps assume the Employees page is active
    startTour();
  });
}

function startTour() {
  if (tourEls) endTour(); // guard against double-start
  tourStepIndex = 0;

  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  const spotlight = document.createElement('div');
  spotlight.className = 'tour-spotlight';
  const card = document.createElement('div');
  card.className = 'tour-card';

  document.body.append(backdrop, spotlight, card);
  tourEls = { backdrop, spotlight, card };

  window.addEventListener('resize', repositionTourStep);
  renderTourStep();
}

function endTour() {
  if (!tourEls) return;
  window.removeEventListener('resize', repositionTourStep);
  tourEls.backdrop.remove();
  tourEls.spotlight.remove();
  tourEls.card.remove();
  tourEls = null;
  closeMobileDrawer(); // in case a drawer-targeting step left it open
  try { localStorage.setItem('payflow-tour-seen', '1'); } catch (e) { /* ignore */ }
}

// Two tour steps (Activity Log, profile/logout) point at items that
// live inside the sidebar — a permanent column on desktop, but an
// off-canvas drawer on mobile (see wireMobileDrawer). This opens/closes
// that drawer to match whichever step is showing.
function stepNeedsDrawer(step) {
  return step.target.indexOf('.sidebar') === 0 || step.target === '.user-chip';
}

function renderTourStep() {
  if (!tourEls) return;
  const step = TOUR_STEPS[tourStepIndex];
  const target = document.querySelector(step.target);

  // If a target isn't in the DOM for some reason, skip straight past
  // it rather than leaving the spotlight stuck on nothing.
  if (!target) {
    if (tourStepIndex < TOUR_STEPS.length - 1) { tourStepIndex++; renderTourStep(); }
    else endTour();
    return;
  }

  const isLast = tourStepIndex === TOUR_STEPS.length - 1;
  const isFirst = tourStepIndex === 0;

  tourEls.card.innerHTML = `
    <div class="tour-card__step">Step ${tourStepIndex + 1} of ${TOUR_STEPS.length}</div>
    <div class="tour-card__title">${step.title}</div>
    <div class="tour-card__body">${step.body}</div>
    <div class="tour-card__actions">
      <div class="tour-card__dots">
        ${TOUR_STEPS.map((_, i) => `<span class="tour-card__dot${i === tourStepIndex ? ' active' : ''}"></span>`).join('')}
      </div>
      <div class="tour-card__nav">
        <button type="button" class="tour-card__skip" id="tourSkipBtn">Skip</button>
        ${!isFirst ? '<button type="button" class="tour-card__back" id="tourBackBtn">Back</button>' : ''}
        <button type="button" class="tour-card__next" id="tourNextBtn">${isLast ? 'Done' : 'Next'}</button>
      </div>
    </div>
  `;

  tourEls.card.querySelector('#tourSkipBtn').onclick = endTour;
  tourEls.card.querySelector('#tourNextBtn').onclick = () => {
    if (isLast) { endTour(); return; }
    tourStepIndex++;
    renderTourStep();
  };
  const backBtn = tourEls.card.querySelector('#tourBackBtn');
  if (backBtn) backBtn.onclick = () => { tourStepIndex--; renderTourStep(); };

  if (stepNeedsDrawer(step)) {
    // Give the drawer's slide-in transition time to finish before
    // measuring the target's position — measuring immediately would
    // still catch it mid-animation (or off-screen on desktop, where
    // the drawer classes are a no-op and the target is simply the
    // permanent sidebar column, already in place).
    openMobileDrawer();
    setTimeout(() => { if (tourEls) positionTourAround(target); }, 240);
  } else {
    closeMobileDrawer();
    positionTourAround(target);
  }
}

// Positions the spotlight cutout directly over the target's bounding
// box (with a small padding), then places the tooltip card below it
// if there's room, or above it if the target is near the bottom of
// the viewport — clamped horizontally so it never runs off-screen.
function positionTourAround(target) {
  const rect = target.getBoundingClientRect();
  const pad = 6;

  tourEls.spotlight.style.top = (rect.top - pad) + 'px';
  tourEls.spotlight.style.left = (rect.left - pad) + 'px';
  tourEls.spotlight.style.width = (rect.width + pad * 2) + 'px';
  tourEls.spotlight.style.height = (rect.height + pad * 2) + 'px';

  const card = tourEls.card;
  const cardWidth = 290;
  const gap = 14;
  const spaceBelow = window.innerHeight - rect.bottom;
  const cardHeight = card.offsetHeight || 160;

  let top;
  if (spaceBelow > cardHeight + gap) {
    top = rect.bottom + gap;
  } else if (rect.top > cardHeight + gap) {
    top = rect.top - cardHeight - gap;
  } else {
    top = Math.max(12, window.innerHeight / 2 - cardHeight / 2);
  }

  let left = rect.left + rect.width / 2 - cardWidth / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - cardWidth - 12));

  card.style.top = top + 'px';
  card.style.left = left + 'px';
}

function repositionTourStep() {
  if (!tourEls) return;
  const step = TOUR_STEPS[tourStepIndex];
  const target = document.querySelector(step.target);
  if (target) positionTourAround(target);
}

// Generic "×" close button on every modal — just hides the backdrop,
// same as each modal's own Cancel button, without needing bespoke
// wiring per modal.
function wireModalCloseButtons() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById(btn.dataset.modal);
      if (modal) modal.classList.add('hidden');
    });
  });
}

// Help & Support: a simple one-way message form. Submits to the
// send-support-message Vercel function, which emails the site owner
// with the signed-in user's email set as Reply-To — no ticket storage,
// no dashboard, just "it lands in the inbox."
function wireHelpSupport() {
  const modal = document.getElementById('helpSupportModal');
  const openBtn = document.getElementById('helpSupportBtn');
  const cancelBtn = document.getElementById('cancelHelpSupportBtn');
  const form = document.getElementById('helpSupportForm');
  const submitBtn = document.getElementById('submitHelpSupportBtn');
  const msgEl = document.getElementById('helpSupportMsg');

  function closeModal() {
    modal.classList.add('hidden');
  }

  openBtn.addEventListener('click', () => {
    form.reset();
    msgEl.innerHTML = '';
    modal.classList.remove('hidden');
  });
  cancelBtn.addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = document.getElementById('supportSubject').value.trim();
    const message = document.getElementById('supportMessage').value.trim();
    if (!subject || !message) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    msgEl.innerHTML = '';

    try {
      const result = await callBillingFunction('send-support-message', { subject, message });
      if (result.ok && result.data.sent) {
        toast('Message sent — we\'ll get back to you by email.', 'success');
        closeModal();
      } else {
        msgEl.innerHTML = `<p class="field-hint" style="color:var(--danger);">${escapeHtml((result.data && result.data.error) || 'Could not send your message. Please try again.')}</p>`;
      }
    } catch (err) {
      msgEl.innerHTML = `<p class="field-hint" style="color:var(--danger);">Something went wrong: ${escapeHtml(err.message || String(err))}</p>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Message';
    }
  });
}

// Populates the KPI summary row at the top of the Employee Ledger page:
// headcount, the company's configured bank, this calendar month's total
// disbursed amount, and the most recent export batch — all derived from
// data already being fetched (employees, company profile, disbursement
// history), so no extra Firestore reads are introduced.
async function renderEmployeeKpis() {
  const totalEl = document.getElementById('kpiTotalEmployees');
  const bankEl = document.getElementById('kpiCompanyBank');
  const monthEl = document.getElementById('kpiMonthDisbursed');
  const lastEl = document.getElementById('kpiLastExport');
  const lastSubEl = document.getElementById('kpiLastExportSub');
  if (!totalEl) return; // KPI row only exists on the Employee Ledger page

  totalEl.textContent = employees.length;
  const bank = BANK_BY_KEY[companyProfile.bankName || 'SBI'] || BANK_BY_KEY.SBI;
  bankEl.textContent = bank.label;
  monthEl.textContent = '…';
  lastEl.textContent = '…';
  lastSubEl.textContent = '';

  let history = [];
  try {
    history = await Api.getDisbursementHistory();
  } catch (err) {
    console.error(err);
  }

  const now = new Date();
  let monthTotal = 0;
  history.forEach(row => {
    const created = row.createdAt && row.createdAt.toDate ? row.createdAt.toDate() : null;
    if (created && created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear()) {
      const amt = parseFloat(row.amount);
      if (!isNaN(amt)) monthTotal += amt;
    }
  });
  monthEl.textContent = `₹ ${monthTotal.toFixed(2)}`;

  // getDisbursementHistory() is already ordered newest-first, so the
  // first row belongs to the most recently exported batch.
  const last = history[0];
  if (last) {
    lastEl.textContent = last.batchId || '—';
    const d = last.createdAt && last.createdAt.toDate ? last.createdAt.toDate().toLocaleDateString() : (last.transferDate || '');
    lastSubEl.textContent = d ? `on ${d}` : '';
  } else {
    lastEl.textContent = '—';
    lastSubEl.textContent = 'No exports yet';
  }
}

// Generic page navigation, shared by the topbar tabs, the Settings
// list items (Edit Company Details), and any code that needs to jump
// to a specific page programmatically (e.g. redirecting to Company
// Details when the profile is incomplete).
function showAppPage(page) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
  const section = document.getElementById('page-' + page);
  if (section) section.classList.remove('hidden');
  if (page === 'audit') loadAuditTrail();
  if (page === 'exports') loadExportHistory();
  if (page === 'wallet') renderWalletPage();
  if (page === 'payments') renderPaymentHistory();
}
function goToPage(page) { showAppPage(page); }

function wireNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      // Any tap inside the (mobile) sidebar drawer should close it,
      // whether it's a real page nav or the Help & Support icon,
      // which has no data-page and opens a modal instead (wired
      // separately in wireHelpSupport()).
      closeMobileDrawer();
      if (!item.dataset.page) return;
      showAppPage(item.dataset.page);
    });
  });
  document.getElementById('companyBackToSettings').addEventListener('click', (e) => {
    e.preventDefault();
    showAppPage('settings');
  });
}

// ---------------------------------------------------------
// MOBILE DRAWER — on phones the sidebar (Activity Log / Settings /
// Help & Support / wallet / account / logout) becomes a slide-in
// drawer instead of a permanent column. Opened from the hamburger
// button in the topbar; closed via the × button, tapping the dimmed
// backdrop, or tapping any item inside (handled in wireNav above).
// No-ops harmlessly on desktop, where these elements stay hidden.
// ---------------------------------------------------------
function openMobileDrawer() {
  document.querySelector('.sidebar').classList.add('is-open');
  document.getElementById('sidebarBackdrop').classList.add('is-open');
  document.getElementById('mobileMenuBtn').setAttribute('aria-expanded', 'true');
}
function closeMobileDrawer() {
  document.querySelector('.sidebar').classList.remove('is-open');
  document.getElementById('sidebarBackdrop').classList.remove('is-open');
  document.getElementById('mobileMenuBtn').setAttribute('aria-expanded', 'false');
}
function wireMobileDrawer() {
  document.getElementById('mobileMenuBtn').addEventListener('click', openMobileDrawer);
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeMobileDrawer);
  document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileDrawer);
  document.getElementById('walletChipMobile').addEventListener('click', () => showAppPage('wallet'));
  document.getElementById('logoutBtn').addEventListener('click', closeMobileDrawer);
}

// Renders N placeholder rows into a <tbody> while a Firestore read is
// in flight, so the table isn't just blank/frozen on a slow connection.
function renderSkeletonRows(tbody, colCount, rowCount) {
  tbody.innerHTML = Array.from({ length: rowCount }, () =>
    `<tr class="skeleton-row">${'<td><span class="skeleton-bar"></span></td>'.repeat(colCount)}</tr>`
  ).join('');
}

async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  renderSkeletonRows(tbody, 9, 4);
  try {
    employees = await Api.getEmployees();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);">Could not load employees: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  renderEmployeeTable();
  renderDisbursementList();
}

// Bank account numbers are sensitive — mask them on screen by
// default (last 4 digits only) with a click-to-reveal toggle, so
// they aren't sitting in plain view on a shared screen or during
// a screen-share.
function maskAccount(acc) {
  const s = String(acc || '');
  if (s.length <= 4) return s;
  return '•'.repeat(s.length - 4) + s.slice(-4);
}
function wireMaskedAccountToggles(container) {
  container.querySelectorAll('.masked-acc button').forEach(btn => {
    btn.onclick = () => {
      const span = btn.previousElementSibling;
      const revealed = span.dataset.revealed === '1';
      span.textContent = revealed ? maskAccount(span.dataset.full) : span.dataset.full;
      span.dataset.revealed = revealed ? '0' : '1';
      btn.textContent = revealed ? 'Show' : 'Hide';
    };
  });
}

// Renders a transfer-mode/type value (Same Bank, RTGS, NEFT, IMPS,
// Other Bank) as a small colored pill instead of plain text.
function badgeForMode(mode) {
  const cls = mode === 'Same Bank' ? 'badge-green'
    : mode === 'RTGS' ? 'badge-blue'
    : mode === 'NEFT' ? 'badge-blue'
    : mode === 'IMPS' ? 'badge-amber'
    : 'badge-grey';
  return `<span class="badge ${cls}">${escapeHtml(mode || '—')}</span>`;
}

// Sort state persists across re-renders (search, add/edit/delete) so the
// chosen order doesn't reset itself every time the table redraws.
let employeeSort = { key: null, dir: 1 };
let selectedEmployeeIds = new Set();

// ---------------------------------------------------------
// SOFT DELETE + UNDO (Employees)
// The row is removed from the UI (and from `employees`) immediately,
// but the actual Firestore delete is delayed by UNDO_WINDOW_MS. If the
// user hits "Undo" on the toast within that window, the row is simply
// put back and Firestore is never touched. Otherwise the delete is
// committed silently once the window elapses.
// ---------------------------------------------------------
const UNDO_WINDOW_MS = 5000;
let pendingEmployeeDeletions = new Map(); // id -> { emp, timer }

function refreshAfterEmployeeListChange() {
  renderEmployeeTable();
  renderDisbursementList();
  renderEmployeeKpis();
}

function softDeleteEmployees(ids, emps) {
  employees = employees.filter(e => !ids.includes(e.id));
  refreshAfterEmployeeListChange();

  const timer = setTimeout(async () => {
    ids.forEach(id => pendingEmployeeDeletions.delete(id));
    try {
      await Promise.all(ids.map(id => Api.deleteEmployee(id)));
      const names = emps.map(e => e && e.name).filter(Boolean);
      if (ids.length > 1) {
        await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK DELETE EMPLOYEES',
          `Deleted ${ids.length}: ${names.join(', ')}`);
      } else {
        const emp = emps[0];
        await Api.logAudit(currentUser.email, currentUser.displayName, 'DELETE EMPLOYEE',
          `Deleted: ${emp ? emp.name : ''} | Acc: ${emp ? emp.accountNumber : ids[0]}`);
      }
    } catch (err) {
      toast('Delete failed: ' + err.message, 'error');
      await loadEmployees();
      renderEmployeeKpis();
    }
  }, UNDO_WINDOW_MS);

  ids.forEach(id => pendingEmployeeDeletions.set(id, { timer }));

  const label = ids.length > 1 ? `${ids.length} employees deleted.` : `${(emps[0] && emps[0].name) || 'Employee'} deleted.`;
  toast(label, 'success', {
    actionLabel: 'Undo',
    duration: UNDO_WINDOW_MS,
    onAction: () => {
      const stillPending = ids.some(id => pendingEmployeeDeletions.has(id));
      if (!stillPending) return; // window already elapsed / already committed
      clearTimeout(timer);
      ids.forEach(id => pendingEmployeeDeletions.delete(id));
      emps.forEach(emp => { if (emp && !employees.some(e => e.id === emp.id)) employees.push(emp); });
      refreshAfterEmployeeListChange();
      toast(ids.length > 1 ? `${ids.length} employees restored.` : `${(emps[0] && emps[0].name) || 'Employee'} restored.`, 'info');
    }
  });
}

function sortRows(rows, key, dir) {
  if (!key) return rows;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => dir * collator.compare(String(a[key] ?? ''), String(b[key] ?? '')));
}

function updateEmployeeSortHeaders() {
  document.querySelectorAll('#page-employees th.sortable').forEach(th => {
    const active = th.dataset.sort === employeeSort.key;
    th.classList.toggle('sort-active', active);
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active && employeeSort.dir === -1 ? '▼' : '▲';
  });
}

function updateEmployeeBulkBar() {
  const bar = document.getElementById('employeeBulkBar');
  const count = selectedEmployeeIds.size;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('employeeSelectedCount').textContent = count;
}

function renderEmployeeTable() {
  const tbody = document.getElementById('employeeTableBody');
  const emptyState = document.getElementById('employeeEmptyState');
  const query = (document.getElementById('employeeSearch').value || '').trim().toLowerCase();

  // Drop selections for employees no longer in the current employee list
  // (e.g. after a delete), so the count stays accurate.
  const currentIds = new Set(employees.map(e => e.id));
  selectedEmployeeIds.forEach(id => { if (!currentIds.has(id)) selectedEmployeeIds.delete(id); });

  let filtered = employees.filter(e =>
    !query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query));
  filtered = sortRows(filtered, employeeSort.key, employeeSort.dir);
  updateEmployeeSortHeaders();

  tbody.innerHTML = '';
  if (!filtered.length) {
    emptyState.classList.remove('hidden');
    updateEmployeeBulkBar();
    return;
  }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    const checked = selectedEmployeeIds.has(emp.id) ? 'checked' : '';
    tr.innerHTML = `
      <td class="row-select-cell card-cell-plain"><label class="checkbox-hit"><input type="checkbox" data-select="${escapeHtml(emp.id)}" ${checked} aria-label="Select ${escapeHtml(emp.name)}"></label></td>
      <td data-label="Name"><span class="cell-truncate" title="${escapeHtml(emp.name)}">${escapeHtml(emp.name)}</span></td>
      <td data-label="Account No."><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td data-label="IFSC">${escapeHtml(emp.ifsc)}</td>
      <td data-label="Transfer Type">${badgeForMode(emp.transferType)}</td>
      <td data-label="Emp Code">${escapeHtml(emp.empCode)}</td>
      <td data-label="Mobile">${escapeHtml(emp.mobile || '—')}</td>
      <td data-label="Email"><span class="cell-truncate" title="${escapeHtml(emp.email || '—')}">${escapeHtml(emp.email || '—')}</span></td>
      <td class="row-actions">
        <button data-edit="${escapeHtml(emp.id)}">Edit</button>
        <button data-delete="${escapeHtml(emp.id)}" class="danger">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openEditModal(btn.dataset.edit));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => handleDelete(btn.dataset.delete));
  tbody.querySelectorAll('[data-select]').forEach(cb => cb.onchange = () => {
    if (cb.checked) selectedEmployeeIds.add(cb.dataset.select);
    else selectedEmployeeIds.delete(cb.dataset.select);
    updateEmployeeBulkBar();
    const allCb = document.getElementById('employeeSelectAll');
    if (allCb) allCb.checked = filtered.length > 0 && filtered.every(e => selectedEmployeeIds.has(e.id));
  });
  wireMaskedAccountToggles(tbody);
  updateEmployeeBulkBar();
}

function wireEmployeeTableControls() {
  document.querySelectorAll('#page-employees th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (employeeSort.key === key) employeeSort.dir *= -1;
      else employeeSort = { key, dir: 1 };
      renderEmployeeTable();
    });
  });

  document.getElementById('employeeSelectAll').addEventListener('change', (e) => {
    const query = (document.getElementById('employeeSearch').value || '').trim().toLowerCase();
    const visible = employees.filter(emp =>
      !query || emp.name.toLowerCase().includes(query) || String(emp.accountNumber).includes(query));
    if (e.target.checked) visible.forEach(emp => selectedEmployeeIds.add(emp.id));
    else visible.forEach(emp => selectedEmployeeIds.delete(emp.id));
    renderEmployeeTable();
  });

  document.getElementById('employeeBulkClearBtn').addEventListener('click', () => {
    selectedEmployeeIds.clear();
    renderEmployeeTable();
  });

  document.getElementById('employeeBulkDeleteBtn').addEventListener('click', async () => {
    const ids = [...selectedEmployeeIds];
    if (!ids.length) return;
    const ok = await confirmDialog(
      `Delete ${ids.length} selected employee${ids.length === 1 ? '' : 's'}? You'll have a few seconds to undo.`,
      { title: 'Delete Selected Employees' }
    );
    if (!ok) return;
    const emps = ids.map(id => employees.find(e => e.id === id)).filter(Boolean);
    selectedEmployeeIds.clear();
    softDeleteEmployees(ids, emps);
  });
}

// ---------------------------------------------------------
// Employee form helpers — mirror the desktop app's field-level
// behaviour exactly: name parts are split/joined the same way,
// account/IFSC fields block spaces & paste, name/IFSC fields
// auto-uppercase as you type, and duplicate/mismatch checks are
// evaluated live on every keystroke, not just on submit.
// ---------------------------------------------------------
function splitFullNameParts(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ['', '', ''];
  if (parts.length === 1) return [parts[0], '', ''];
  if (parts.length === 2) return [parts[0], '', parts[1]];
  return [parts[0], parts.slice(1, -1).join(' '), parts[parts.length - 1]];
}

function blockSpaceKey(el) {
  el.addEventListener('keydown', (e) => { if (e.key === ' ') e.preventDefault(); });
}
function blockPasteAndRightClick(el) {
  el.addEventListener('paste', (e) => e.preventDefault());
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
function autoUpperCaseLive(el) {
  el.addEventListener('input', () => {
    const pos = el.selectionStart;
    const upper = el.value.toUpperCase();
    if (upper !== el.value) {
      el.value = upper;
      try { el.setSelectionRange(pos, pos); } catch (_) {}
    }
  });
}
// Strips any non-digit character as the user types (or pastes, drag-drops,
// autofills, etc. — anything that fires an 'input' event). Used for
// Employee Code and Account Number fields, which must be numeric only;
// IFSC stays untouched since it's genuinely alphanumeric (e.g. SBIN0001234).
function digitsOnlyLive(el) {
  el.addEventListener('input', () => {
    const pos = el.selectionStart;
    const digits = el.value.replace(/[^0-9]/g, '');
    if (digits !== el.value) {
      const removed = el.value.length - digits.length;
      el.value = digits;
      try { el.setSelectionRange(pos - removed, pos - removed); } catch (_) {}
    }
  });
}

function wireEmployeeForm() {
  const modal = document.getElementById('employeeModal');
  const employeeForm = document.getElementById('employeeForm');
  const errBox = document.getElementById('employeeFormError');

  const fFirst  = document.getElementById('empFirstName');
  const fMiddle = document.getElementById('empMiddleName');
  const fLast   = document.getElementById('empLastName');
  const fCode   = document.getElementById('empCode');
  const fType   = document.getElementById('empTransferType');
  const fMobile = document.getElementById('empMobile');
  const fEmail  = document.getElementById('empEmail');
  const fAcc    = document.getElementById('empAccount');
  const fAccC   = document.getElementById('empAccountConfirm');
  const fIfsc   = document.getElementById('empIfsc');
  const fIfscC  = document.getElementById('empIfscConfirm');
  const accMismatchLbl  = document.getElementById('accMismatchLbl');
  const ifscMismatchLbl = document.getElementById('ifscMismatchLbl');
  const mobileErrLbl = document.getElementById('empMobileError');
  const emailErrLbl  = document.getElementById('empEmailError');

  // Name fields: no spaces within a single box, auto-uppercase as-you-type
  [fFirst, fMiddle, fLast].forEach(el => { blockSpaceKey(el); autoUpperCaseLive(el); });
  // Emp code: numeric only, no spaces
  blockSpaceKey(fCode);
  digitsOnlyLive(fCode);
  // Mobile: digits only, max 10, no spaces
  blockSpaceKey(fMobile);
  fMobile.addEventListener('input', () => {
    fMobile.value = fMobile.value.replace(/[^0-9]/g, '').slice(0, 10);
    validateMobileEmailLive();
  });
  fEmail.addEventListener('input', validateMobileEmailLive);

  function validateMobileEmailLive() {
    const mobileVal = fMobile.value.trim();
    if (!mobileVal) { mobileErrLbl.textContent = ''; fMobile.classList.remove('input-mismatch'); }
    else if (!/^[6-9][0-9]{9}$/.test(mobileVal)) {
      mobileErrLbl.textContent = 'Enter a valid 10-digit mobile number';
      fMobile.classList.add('input-mismatch');
    } else { mobileErrLbl.textContent = ''; fMobile.classList.remove('input-mismatch'); }

    const emailVal = fEmail.value.trim();
    if (!emailVal) { emailErrLbl.textContent = ''; fEmail.classList.remove('input-mismatch'); }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      emailErrLbl.textContent = 'Enter a valid email address';
      fEmail.classList.add('input-mismatch');
    } else { emailErrLbl.textContent = ''; fEmail.classList.remove('input-mismatch'); }
  }
  // Account / IFSC pairs: no spaces, no paste/right-click paste
  [fAcc, fAccC, fIfsc, fIfscC].forEach(el => { blockSpaceKey(el); blockPasteAndRightClick(el); });
  // Account Number is numeric only; IFSC stays alphanumeric (bank codes
  // like SBIN0001234 genuinely mix letters and digits) and just gets
  // auto-uppercased as before.
  [fAcc, fAccC].forEach(el => digitsOnlyLive(el));
  [fIfsc, fIfscC].forEach(el => autoUpperCaseLive(el));

  function clearMatchStyles(el) {
    el.classList.remove('input-mismatch', 'input-match');
  }

  function showFieldError(msg) {
    errBox.textContent = msg;
    errBox.classList.add('show');
  }
  function clearFieldError() {
    errBox.textContent = '';
    errBox.classList.remove('show');
  }

  function existingAccountNumbers() {
    return employees
      .filter(e => e.id !== editingEmployeeId)
      .map(e => String(e.accountNumber));
  }
  function existingEmpCodes() {
    return employees
      .filter(e => e.id !== editingEmployeeId)
      .map(e => String(e.empCode));
  }

  function validateLive() {
    const accVal = fAcc.value.trim();
    const isDuplicate = accVal && existingAccountNumbers().includes(accVal);

    if (isDuplicate) {
      clearMatchStyles(fAcc);
      fAcc.classList.add('input-mismatch');
      accMismatchLbl.textContent = '⚠ DUPLICATE ACC';
    } else {
      clearMatchStyles(fAcc);
    }

    function checkPair(primeEl, confEl, lbl, skip) {
      if (skip) return;
      const prime = primeEl.value.trim();
      const conf = confEl.value.trim();
      clearMatchStyles(confEl);
      if (conf) {
        if (prime !== conf) {
          confEl.classList.add('input-mismatch');
          lbl.textContent = 'MISMATCH';
        } else {
          confEl.classList.add('input-match');
          lbl.textContent = '';
        }
      } else {
        lbl.textContent = '';
      }
    }
    checkPair(fAcc, fAccC, accMismatchLbl, isDuplicate);
    checkPair(fIfsc, fIfscC, ifscMismatchLbl, false);
    autoDetectTransferType();
  }
  [fAcc, fAccC, fIfsc, fIfscC].forEach(el => el.addEventListener('input', validateLive));

  // Auto-detects Same Bank vs Other Bank from the employee's own IFSC,
  // compared against the company's own bank (Company Details page),
  // instead of leaving it to the user to remember/pick correctly every
  // time. This is what actually decides Same Bank (intra-bank) vs Other
  // Bank (inter-bank, NEFT/RTGS/IMPS) for the export — a wrong manual
  // pick here used to be the only way that could go wrong, since
  // nothing cross-checked it against the real IFSC. The dropdown stays
  // editable in case a genuine edge case needs a manual override, but
  // it's now pre-filled correctly the moment a full, matching IFSC is
  // entered.
  function autoDetectTransferType() {
    const ifsc = fIfsc.value.trim().toUpperCase();
    const ifscC = fIfscC.value.trim().toUpperCase();
    if (!ifsc || ifsc !== ifscC || ifsc.length < 4) return;
    const companyIfscPrefix = String(companyProfile.ifsc || '').toUpperCase().slice(0, 4);
    const bank = BANK_BY_KEY[companyProfile.bankName || 'SBI'];
    const ownPrefix = companyIfscPrefix || (bank && bank.ifscPrefix) || '';
    if (!ownPrefix) return;
    fType.value = ifsc.startsWith(ownPrefix) ? 'Same Bank' : 'Other Bank';
  }

  function resetForm() {
    employeeForm.reset();
    [fAcc, fAccC, fIfsc, fIfscC, fMobile, fEmail].forEach(clearMatchStyles);
    accMismatchLbl.textContent = '';
    ifscMismatchLbl.textContent = '';
    mobileErrLbl.textContent = '';
    emailErrLbl.textContent = '';
    clearFieldError();
    fType.value = 'Same Bank';
  }

  document.getElementById('addEmployeeBtn').onclick = () => {
    editingEmployeeId = null;
    document.getElementById('modalTitle').textContent = 'Add Employee';
    resetForm();
    modal.classList.remove('hidden');
    fFirst.focus();
  };
  document.getElementById('cancelModalBtn').onclick = () => modal.classList.add('hidden');

  window.openEditModal = (id) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    editingEmployeeId = id;
    document.getElementById('modalTitle').textContent = 'Edit Employee Record';
    resetForm();
    const [first, middle, last] = splitFullNameParts(emp.name);
    fFirst.value = first;
    fMiddle.value = middle;
    fLast.value = last;
    fAcc.value = emp.accountNumber;
    fAccC.value = emp.accountNumber;
    fIfsc.value = emp.ifsc;
    fIfscC.value = emp.ifsc;
    fCode.value = emp.empCode;
    fType.value = emp.transferType;
    fMobile.value = emp.mobile || '';
    fEmail.value = emp.email || '';
    modal.classList.remove('hidden');
  };

  employeeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldError();

    const fname  = fFirst.value.trim();
    const mname  = fMiddle.value.trim();
    const lname  = fLast.value.trim();
    const acc    = fAcc.value.trim().replace(/\s+/g, '');
    const accC   = fAccC.value.trim().replace(/\s+/g, '');
    const ifsc   = fIfsc.value.trim().replace(/\s+/g, '').toUpperCase();
    const ifscC  = fIfscC.value.trim().replace(/\s+/g, '').toUpperCase();
    const empCode = fCode.value.trim().padStart(2, '0');
    const transferType = fType.value;
    const mobile = fMobile.value.trim();
    const email  = fEmail.value.trim().toLowerCase();

    // Required-field check — Middle Name is the sole optional field.
    if (!(fname && lname && acc && accC && ifsc && ifscC && empCode && mobile && email)) {
      showFieldError('Please fill in all required fields before saving. (Middle Name is optional)');
      return;
    }
    if (!/^[6-9][0-9]{9}$/.test(mobile)) {
      showFieldError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFieldError('Please enter a valid email address.');
      return;
    }
    // Employee Code and Account Number must be numeric only — the fields
    // already filter this live, but this catches anything that slips
    // through (e.g. a value set programmatically) before it gets saved.
    if (!/^[0-9]+$/.test(empCode)) {
      showFieldError('Employee Code must contain numbers only.');
      return;
    }
    if (!/^[0-9]+$/.test(acc) || !/^[0-9]+$/.test(accC)) {
      showFieldError('Account Number must contain numbers only.');
      return;
    }
    // Double-entry verification for Account Number and IFSC.
    if (acc !== accC || ifsc !== ifscC) {
      showFieldError('Account Number and IFSC must match their confirmation fields.');
      return;
    }

    const nameParts = [fname];
    if (mname) nameParts.push(mname);
    nameParts.push(lname);
    const fullName = nameParts.join(' ').toUpperCase();

    // Duplicate account-number check, excluding the record currently being edited.
    if (existingAccountNumbers().includes(acc)) {
      showFieldError(`Account number ${acc} is already assigned to another employee in the ledger.`);
      return;
    }
    // Emp Code feeds directly into the SBI batch reference string, so a
    // collision there produces two rows with a near-identical reference.
    if (existingEmpCodes().includes(empCode)) {
      showFieldError(`Emp Code ${empCode} is already assigned to another employee in the ledger.`);
      return;
    }

    const emp = { name: fullName, accountNumber: acc, ifsc, empCode, transferType, mobile, email };

    const btn = document.getElementById('saveEmployeeBtn');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      if (editingEmployeeId) {
        await Api.updateEmployee(editingEmployeeId, emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'EDIT EMPLOYEE',
          `${emp.name} | Acc: ${emp.accountNumber} | IFSC: ${emp.ifsc} | Type: ${emp.transferType}`);
      } else {
        await Api.addEmployee(emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'ADD EMPLOYEE',
          `${emp.name} | Acc: ${emp.accountNumber} | IFSC: ${emp.ifsc} | Type: ${emp.transferType}`);
      }
      modal.classList.add('hidden');
      await loadEmployees();
    } catch (err) {
      showFieldError('Save failed: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  });

  window.handleDelete = async (id) => {
    const emp = employees.find(e => e.id === id);
    const ok = await confirmDialog(`Delete ${emp ? emp.name : id}? You'll have a few seconds to undo.`, { title: 'Delete Employee' });
    if (!ok) return;
    softDeleteEmployees([id], [emp]);
  };
}

// A ready-to-fill CSV using the exact headers parseCsv() expects, with
// one example row — closes the gap where the required column names
// only ever existed in source code, not anywhere in the UI.
function downloadSampleCsv() {
  const sample = [
    'Employee Name,Account Number,IFSC_BranchCode,Transfer Type,Emp Code,Mobile,Email',
    'JOHN DOE,123456789012,SBIN0001234,Same Bank,01,9876543210,john.doe@example.com'
  ].join('\r\n') + '\r\n';
  downloadTextFile('payflow_bulk_import_sample.csv', sample, 'text/csv;charset=utf-8');
}

// Exports the full current Employee Ledger back out as CSV, in the same
// column layout the Bulk Import expects — so the ledger can round-trip
// out for backup/editing and back in again.
function exportLedgerCsv() {
  if (!employees.length) { toast('No employees to export yet.', 'error'); return; }
  const header = 'Employee Name,Account Number,IFSC_BranchCode,Transfer Type,Emp Code,Mobile,Email';
  const rows = employees.map(e => csvRow([e.name, e.accountNumber, e.ifsc, e.transferType, e.empCode, e.mobile || '', e.email || '']));
  const content = [header, ...rows].join('\r\n') + '\r\n';
  downloadTextFile(`payflow_employee_ledger_${new Date().toISOString().slice(0, 10)}.csv`, content, 'text/csv;charset=utf-8');
}

// Parsed-but-not-yet-imported rows/errors, held between the preview
// modal being shown and the user confirming the import.
let pendingImportRows = [];
let pendingImportErrors = [];

function wireBulkImport() {
  const fileInput = document.getElementById('bulkImportInput');
  document.getElementById('bulkImportBtn').onclick = () => fileInput.click();
  document.getElementById('downloadSampleCsvLink').addEventListener('click', (e) => {
    e.preventDefault();
    downloadSampleCsv();
  });
  document.getElementById('exportLedgerCsvBtn').addEventListener('click', exportLedgerCsv);
  document.getElementById('importResultCloseBtn').addEventListener('click', () =>
    document.getElementById('importResultModal').classList.add('hidden'));

  // Selecting a file only parses and validates it — nothing is written
  // to the ledger yet. The user reviews exactly what will and won't be
  // imported in the preview modal below and has to explicitly confirm.
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const existingAccounts = employees.map(e => String(e.accountNumber));
      const { rows, errors } = parseCsv(text, existingAccounts);
      pendingImportRows = rows;
      pendingImportErrors = errors;
      showImportPreviewModal(rows, errors);
    } catch (err) {
      toast('Could not read file: ' + err.message, 'error');
    } finally {
      fileInput.value = '';
    }
  });

  document.getElementById('cancelImportPreviewBtn').addEventListener('click', () => {
    document.getElementById('importPreviewModal').classList.add('hidden');
    pendingImportRows = []; pendingImportErrors = [];
  });

  document.getElementById('confirmImportBtn').addEventListener('click', async () => {
    if (!pendingImportRows.length) {
      document.getElementById('importPreviewModal').classList.add('hidden');
      return;
    }
    const btn = document.getElementById('confirmImportBtn');
    btn.disabled = true; btn.textContent = 'Importing...';
    try {
      await Api.bulkAddEmployees(pendingImportRows);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK IMPORT',
        `${pendingImportRows.length} employees imported${pendingImportErrors.length ? `, ${pendingImportErrors.length} row(s) skipped` : ''}`);
      await loadEmployees();
      document.getElementById('importPreviewModal').classList.add('hidden');
      showImportResultModal(pendingImportRows.length, pendingImportErrors);
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      pendingImportRows = []; pendingImportErrors = [];
    }
  });
}

// Renders the pre-import review: every row that parsed cleanly (green,
// "Will import") and every row that failed validation (red, with its
// exact reason) — so a bad file is caught and understood before a
// single record reaches the ledger, instead of only finding out after.
function showImportPreviewModal(rows, errors) {
  const summary = document.getElementById('importPreviewSummary');
  summary.innerHTML = `
    <span style="color:var(--success); font-weight:700;">${rows.length} row${rows.length === 1 ? '' : 's'} will be imported</span>
    ${errors.length ? ` &nbsp;•&nbsp; <span style="color:var(--danger); font-weight:700;">${errors.length} row${errors.length === 1 ? '' : 's'} will be skipped</span>` : ''}`;

  const tbody = document.getElementById('importPreviewTableBody');
  tbody.innerHTML = '';

  // Guards against freezing the tab on a very large file — everything
  // past this many rows is still imported/skipped exactly the same,
  // it's just not individually listed in the preview table.
  const MAX_ROWS = 500;
  let shown = 0;

  rows.forEach((r, i) => {
    if (shown >= MAX_ROWS) return;
    shown++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="#">${i + 1}</td>
      <td data-label="Emp Code">${escapeHtml(r.empCode)}</td>
      <td data-label="Name">${escapeHtml(r.name)}</td>
      <td data-label="Account Number" style="font-family:var(--font-mono);">${escapeHtml(maskAccount(r.accountNumber))}</td>
      <td data-label="IFSC" style="font-family:var(--font-mono);">${escapeHtml(r.ifsc)}</td>
      <td data-label="Transfer Type">${escapeHtml(r.transferType)}</td>
      <td data-label="Status"><span class="badge badge-green">✓ Will import</span></td>`;
    tbody.appendChild(tr);
  });
  errors.forEach(e => {
    if (shown >= MAX_ROWS) return;
    shown++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="#">Line ${e.line}</td>
      <td data-label="Reason" colspan="4" style="color:var(--text2);">${escapeHtml(e.reason)}</td>
      <td data-label="Account Number">—</td>
      <td data-label="Status"><span class="badge" style="color:var(--danger); border-color:var(--danger);">✗ Skipped</span></td>`;
    tbody.appendChild(tr);
  });

  if (rows.length + errors.length > MAX_ROWS) {
    const note = document.createElement('tr');
    note.innerHTML = `<td colspan="7" style="color:var(--text3); text-align:center; padding:12px;">+ ${rows.length + errors.length - MAX_ROWS} more row(s) not listed — they will be processed the same way.</td>`;
    tbody.appendChild(note);
  }

  const confirmBtn = document.getElementById('confirmImportBtn');
  confirmBtn.textContent = rows.length ? `Import ${rows.length} Employee${rows.length === 1 ? '' : 's'}` : 'Nothing to Import';
  confirmBtn.disabled = !rows.length;

  document.getElementById('importPreviewModal').classList.remove('hidden');
}

// Shows a clear summary of what was imported vs skipped, with the exact
// line number and reason for every skipped row — replaces the old silent
// "Imported N employees" alert that gave no visibility into failures.
function showImportResultModal(importedCount, errors) {
  const body = document.getElementById('importResultBody');
  const okLine = `<p style="color:var(--success); font-weight:600;">${importedCount} employee${importedCount === 1 ? '' : 's'} imported successfully.</p>`;
  const errLines = errors.length
    ? `<p style="color:var(--danger); font-weight:600; margin-top:10px;">${errors.length} row(s) skipped:</p>
       <div style="max-height:220px; overflow-y:auto; font-size:12.5px; font-family:var(--font-mono); line-height:1.7; background:var(--surface2); border-radius:var(--radius-sm); padding:10px 12px;">
         ${errors.map(e => `Line ${e.line}: ${escapeHtml(e.reason)}`).join('<br>')}
       </div>`
    : '';
  body.innerHTML = okLine + errLines;
  document.getElementById('importResultModal').classList.remove('hidden');
}

const VALID_TRANSFER_TYPES = ['Same Bank', 'Other Bank'];

// Returns { rows, errors } instead of just an array, so the caller can
// tell the user exactly which CSV lines were skipped and why, rather
// than silently dropping bad rows or letting bad data slip in.
//   rows[]   — well-formed candidate employees, ready for the duplicate
//              check the caller still needs to run against existingAccounts
//   errors[] — { line, reason } for every row that failed validation
function parseCsv(text, existingAccounts) {
  const existing = new Set((existingAccounts || []).map(String));
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], errors: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idxAcc    = headers.indexOf('account number');
  const idxIfsc   = headers.indexOf('ifsc_branchcode');
  const idxName   = headers.indexOf('employee name');
  const idxType   = headers.indexOf('transfer type');
  const idxCode   = headers.indexOf('emp code');
  // Mobile/Email are required on every employee record everywhere else
  // in the app (see the manual Add Employee form) — bulk import used to
  // silently skip reading these two columns entirely, so CSV-imported
  // employees ended up with no phone/email on file even when the
  // uploaded sheet had them. Reading + validating them here the same
  // way the manual form does keeps both entry paths in sync.
  const idxMobile = headers.indexOf('mobile');
  const idxEmail  = headers.indexOf('email');

  const rows = [];
  const errors = [];
  const seenInFile = new Set(); // catches duplicates WITHIN the same CSV
  const seenCodes = new Set();

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based, matches what a spreadsheet app would show
    const cols = lines[i].split(',').map(c => c.trim());
    // Account Number and Emp Code are numeric-only fields — strip any
    // stray letters/symbols from the CSV the same way the manual Add
    // Employee form does, so bulk import can't bypass that rule.
    const accountNumber = (cols[idxAcc >= 0 ? idxAcc : 0] || '').replace(/[^0-9]/g, '');
    const ifsc = (cols[idxIfsc >= 0 ? idxIfsc : 1] || '').toUpperCase();
    const name = (cols[idxName >= 0 ? idxName : 2] || '').toUpperCase();
    const rawType = (cols[idxType >= 0 ? idxType : 3] || 'Same Bank').trim();
    const empCode = ((cols[idxCode >= 0 ? idxCode : 4] || '01').replace(/[^0-9]/g, '') || '01').padStart(2, '0');
    const mobile = (cols[idxMobile >= 0 ? idxMobile : 5] || '').replace(/[^0-9]/g, '');
    const email = (cols[idxEmail >= 0 ? idxEmail : 6] || '').trim().toLowerCase();

    if (!accountNumber || !name) {
      errors.push({ line: lineNo, reason: 'Missing Account Number or Employee Name.' });
      continue;
    }
    // Case/whitespace-tolerant match against "Same Bank" / "Other Bank" —
    // anything else (typo, blank, unexpected value) is rejected outright
    // rather than silently defaulting, since a wrong value here makes an
    // employee vanish from the SBI Disbursement list with no warning.
    const transferType = VALID_TRANSFER_TYPES.find(t => t.toLowerCase() === rawType.toLowerCase());
    if (!transferType) {
      errors.push({ line: lineNo, reason: `Invalid Transfer Type "${rawType}" — must be "Same Bank" or "Other Bank".` });
      continue;
    }
    if (!/^[6-9][0-9]{9}$/.test(mobile)) {
      errors.push({ line: lineNo, reason: `Missing or invalid Mobile number "${cols[idxMobile >= 0 ? idxMobile : 5] || ''}" — must be a valid 10-digit number.` });
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ line: lineNo, reason: `Missing or invalid Email "${cols[idxEmail >= 0 ? idxEmail : 6] || ''}".` });
      continue;
    }
    if (existing.has(accountNumber) || seenInFile.has(accountNumber)) {
      errors.push({ line: lineNo, reason: `Duplicate Account Number ${accountNumber} (already in ledger or repeated in this file).` });
      continue;
    }
    if (seenCodes.has(empCode)) {
      errors.push({ line: lineNo, reason: `Duplicate Emp Code ${empCode} within this file.` });
      continue;
    }
    seenInFile.add(accountNumber);
    seenCodes.add(empCode);
    rows.push({ accountNumber, ifsc, name, transferType, empCode, mobile, email });
  }
  return { rows, errors };
}

// Initializes the two native date pickers on the Disbursement page:
//  - Payroll Cycle (<input type="month">) — defaults to the current
//    month, drives the payroll-cycle label used on the exported file.
//  - Transfer Date (<input type="date">) — defaults to today but is
//    fully editable, so a batch can be dated for a future value date
//    instead of always using "today".
function initDisbursementDateFields() {
  const now = new Date();
  const monthInput = document.getElementById('disbPayrollMonth');
  const dateInput = document.getElementById('disbTransferDate');
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (monthInput && !monthInput.value) monthInput.value = ym;
  if (dateInput && !dateInput.value) dateInput.value = ymd;
}

// Reads the Payroll Cycle picker ("YYYY-MM") into the { monthRaw,
// year, monthName } shape the rest of the export pipeline expects.
function getPayrollCycle() {
  const raw = document.getElementById('disbPayrollMonth').value; // "YYYY-MM"
  const [year, monthRaw] = String(raw || '').split('-');
  const monthName = MONTHS[parseInt(monthRaw, 10) - 1] || '';
  return { monthRaw: monthRaw || '', year: year || '', monthName };
}

// Reads the Transfer Date picker ("YYYY-MM-DD") and reformats it to
// the DD/MM/YYYY convention every bank file / audit record uses.
function getTransferDateDDMMYYYY() {
  const raw = document.getElementById('disbTransferDate').value; // "YYYY-MM-DD"
  const [y, m, d] = String(raw || '').split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

// Validates a Payroll Run amount field using the same clean
// validation-style UI as the Account Number / IFSC confirmation
// fields elsewhere in the app (input-match / input-mismatch classes)
// instead of a separate red/green status dot.
function validateLiveAmountEntry(inputEl, warnEl) {
  const v = inputEl.value.trim();
  warnEl.textContent = '';
  inputEl.classList.remove('input-mismatch', 'input-match');
  if (!v) {
    updateBatchTotal();
    return;
  }
  // Only digits and at most one decimal point are allowed — mirrors the
  // desktop app's character-by-character format check.
  let ok = true, dots = 0;
  for (const ch of v) {
    if (ch === '.') { dots += 1; ok = dots <= 1; }
    else if (!/[0-9]/.test(ch)) { ok = false; }
    if (!ok) break;
  }
  if (!ok) {
    inputEl.classList.add('input-mismatch');
    warnEl.textContent = '⚠ INVALID FORMAT';
  } else {
    const val = parseFloat(v);
    if (!isNaN(val) && val > 0) {
      inputEl.classList.add('input-match');
    } else {
      inputEl.classList.add('input-mismatch');
      warnEl.textContent = '⚠ MUST BE > 0';
    }
  }
  updateBatchTotal();
}

// Shows/hides the SBI-style "Transfer Type" selector vs. the
// cross-bank "Prefer IMPS" toggle, and refreshes the bank badge —
// called whenever the company's bank changes.
function updateDisbursementModeUI() {
  const bankKey = companyProfile.bankName || 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  const isSbi = bankKey === 'SBI';

  const badge = document.getElementById('disbBankBadge');
  if (badge) badge.textContent = `BANK: ${bank.label}`;

  const subtitle = document.getElementById('disbSubtitle');
  if (subtitle) {
    const modeList = ['Same Bank', ...(bank.supportsRtgs ? ['RTGS'] : []), 'NEFT', ...(bank.supportsImps ? ['IMPS'] : [])].join(' / ');
    subtitle.textContent = isSbi
      ? 'Enter amounts and export the SBI bulk payment file.'
      : `Enter amounts and export the ${bank.label} bulk payment file. Mode (${modeList}) is auto-detected per beneficiary.`;
  }

  const ttWrap = document.getElementById('disbTransferTypeWrap');
  const impsWrap = document.getElementById('disbImpsWrap');
  if (ttWrap) ttWrap.classList.toggle('hidden', !isSbi);
  // PNB / HDFC / ICICI's bulk-file specs have no IMPS credit line at
  // all, so the toggle is only shown for banks that actually support it.
  const showImps = !isSbi && bank.supportsImps;
  if (impsWrap) impsWrap.classList.toggle('hidden', !showImps);
  if (!showImps) {
    const impsCheckbox = document.getElementById('disbUseImps');
    if (impsCheckbox) impsCheckbox.checked = false;
  }
}

// For the currently-selected bank, works out which employees belong in
// the batch and what transfer mode applies to each one.
//  - SBI: unchanged behaviour — filtered by the employee's own stored
//    Same Bank / Other Bank transferType.
//  - Every other bank: all employees are shown, and the mode is
//    computed live from IFSC + amount (+ the "Prefer IMPS" toggle).
function currentModeFor(ifsc, amount) {
  const bankKey = companyProfile.bankName || 'SBI';
  if (bankKey === 'SBI') return null;
  const preferImps = !!document.getElementById('disbUseImps')?.checked;
  return determineTransactionMode(bankKey, ifsc, amount, preferImps);
}

function renderDisbursementList() {
  const tbody = document.getElementById('disbTableBody');
  const emptyState = document.getElementById('disbEmptyState');
  if (!tbody) return;

  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const tft = document.getElementById('disbTransferType').value;
  const query = (document.getElementById('disbSearch').value || '').trim().toLowerCase();

  salaryInputs = {};
  tbody.innerHTML = '';

  const filtered = employees.filter(e =>
    (isSbi ? e.transferType === tft : true) &&
    (!query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query) || String(e.empCode).includes(query)));

  if (!filtered.length) { emptyState.classList.remove('hidden'); updateBatchTotal(); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    const prefill = (emp.lastAmount !== undefined && emp.lastAmount !== null) ? Number(emp.lastAmount).toFixed(2) : '';
    tr.innerHTML = `
      <td data-label="Emp Code">${escapeHtml(emp.empCode)}</td>
      <td data-label="Employee">${escapeHtml(emp.name)}</td>
      <td data-label="Account"><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td data-label="Mode"><span data-mode>${isSbi ? badgeForMode(tft === 'Same Bank' ? 'Same Bank' : (parseFloat(prefill) >= SBI_RTGS_THRESHOLD ? 'RTGS' : 'NEFT')) : badgeForMode('—')}</span></td>
      <td data-label="Amount (₹)" style="text-align:right;">
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px;">
          <span style="font-size:10px; color:var(--danger); font-weight:700;" data-warn></span>
          <input type="text" data-acc="${escapeHtml(emp.accountNumber)}" placeholder="0.00" value="${escapeHtml(prefill)}"
            title="${prefill ? 'Pre-filled from last export — review before sending' : ''}"
            style="width:120px; text-align:right; background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text); padding:6px 8px;">
        </div>
      </td>`;
    tbody.appendChild(tr);
    const inputEl = tr.querySelector('input');
    const warnEl  = tr.querySelector('[data-warn]');
    const modeEl  = tr.querySelector('[data-mode]');
    inputEl.addEventListener('input', () => {
      validateLiveAmountEntry(inputEl, warnEl);
      const v = parseFloat(inputEl.value);
      if (isSbi) {
        modeEl.innerHTML = badgeForMode(tft === 'Same Bank' ? 'Same Bank' : ((isNaN(v) ? 0 : v) >= SBI_RTGS_THRESHOLD ? 'RTGS' : 'NEFT'));
      } else {
        modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, isNaN(v) ? 0 : v));
      }
    });
    // Keyboard-driven bulk entry: Tab and Enter both jump straight to
    // the next row's amount field (skipping the "Show" account-reveal
    // button in between), so a payroll clerk can key through the whole
    // batch without reaching for the mouse. Shift+Tab / Shift+Enter
    // goes back a row.
    inputEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' && e.key !== 'Enter') return;
      e.preventDefault();
      const inputs = Array.from(tbody.querySelectorAll('input[data-acc]'));
      const idx = inputs.indexOf(inputEl);
      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
      const nextInput = inputs[nextIdx];
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    });
    const prefillAmt = parseFloat(prefill);
    if (!isSbi) modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, isNaN(prefillAmt) ? 0 : prefillAmt));
    if (prefill) validateLiveAmountEntry(inputEl, warnEl);
    salaryInputs[emp.accountNumber] = { inputEl, modeEl, name: emp.name, ifsc: emp.ifsc, empCode: emp.empCode };
  });
  wireMaskedAccountToggles(tbody);
  updateBatchTotal();
}

function updateBatchTotal() {
  let total = 0;
  Object.values(salaryInputs).forEach(md => {
    const v = parseFloat(md.inputEl.value);
    if (!isNaN(v)) total += v;
  });
  document.getElementById('disbTotal').textContent = `Batch Total: ₹ ${total.toFixed(2)}`;
}

function wireDisbursement() {
  document.getElementById('disbTransferType').addEventListener('change', renderDisbursementList);
  document.getElementById('disbSearch').addEventListener('input', renderDisbursementList);
  document.getElementById('disbUseImps').addEventListener('change', renderDisbursementList);
  document.getElementById('disbClearBtn').addEventListener('click', () => {
    document.querySelectorAll('#disbTableBody tr').forEach(tr => {
      const inputEl = tr.querySelector('input');
      const warnEl  = tr.querySelector('[data-warn]');
      if (inputEl) { inputEl.value = ''; inputEl.classList.remove('input-match', 'input-mismatch'); }
      if (warnEl)  warnEl.textContent = '';
    });
    updateBatchTotal();
  });
  document.getElementById('disbExportBtn').addEventListener('click', openExportPreview);
  document.getElementById('cancelExportBtn').addEventListener('click', () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
  });
  updateDisbursementModeUI();
  renderDisbursementList();
}

// SBI's own RTGS threshold (₹2,00,000) — same cutoff already used for
// every other bank via determineTransactionMode(). Kept as its own
// constant here since SBI's "Other Bank" split (see executeExport)
// needs it directly, without going through the IFSC-prefix check that
// determineTransactionMode also does — SBI's Same Bank / Other Bank
// split is driven by the employee's own stored transferType, not a
// live IFSC lookup, so re-deriving "sameness" from IFSC here would
// risk disagreeing with that and silently reclassifying a row.
const SBI_RTGS_THRESHOLD = 200000;

function collectBatchLines() {
  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const tft = document.getElementById('disbTransferType').value;
  const lines = [];
  let total = 0, hasInvalid = false;
  for (const [acc, md] of Object.entries(salaryInputs)) {
    const raw = md.inputEl.value.trim();
    if (!raw) continue;
    const v = parseFloat(raw);
    if (isNaN(v)) { hasInvalid = true; continue; }
    if (v <= 0) continue;
    total += v;
    // For SBI: "Same Bank" stays a single literal mode (unchanged —
    // still one file; see note above executeExport). "Other Bank" now
    // resolves to a real RTGS/NEFT mode per line instead of the coarse
    // tft literal, so the export step can split the file the way SBI's
    // instructions require. Every other bank is unchanged.
    let mode;
    if (isSbi) {
      mode = tft === 'Same Bank' ? 'Same Bank' : (v >= SBI_RTGS_THRESHOLD ? 'RTGS' : 'NEFT');
    } else {
      mode = currentModeFor(md.ifsc, v);
    }
    lines.push({ acc, empCode: md.empCode, name: md.name, ifsc: md.ifsc, amount: v, mode });
  }
  return { tft, lines, total, hasInvalid };
}

// The exported bank file's header row is built entirely from
// companyProfile fields — if any of these are still blank, the file
// would export "successfully" but contain an empty/broken debit
// account row, which the bank portal will reject. So export must be
// blocked (not just discouraged) until the Company Profile is saved.
function isCompanyProfileComplete() {
  const base = !!(companyProfile.name && companyProfile.accountNumber && companyProfile.ifsc && companyProfile.bankName);
  if (!base) return false;
  // Bank-specific requirements from the bulk-file spec — these matter
  // even for accounts that saved a company profile before these
  // fields existed, so export must catch it here too, not just at
  // Company Details save time.
  if (companyProfile.bankName === 'HDFC' && !/^[A-Z0-9]{4}$/.test(companyProfile.hdfcClientCode || '')) return false;
  if (companyProfile.bankName === 'ICICI' && !companyProfile.iciciCorporateId) return false;
  if (companyProfile.bankName === 'PNB' && String(companyProfile.accountNumber || '').length !== 16) return false;
  if (companyProfile.bankName === 'ICICI' && String(companyProfile.accountNumber || '').length !== 12) return false;
  return true;
}
// Company Details no longer has its own top-level nav tab (it lives
// under Settings), so jumping there just shows the page section
// directly and opens it in Edit mode, since the caller only does
// this when the profile still needs to be filled in.
function goToCompanyPage() {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('page-company').classList.remove('hidden');
  setCompanyEditMode(true);
}

// A basic IFSC format check — 4 letters, a fixed 0, then 6 alphanumerics.
// Not a substitute for verifying the branch actually exists, but it
// catches the obvious typo/paste-error case before the file goes out.
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function buildExportWarnings(isSbi, tft, lines) {
  const warnings = [];

  // Employees who are eligible for this batch (right transfer type, for
  // SBI) but were left with a blank/zero amount — flagged so a payday
  // omission isn't discovered only after the file's already gone out.
  const eligible = employees.filter(e => (isSbi ? e.transferType === tft : true));
  const includedAccounts = new Set(lines.map(l => l.acc));
  const skipped = eligible.filter(e => !includedAccounts.has(String(e.accountNumber)));
  if (skipped.length) {
    const names = skipped.slice(0, 5).map(e => e.name).join(', ');
    warnings.push(`${skipped.length} employee${skipped.length === 1 ? '' : 's'} eligible for this batch ${skipped.length === 1 ? 'has' : 'have'} no amount entered and will be skipped: ${names}${skipped.length > 5 ? ', ...' : ''}.`);
  }

  const badIfsc = lines.filter(l => !IFSC_RE.test(l.ifsc));
  if (badIfsc.length) {
    warnings.push(`${badIfsc.length} row(s) have an IFSC that doesn't match the standard format (4 letters + 0 + 6 characters): ${badIfsc.slice(0, 5).map(l => l.name).join(', ')}${badIfsc.length > 5 ? ', ...' : ''}.`);
  }

  // ICICI's within-bank (MCW) credit record requires an exactly
  // 12-digit numeric beneficiary account — anything else will fail
  // ICICI's own validation on upload.
  if ((companyProfile.bankName || 'SBI') === 'ICICI') {
    const badIcici = lines.filter(l => l.mode === 'Same Bank' && !/^[0-9]{12}$/.test(String(l.acc)));
    if (badIcici.length) {
      warnings.push(`${badIcici.length} within-ICICI beneficiary account(s) are not exactly 12 numeric digits, which ICICI's bulk file requires: ${badIcici.slice(0, 5).map(l => l.name).join(', ')}${badIcici.length > 5 ? ', ...' : ''}.`);
    }
  }

  // SBI's Intra Bank file (Same Bank export) must only ever contain
  // SBI accounts — SBI's own upload instructions say non-SBI accounts
  // must not be included in this file. Catches a mis-tagged employee
  // (transferType says "Same Bank" but their IFSC isn't actually SBI)
  // before it goes into a file meant only for SBI-to-SBI transfers.
  if (isSbi && tft === 'Same Bank') {
    const notSbi = lines.filter(l => !String(l.ifsc || '').toUpperCase().startsWith('SBIN'));
    if (notSbi.length) {
      warnings.push(`${notSbi.length} row(s) are marked "Same Bank" but their IFSC isn't an SBI (SBIN) IFSC — SBI's Intra Bank file must only contain SBI accounts: ${notSbi.slice(0, 5).map(l => l.name).join(', ')}${notSbi.length > 5 ? ', ...' : ''}.`);
    }
  }

  // Flags amounts far outside the batch's normal range — a common
  // symptom of a misplaced decimal or a pasted-in wrong figure.
  if (lines.length >= 3) {
    const amounts = lines.map(l => l.amount).sort((a, b) => a - b);
    const mid = amounts[Math.floor(amounts.length / 2)];
    const outliers = lines.filter(l => mid > 0 && (l.amount > mid * 5 || l.amount < mid / 5));
    if (outliers.length) {
      warnings.push(`${outliers.length} amount(s) look unusually far from the rest of this batch — double-check for a misplaced decimal: ${outliers.slice(0, 5).map(l => `${l.name} (₹${l.amount.toFixed(2)})`).join(', ')}${outliers.length > 5 ? ', ...' : ''}.`);
    }
  }

  return warnings;
}

async function openExportPreview() {
  if (!isCompanyProfileComplete()) {
    toast('Please complete Company Details before exporting — Company Name, Account Number, IFSC, Bank, and (for HDFC/ICICI/PNB) the bank-specific fields are all required.', 'error');
    goToCompanyPage();
    return;
  }
  const { tft, lines, total, hasInvalid } = collectBatchLines();
  if (hasInvalid) { toast('One or more amounts are in an invalid format. Please check and try again.', 'error'); return; }
  if (!lines.length) { toast('Please enter at least one salary amount before exporting.', 'error'); return; }

  const txnDate = getTransferDateDDMMYYYY();
  if (!txnDate) { toast('Please select a Transfer Date before exporting.', 'error'); return; }

  // Re-derive the company's branch code from its saved IFSC right
  // before the file is generated — purely local (no network lookup),
  // so it always matches whatever IFSC is currently saved.
  if (!isValidIfscFormat(companyProfile.ifsc)) {
    toast('Company IFSC looks invalid. Please re-check it in Company Details.', 'error');
    goToCompanyPage();
    return;
  }
  const freshSysId = branchCodeFromIfsc(companyProfile.ifsc);
  if (freshSysId !== companyProfile.sysId) {
    companyProfile = { ...companyProfile, sysId: freshSysId };
    await Api.updateCompanyProfile(companyProfile);
    renderCompanySummary();
  }

  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  const { monthName, year } = getPayrollCycle();

  const modeSummary = isSbi
    ? (tft === 'Other Bank'
        ? (() => {
            const counts = {};
            lines.forEach(l => { counts[l.mode] = (counts[l.mode] || 0) + 1; });
            const breakdown = Object.entries(counts).map(([m, c]) => `${escapeHtml(m)}: ${c}`).join(' &nbsp;•&nbsp; ');
            const fileCount = Object.keys(counts).length;
            return `<p><strong>Transfer Type:</strong> ${escapeHtml(tft)}</p>`
              + `<p><strong>Split:</strong> ${breakdown}</p>`
              + `<p style="font-size:12px; color:var(--muted, #888);">SBI requires NEFT and RTGS in separate files — this will download as ${fileCount} file${fileCount === 1 ? '' : 's'}.</p>`;
          })()
        : `<p><strong>Transfer Type:</strong> ${escapeHtml(tft)}</p>`
          + `<p style="font-size:12px; color:var(--muted, #888);">This is SBI's separate Intra Bank format — upload it via File Upload → Transactions → "Intra Bank Transfer" on SBI Net Banking, not the regular Beneficiary/NEFT-RTGS upload. Make sure each beneficiary is already added as a "Same Bank" third party there first.</p>`)
    : (() => {
        const counts = {};
        lines.forEach(l => { counts[l.mode] = (counts[l.mode] || 0) + 1; });
        const breakdown = Object.entries(counts).map(([m, c]) => `${escapeHtml(m)}: ${c}`).join(' &nbsp;•&nbsp; ');
        return `<p><strong>Bank:</strong> ${escapeHtml(bank.label)}</p><p><strong>Mode breakdown:</strong> ${breakdown}</p>`;
      })();

  // A last-look validation pass before the file is generated — catches
  // the kind of mistakes that would otherwise only surface after the
  // bank portal rejects the file (or worse, silently underpays someone).
  const warnings = buildExportWarnings(isSbi, tft, lines);
  const warningsHtml = warnings.length
    ? `<div style="margin-top:10px; padding:10px 12px; background:var(--danger-bg); border:1px solid var(--danger); border-radius:var(--radius-sm); color:var(--danger); font-size:12.5px; line-height:1.6;">
        ${warnings.map(w => `⚠ ${escapeHtml(w)}`).join('<br>')}
       </div>`
    : '';

  document.getElementById('exportPreviewBody').innerHTML = `
    ${modeSummary}
    <p><strong>Payroll Cycle:</strong> ${escapeHtml(monthName)} ${escapeHtml(year)}</p>
    <p><strong>Transfer Date:</strong> ${escapeHtml(txnDate)}</p>
    <p><strong>Employees:</strong> ${lines.length}</p>
    <p style="font-size:20px; color:var(--success); font-weight:700; margin-top:10px;">₹ ${total.toFixed(2)}</p>
    <p style="margin-top:10px;">This export costs <strong>${EXPORT_COST_CREDITS} credits</strong> · Wallet balance: <strong id="exportPreviewWalletBalance">${walletBalance}</strong> credits</p>
    <p style="margin-top:4px; font-size:12px; color:var(--muted, #888);">Exporting often? <a href="#" id="exportPreviewWalletLink">Recharge in bulk from Wallet</a> and save up to ${MAX_PACK_DISCOUNT_PCT}% per credit.</p>
    ${warningsHtml}
  `;
  document.getElementById('exportPreviewModal').classList.remove('hidden');

  const walletLink = document.getElementById('exportPreviewWalletLink');
  if (walletLink) {
    walletLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('exportPreviewModal').classList.add('hidden');
      showAppPage('wallet');
    });
  }

  const cancelBtn = document.getElementById('cancelExportBtn');
  const walletBtn = document.getElementById('payWalletExportBtn');
  const razorpayBtn = document.getElementById('payRazorpayExportBtn');

  const walletBtnLabel = '💳 Pay via Wallet';
  const razorpayBtnLabel = `🔒 Pay ₹${EXPORT_RAZORPAY_PACK.priceRupees} via Razorpay`;

  // Both payment buttons share one busy-state so a click on either one
  // locks out the other (and Cancel) until it resolves — prevents a
  // double-submit racing two exports off the same click.
  let busy = false;
  const setBusy = (isBusy) => {
    busy = isBusy;
    walletBtn.disabled = isBusy;
    razorpayBtn.disabled = isBusy;
    cancelBtn.disabled = isBusy;
    if (!isBusy) {
      walletBtn.textContent = walletBtnLabel;
      razorpayBtn.textContent = razorpayBtnLabel;
    }
  };
  setBusy(false);

  const finishExport = async () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
    await executeExport();
  };

  // Option 1: pay straight from the wallet balance. Single check —
  // if it's short, this does NOT fall back to Razorpay on its own;
  // it just reports the failure so the user can pick the other option.
  walletBtn.onclick = async () => {
    if (busy) return;
    setBusy(true);
    walletBtn.textContent = 'Checking wallet...';
    try {
      const res = await callBillingFunction('consume-credits');
      if (res.ok && res.data.allowed) {
        setWalletBalance(res.data.creditsRemaining);
        walletBtn.textContent = 'Exporting...';
        await finishExport();
        return;
      }
      if (res.status === 402) {
        setWalletBalance(res.data.creditsRemaining);
        const bal = document.getElementById('exportPreviewWalletBalance');
        if (bal) bal.textContent = res.data.creditsRemaining;
        toast(`Payment failed — insufficient wallet balance. You have ${res.data.creditsRemaining} credit${res.data.creditsRemaining === 1 ? '' : 's'}, need ${res.data.creditsNeeded} more. Try "Pay via Razorpay" to top up instead.`, 'error');
      } else {
        toast((res.data && res.data.error) || 'Could not verify export eligibility. Please try again.', 'error');
      }
    } catch (e) {
      toast('Something went wrong: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Option 2: charge straight through Razorpay for exactly this export's
  // credits (flat ₹50 at current pricing) — no pack picker. Bigger,
  // discounted packs are only ever offered from the Wallet page.
  razorpayBtn.onclick = async () => {
    if (busy) return;
    setBusy(true);
    razorpayBtn.textContent = 'Opening payment...';
    try {
      const bought = await buyCreditPack(EXPORT_RAZORPAY_PACK, 'export');
      if (!bought) return;

      const res = await callBillingFunction('consume-credits');
      if (res.ok && res.data.allowed) {
        setWalletBalance(res.data.creditsRemaining);
        razorpayBtn.textContent = 'Exporting...';
        await finishExport();
        return;
      }
      toast('Payment succeeded but the credits could not be applied. Please try exporting again — you will not be charged twice.', 'error');
    } catch (e) {
      toast('Something went wrong: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      setBusy(false);
    }
  };
}

// Refactored executeExport(): resolves the company's bank, delegates
// file-content generation to that bank's BankFormatters strategy, and
// keeps the existing batch counter / disbursement history / audit
// logging behaviour unchanged for every bank.
// Works out the batch-ID prefix. For SBI Same Bank / non-SBI banks
// this is unchanged. For every other bank the SBI-only selector is
// hidden and not meaningful, so instead we look at the actual per-row
// modes in this batch: NEFT/RTGS/IMPS map directly (they're already 4
// letters), a batch that's 100% Same Bank gets SBST, and a batch
// mixing more than one mode gets MULT — so the batch ID always
// reflects what's really inside that file.
function getBatchPrefix(isSbi, tft, lines) {
  if (isSbi) return tft === 'Same Bank' ? 'SBST' : 'OBST';
  const modes = new Set(lines.map(l => l.mode));
  if (modes.size === 1) {
    const only = [...modes][0];
    return only === 'Same Bank' ? 'SBST' : only.toUpperCase().padEnd(4, 'X').slice(0, 4);
  }
  return 'MULT';
}

// Splits collectBatchLines()'s output into one or more sub-batches to
// actually export. Every bank except SBI's "Other Bank" case still
// gets exactly one sub-batch (unchanged behaviour). SBI's "Other Bank"
// batch is split into a NEFT sub-batch and an RTGS sub-batch — SBI's
// own upload instructions say these must be fed as separate files, and
// collectBatchLines() already tagged each line with its real RTGS/NEFT
// mode for exactly this purpose. An empty sub-batch (e.g. every line
// this run happens to be NEFT) is simply omitted rather than
// downloading an empty RTGS file.
// "Same Bank" isn't split (it's one file, same as before) but is
// labeled 'INTRA' so its filename/audit entry clearly marks it as the
// separate Bulk Intra Bank upload — see BankFormatters.SBI_INTRA.
function splitIntoSubBatches(isSbi, tft, lines) {
  if (isSbi && tft === 'Other Bank') {
    const rtgsLines = lines.filter(l => l.mode === 'RTGS');
    const neftLines = lines.filter(l => l.mode === 'NEFT');
    const subBatches = [];
    if (rtgsLines.length) subBatches.push({ prefix: 'OBRT', label: 'RTGS', lines: rtgsLines });
    if (neftLines.length) subBatches.push({ prefix: 'OBNE', label: 'NEFT', lines: neftLines });
    return subBatches;
  }
  const label = (isSbi && tft === 'Same Bank') ? 'INTRA' : null;
  return [{ prefix: getBatchPrefix(isSbi, tft, lines), label, lines }];
}

async function executeExport() {
  const { tft, lines } = collectBatchLines();
  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  // SBI has two distinct bulk-file formats depending on transfer type —
  // "Same Bank" uses the separate Intra Bank format (own beneficiary
  // branch codes, trailing '#'), everything else uses the normal
  // Inter-Bank format. See both formatters' comments above for why.
  const formatter = (isSbi && tft === 'Same Bank')
    ? BankFormatters.SBI_INTRA
    : (BankFormatters[bankKey] || BankFormatters.SBI);

  const { monthRaw, monthName, year } = getPayrollCycle();
  const shortYear = year.slice(2);
  const txnDate = getTransferDateDDMMYYYY();
  if (!txnDate) { toast('Please select a Transfer Date before exporting.', 'error'); return; }

  const subBatches = splitIntoSubBatches(isSbi, tft, lines);

  // One credit charge already covers this whole export click (handled
  // by the caller before executeExport() runs) — splitting SBI's
  // "Other Bank" batch into two files here is purely a file-format fix,
  // not two billable exports, so credits are not touched per sub-batch.
  for (const sub of subBatches) {
    const subTotal = sub.lines.reduce((s, l) => s + l.amount, 0);

    let seq;
    try {
      seq = await Api.getAndIncrementCounter();
    } catch (err) {
      // Credits were already deducted (consume-credits ran before
      // executeExport was ever called) — this failure happens after
      // that, so the user is left short of credits with no file. There
      // is no automatic refund path today, so at least be explicit
      // about it here instead of a generic error, and point at Help &
      // Support so it can be corrected manually.
      toast('Could not generate batch number, so no file was created — your credits were already deducted for this export. Please use Help & Support so we can restore them.', 'error');
      return;
    }
    const batchId = `${sub.prefix}${shortYear}${monthRaw}${seq}`;
    // Most banks are happy with a free-text filename; HDFC's portal
    // enforces a strict "ABCDDDMM.001" convention, so its formatter
    // supplies its own fileName() instead of using the generic pattern.
    // For a split SBI batch, the sub-batch label (RTGS/NEFT) is folded
    // into the filename so the two downloads are never confused with
    // each other.
    const fileName = typeof formatter.fileName === 'function'
      ? formatter.fileName({ companyProfile, txnDate, seq })
      : `${bankKey.toLowerCase()}_salary_${monthName}_${year}${sub.label ? '_' + sub.label.toLowerCase() : ''}.${formatter.ext}`;

    // Every row carries a full snapshot of the company profile and payroll
    // cycle as they were AT THE TIME of this export — not just the
    // employee/amount fields. Without this, re-downloading an old batch
    // later would silently use today's company profile (which may have
    // since changed bank, account, or IFSC) instead of what was actually
    // used to generate that file originally.
    const logRows = sub.lines.map(({ acc, empCode, name, ifsc, amount, mode }) => ({
      batchId, transferDate: txnDate, empCode, employeeName: name, accountNumber: acc, ifsc,
      amount: amount.toFixed(2), transferType: mode, bank: bankKey,
      monthName, year, monthRaw, shortYear, fileName,
      companySnapshot: {
        name: companyProfile.name, accountNumber: companyProfile.accountNumber,
        ifsc: companyProfile.ifsc, sysId: companyProfile.sysId, bankName: bankKey
      }
    }));

    const output = formatter.generate({
      companyProfile, lines: sub.lines, total: subTotal, batchId, txnDate, monthRaw, shortYear, monthName, year, tft
    });

    downloadTextFile(fileName, output, formatter.mime);

    try {
      await Api.addDisbursementRows(logRows);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'EXPORT FILE',
        `Batch: ${batchId} | Bank: ${bank.label}${sub.label ? ' (' + sub.label + ')' : ''} | Total: ₹${subTotal.toFixed(2)} | Employees: ${sub.lines.length} | File: ${fileName}`);
      // Remembers what each employee was paid in this batch, so next
      // cycle's Disbursement page can pre-fill the same amount instead of
      // starting blank — most salaries don't change month to month.
      await Api.updateEmployeeLastAmounts(
        sub.lines.map(l => ({ accountNumber: l.acc, amount: l.amount }))
      );
    } catch (err) {
      toast(`${fileName} downloaded, but logging to the ledger failed: ` + err.message, 'error');
    }
  }

  renderEmployeeKpis();
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let auditRows = [];
let auditSort = { key: null, dir: 1 }; // null = natural (Firestore) order: newest first

function wireAudit() {
  document.getElementById('auditSearch').addEventListener('input', renderAuditTable);
  document.getElementById('auditActionFilter').addEventListener('change', renderAuditTable);
  document.getElementById('auditFromDate').addEventListener('change', renderAuditTable);
  document.getElementById('auditToDate').addEventListener('change', renderAuditTable);
  document.getElementById('auditClearFiltersBtn').addEventListener('click', () => {
    document.getElementById('auditSearch').value = '';
    document.getElementById('auditActionFilter').value = '';
    document.getElementById('auditFromDate').value = '';
    document.getElementById('auditToDate').value = '';
    renderAuditTable();
  });
  document.querySelectorAll('#page-audit th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.auditSort;
      if (auditSort.key === key) auditSort.dir *= -1;
      else auditSort = { key, dir: 1 };
      renderAuditTable();
    });
  });
}
async function loadAuditTrail() {
  renderSkeletonRows(document.getElementById('auditTableBody'), 4, 5);
  try {
    auditRows = await Api.getAuditTrail();
  } catch (err) {
    document.getElementById('auditTableBody').innerHTML = `<tr><td colspan="4" style="color:var(--danger);">${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  renderAuditTable();
}
function updateAuditSortHeaders() {
  document.querySelectorAll('#page-audit th.sortable').forEach(th => {
    const active = th.dataset.auditSort === auditSort.key;
    th.classList.toggle('sort-active', active);
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active && auditSort.dir === -1 ? '▼' : '▲';
  });
}
function renderAuditTable() {
  const tbody = document.getElementById('auditTableBody');
  const emptyState = document.getElementById('auditEmptyState');
  const query = (document.getElementById('auditSearch').value || '').trim().toLowerCase();
  const actionFilter = document.getElementById('auditActionFilter').value;
  const fromVal = document.getElementById('auditFromDate').value; // "YYYY-MM-DD"
  const toVal = document.getElementById('auditToDate').value;     // "YYYY-MM-DD"
  // "To" is inclusive of the whole day, so compare against the start
  // of the following day rather than midnight of the same day.
  const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const toDate = toVal ? new Date(toVal + 'T23:59:59.999') : null;

  let filtered = auditRows.filter(r => {
    if (query &&
      !(r.userEmail||'').toLowerCase().includes(query) &&
      !(r.action||'').toLowerCase().includes(query) &&
      !(r.details||'').toLowerCase().includes(query)) return false;
    if (actionFilter && r.action !== actionFilter) return false;
    if (fromDate || toDate) {
      const ts = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null;
      if (!ts) return false;
      if (fromDate && ts < fromDate) return false;
      if (toDate && ts > toDate) return false;
    }
    return true;
  });

  if (auditSort.key) {
    const dir = auditSort.dir;
    filtered = [...filtered].sort((a, b) => {
      if (auditSort.key === 'timestamp') {
        const ta = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate().getTime() : 0;
        const tb = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate().getTime() : 0;
        return dir * (ta - tb);
      }
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      return dir * collator.compare(String(a[auditSort.key] ?? ''), String(b[auditSort.key] ?? ''));
    });
  }
  updateAuditSortHeaders();

  tbody.innerHTML = '';
  if (!filtered.length) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(r => {
    const ts = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate().toLocaleString() : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td data-label="Timestamp">${escapeHtml(ts)}</td><td data-label="User">${escapeHtml(r.userName || r.userEmail)}</td><td data-label="Action">${escapeHtml(r.action)}</td><td data-label="Details">${escapeHtml(r.details || '')}</td>`;
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------
// EXPORT HISTORY — groups the flat disbursement-row log back into
// per-batch summaries, and lets a batch be regenerated and
// re-downloaded using the exact company/IFSC snapshot from the time
// it was originally exported (not today's settings).
// ---------------------------------------------------------
let exportBatches = [];

async function loadExportHistory() {
  const tbody = document.getElementById('exportsTableBody');
  renderSkeletonRows(tbody, 6, 4);
  let rows = [];
  try {
    rows = await Api.getDisbursementHistory();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Could not load export history: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }

  const byBatch = new Map();
  rows.forEach(r => {
    if (!byBatch.has(r.batchId)) {
      byBatch.set(r.batchId, {
        batchId: r.batchId, bank: r.bank, transferDate: r.transferDate,
        monthName: r.monthName, year: r.year, fileName: r.fileName,
        companySnapshot: r.companySnapshot, createdAt: r.createdAt,
        rows: []
      });
    }
    byBatch.get(r.batchId).rows.push(r);
  });
  exportBatches = [...byBatch.values()].sort((a, b) => {
    const ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
    const tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
    return tb - ta;
  });
  renderExportHistory();
}

function renderExportHistory() {
  const tbody = document.getElementById('exportsTableBody');
  const emptyState = document.getElementById('exportsEmptyState');
  const query = (document.getElementById('exportsSearch').value || '').trim().toLowerCase();

  const filtered = exportBatches.filter(b =>
    !query || b.batchId.toLowerCase().includes(query) || (b.bank || '').toLowerCase().includes(query));

  tbody.innerHTML = '';
  if (!filtered.length) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(batch => {
    const total = batch.rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    const bank = BANK_BY_KEY[batch.bank] || { label: batch.bank };
    const tr = document.createElement('tr');
    tr.className = 'export-batch-row';
    tr.innerHTML = `
      <td data-label="Batch ID" style="font-family:var(--font-mono);"><button type="button" class="row-expand-toggle" data-expand="${escapeHtml(batch.batchId)}" aria-label="Show employee-wise breakdown"><span class="row-expand-arrow">›</span> ${escapeHtml(batch.batchId)}</button></td>
      <td data-label="Bank">${escapeHtml(bank.label)}</td>
      <td data-label="Transfer Date">${escapeHtml(batch.transferDate || '—')}</td>
      <td data-label="Employees">${batch.rows.length}</td>
      <td data-label="Total (₹)" style="text-align:right;">₹${total.toFixed(2)}</td>
      <td class="row-actions"><button data-redownload="${escapeHtml(batch.batchId)}">Re-download</button></td>`;
    tbody.appendChild(tr);

    // Hidden-by-default detail row: employee-wise amount breakdown for
    // this batch, so you can see exactly who was paid how much in a
    // given export without re-downloading and opening the file.
    const detailTr = document.createElement('tr');
    detailTr.className = 'export-batch-detail hidden';
    detailTr.dataset.detailFor = batch.batchId;
    const rowsSorted = [...batch.rows].sort((a, b) =>
      (a.employeeName || '').localeCompare(b.employeeName || ''));
    const detailRows = rowsSorted.map(r => `
      <tr>
        <td data-label="Emp Code" style="color:var(--text2); font-family:var(--font-mono); font-size:12px;">${escapeHtml(r.empCode || '—')}</td>
        <td data-label="Employee">${escapeHtml(r.employeeName || '—')}</td>
        <td data-label="Account" style="font-family:var(--font-mono); font-size:12.5px; color:var(--text2);">${escapeHtml(maskAccount(r.accountNumber))}</td>
        <td data-label="Mode">${badgeForMode(r.transferType)}</td>
        <td data-label="Amount (₹)" style="text-align:right; font-weight:600;">₹${(parseFloat(r.amount) || 0).toFixed(2)}</td>
      </tr>`).join('');
    detailTr.innerHTML = `
      <td colspan="6" class="card-cell-plain export-detail-cell" style="padding:0;">
        <div class="export-batch-breakdown">
          <div class="export-batch-breakdown__head">Employee-wise breakdown — ${batch.rows.length} employee(s), ₹${total.toFixed(2)} total</div>
          <table class="export-batch-breakdown__table">
            <thead><tr><th>Emp Code</th><th>Employee</th><th>Account</th><th>Mode</th><th style="text-align:right;">Amount (₹)</th></tr></thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>
      </td>`;
    tbody.appendChild(detailTr);
  });

  tbody.querySelectorAll('[data-redownload]').forEach(btn =>
    btn.onclick = () => redownloadBatch(btn.dataset.redownload));

  tbody.querySelectorAll('[data-expand]').forEach(btn =>
    btn.onclick = () => {
      const id = btn.dataset.expand;
      const detailRow = tbody.querySelector(`.export-batch-detail[data-detail-for="${CSS.escape(id)}"]`);
      if (!detailRow) return;
      const willOpen = detailRow.classList.contains('hidden');
      detailRow.classList.toggle('hidden');
      btn.closest('tr').classList.toggle('is-expanded', willOpen);
    });
}

function redownloadBatch(batchId) {
  const batch = exportBatches.find(b => b.batchId === batchId);
  if (!batch) return;
  // SBI has two distinct bulk-file formats depending on transfer type
  // (see executeExport/BankFormatters.SBI_INTRA above) — a batch whose
  // rows were originally exported as "Same Bank" MUST be regenerated
  // with the same SBI_INTRA (branch code, trailing '#') formatter, not
  // the plain Inter-Bank one, or the re-downloaded file silently comes
  // out in the wrong format (IFSC instead of branch code, no trailing
  // '#') and can be misread/rejected by SBI's Intra Bank upload parser.
  // batch.bank is always the plain bank key ('SBI'), so the Same Bank
  // case has to be detected from the stored rows' own transferType.
  const isSbiSameBank = batch.bank === 'SBI' && batch.rows.every(r => r.transferType === 'Same Bank');
  const formatter = isSbiSameBank
    ? BankFormatters.SBI_INTRA
    : (BankFormatters[batch.bank] || BankFormatters.SBI);
  const snapshotProfile = batch.companySnapshot || companyProfile;

  const lines = batch.rows.map(r => ({
    acc: r.accountNumber, empCode: r.empCode, name: r.employeeName,
    ifsc: r.ifsc, amount: parseFloat(r.amount), mode: r.transferType
  }));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  // monthRaw/shortYear weren't always stored on older rows — derive
  // them from the batch ID itself as a fallback (format is fixed:
  // 4-char prefix + 2-digit year + 2-digit month + 4-char sequence).
  const shortYear = batch.year ? String(batch.year).slice(2) : batchId.slice(4, 6);
  const monthRaw = batch.monthRaw || batchId.slice(6, 8);
  const monthName = batch.monthName || MONTHS[parseInt(monthRaw, 10) - 1] || '';

  const output = formatter.generate({
    companyProfile: snapshotProfile, lines, total, batchId,
    txnDate: batch.transferDate, monthRaw, shortYear, monthName,
    year: batch.year || `20${shortYear}`, tft: isSbiSameBank ? 'Same Bank' : 'Other Bank'
  });

  const fileName = batch.fileName || `${(batch.bank || 'sbi').toLowerCase()}_salary_${monthName}_${batch.year || ''}.${formatter.ext}`;
  downloadTextFile(fileName, output, formatter.mime);
  toast(`Re-downloaded ${batchId}.`, 'success');
}

function wireExportHistory() {
  document.getElementById('exportsSearch').addEventListener('input', renderExportHistory);
}

async function loadCompanyProfile() {
  try {
    const p = await Api.getCompanyProfile();
    companyProfile = { ...companyProfile, ...p };
    document.getElementById('companyNameInput').value = p.name || '';
    document.getElementById('companyAccInput').value = p.accountNumber || '';
    document.getElementById('companyAccConfirmInput').value = p.accountNumber || '';
    document.getElementById('companyIfscInput').value = p.ifsc || '';
    setSelectedCompanyBank(p.bankName || 'SBI');
  } catch (err) {
    console.error(err);
  }
  renderCompanySummary();
  updateDisbursementModeUI();
}

// Renders the 4-line read-only Company Details summary (Company Name,
// Bank Name, Account Number, IFSC). This is the default view — the
// full double-entry edit fields only appear after clicking Edit.
function renderCompanySummary() {
  const bank = BANK_BY_KEY[companyProfile.bankName || 'SBI'] || BANK_BY_KEY.SBI;
  const nameEl = document.getElementById('coSummaryName');
  if (!nameEl) return; // Company page not present yet
  nameEl.textContent = companyProfile.name || '—';
  document.getElementById('coSummaryBank').textContent = bank.label;
  document.getElementById('coSummaryAcc').textContent = companyProfile.accountNumber ? maskAccount(companyProfile.accountNumber) : '—';
  document.getElementById('coSummaryIfsc').textContent = companyProfile.ifsc || '—';
}

function setCompanyEditMode(editing) {
  document.getElementById('companyReadOnlyView').classList.toggle('hidden', editing);
  document.getElementById('companyEditView').classList.toggle('hidden', !editing);
  if (editing) {
    // Re-sync the edit fields with the last-saved profile every time
    // Edit is opened, so a Cancel afterwards can't leave stale input.
    document.getElementById('companyNameInput').value = companyProfile.name || '';
    document.getElementById('companyAccInput').value = companyProfile.accountNumber || '';
    document.getElementById('companyAccConfirmInput').value = companyProfile.accountNumber || '';
    document.getElementById('companyIfscInput').value = companyProfile.ifsc || '';
    document.getElementById('companyIfscPreview').textContent = '';
    const hdfcInput = document.getElementById('companyHdfcClientCodeInput');
    const iciciInput = document.getElementById('companyIciciCorporateIdInput');
    if (hdfcInput) hdfcInput.value = companyProfile.hdfcClientCode || '';
    if (iciciInput) iciciInput.value = companyProfile.iciciCorporateId || '';
    setSelectedCompanyBank(companyProfile.bankName || 'SBI');
  }
}

// ---------------------------------------------------------
// COMPANY IFSC
// The user types their full 11-character IFSC directly (no external
// lookup). We validate its format locally and pull out the 6-character
// branch code from it — everything after the 4-letter bank code and
// the reserved '0' that always follows it, e.g. SBIN0001234 -> "001234"
// — which is what the bank file formats actually need (see
// BankFormatters.SBI, which writes this branch code into the file).
// ---------------------------------------------------------
function isValidIfscFormat(ifsc) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc || '').trim().toUpperCase());
}
function branchCodeFromIfsc(ifsc) {
  return String(ifsc || '').trim().toUpperCase().slice(5);
}

function wireCompanyForm() {
  wireCompanyBankButtons();

  const accInput        = document.getElementById('companyAccInput');
  const accConfirmInput = document.getElementById('companyAccConfirmInput');
  const accMismatchLbl  = document.getElementById('companyAccMismatchLbl');
  const ifscInput       = document.getElementById('companyIfscInput');
  const ifscPreviewEl   = document.getElementById('companyIfscPreview');
  const saveBtn         = document.getElementById('saveCompanyBtn');

  // Account Number: no spaces, no pasting — blocking paste is what
  // makes "type it twice" actually catch typos.
  [accInput, accConfirmInput].forEach(el => {
    blockSpaceKey(el);
    blockPasteAndRightClick(el);
    digitsOnlyLive(el);
  });

  // Live double-entry check — mirrors the Employee form's Account
  // Number confirmation, so a mistyped digit is caught immediately
  // instead of silently corrupting every export's debit account.
  function checkPair(primeEl, confEl, lbl) {
    const prime = primeEl.value.trim();
    const conf = confEl.value.trim();
    confEl.classList.remove('input-mismatch', 'input-match');
    if (!conf) { lbl.textContent = ''; return; }
    if (prime !== conf) {
      confEl.classList.add('input-mismatch');
      lbl.textContent = 'MISMATCH';
    } else {
      confEl.classList.add('input-match');
      lbl.textContent = '';
    }
  }
  [accInput, accConfirmInput].forEach(el => el.addEventListener('input', () => checkPair(accInput, accConfirmInput, accMismatchLbl)));

  const infoBtn = document.getElementById('sysCodeInfoBtn');
  const infoText = document.getElementById('sysCodeInfoText');
  infoBtn.addEventListener('click', () => {
    infoText.classList.toggle('hidden');
    infoBtn.classList.toggle('is-open');
  });

  // Live preview of the 6-digit branch code as the user types their
  // full IFSC, so they can see exactly what will land in the file.
  // Also checks the IFSC's 4-letter bank code against whichever bank
  // is currently selected above — every Indian bank's IFSC is 11
  // characters (4 letters + reserved '0' + 6-char branch code), so the
  // length check never changes per bank, but the leading 4 letters
  // must match the selected bank or the file would silently claim the
  // wrong bank/mode for every beneficiary.
  function refreshIfscPreview() {
    const raw = ifscInput.value.trim().toUpperCase();
    ifscInput.value = raw;
    if (raw.length < 11) { ifscPreviewEl.textContent = ''; ifscPreviewEl.classList.remove('field-mismatch'); return; }
    if (!isValidIfscFormat(raw)) {
      ifscPreviewEl.textContent = 'That doesn\'t look like a valid IFSC — check the format (e.g. SBIN0001234).';
      ifscPreviewEl.classList.add('field-mismatch');
      return;
    }
    const bank = BANK_BY_KEY[selectedCompanyBankKey];
    if (bank && bank.ifscPrefix && !raw.startsWith(bank.ifscPrefix)) {
      ifscPreviewEl.textContent = `This doesn't look like a ${bank.label} IFSC — expected it to start with "${bank.ifscPrefix}". Re-check the code or change the selected bank above.`;
      ifscPreviewEl.classList.add('field-mismatch');
      return;
    }
    ifscPreviewEl.classList.remove('field-mismatch');
    ifscPreviewEl.textContent = `Branch code for the file: ${branchCodeFromIfsc(raw)}`;
  }
  ifscInput.addEventListener('input', refreshIfscPreview);
  // Re-validate the IFSC against the newly-selected bank immediately,
  // instead of waiting for Save to catch a now-mismatched prefix.
  document.querySelectorAll('#companyBankGroup .bank-select-btn').forEach(btn => {
    btn.addEventListener('click', refreshIfscPreview);
  });

  document.getElementById('editCompanyBtn').addEventListener('click', () => setCompanyEditMode(true));
  document.getElementById('cancelCompanyEditBtn').addEventListener('click', () => setCompanyEditMode(false));

  saveBtn.addEventListener('click', async () => {
    const name = document.getElementById('companyNameInput').value.trim().toUpperCase();
    const accountNumber = accInput.value.trim();
    const accountNumberConfirm = accConfirmInput.value.trim();
    const ifsc = ifscInput.value.trim().toUpperCase();
    const bankName = selectedCompanyBankKey;
    const hdfcClientCode = (document.getElementById('companyHdfcClientCodeInput')?.value || '').trim().toUpperCase();
    const iciciCorporateId = (document.getElementById('companyIciciCorporateIdInput')?.value || '').trim().toUpperCase();
    if (!name || !accountNumber || !accountNumberConfirm || !ifsc || !bankName) {
      toast('Please fill all fields.', 'error'); return;
    }
    if (!/^[0-9]+$/.test(accountNumber) || !/^[0-9]+$/.test(accountNumberConfirm)) {
      toast('Company Account Number must contain numbers only.', 'error');
      return;
    }
    if (accountNumber !== accountNumberConfirm) {
      toast('Company Account Number and its confirmation do not match.', 'error');
      return;
    }
    if (!isValidIfscFormat(ifsc)) {
      toast('Please enter a valid 11-character IFSC code, e.g. SBIN0001234.', 'error');
      return;
    }
    const bank = BANK_BY_KEY[bankName];
    if (bank.ifscPrefix && !ifsc.startsWith(bank.ifscPrefix)) {
      toast(`This IFSC doesn't look like a ${bank.label} code (expected it to start with "${bank.ifscPrefix}"). Check the code or select the matching bank.`, 'error');
      return;
    }
    // PNB's bulk file needs a 16-digit debit account per spec.
    if (bankName === 'PNB' && accountNumber.length !== 16) {
      toast('PNB requires a 16-digit Company Account Number for the bulk payment file. Please re-check your account number.', 'error');
      return;
    }
    // ICICI's bulk file needs an exactly 12-digit numeric debit account.
    if (bankName === 'ICICI' && accountNumber.length !== 12) {
      toast('ICICI requires an exactly 12-digit Company Account Number for the bulk payment file. Please re-check your account number.', 'error');
      return;
    }
    // HDFC's filename convention needs exactly a 4-character client code.
    if (bankName === 'HDFC' && !/^[A-Z0-9]{4}$/.test(hdfcClientCode)) {
      toast('Please enter your 4-character HDFC Corporate Client Code — HDFC assigns this, and it is required to build the correct filename for upload.', 'error');
      return;
    }
    // ICICI's Master Debit Record needs the Corporate Login ID.
    if (bankName === 'ICICI' && !iciciCorporateId) {
      toast('Please enter your ICICI Corporate Login ID — it is required on every export\'s Master Debit Record.', 'error');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const sysId = branchCodeFromIfsc(ifsc);
      ifscPreviewEl.textContent = `Branch code for the file: ${sysId}`;
      await Api.updateCompanyProfile({ name, accountNumber, ifsc, sysId, bankName, hdfcClientCode, iciciCorporateId });
      companyProfile = { ...companyProfile, name, accountNumber, ifsc, sysId, bankName, hdfcClientCode, iciciCorporateId };
      await Api.logAudit(currentUser.email, currentUser.displayName, 'UPDATE COMPANY', `${name} | Acc: ${accountNumber} | IFSC: ${ifsc} | Bank: ${bankName}`);
      renderCompanySummary();
      updateDisbursementModeUI();
      renderDisbursementList();
      renderEmployeeKpis();
      setCompanyEditMode(false);
      toast('Company profile updated.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Company Profile';
    }
  });
}

// ---------------------------------------------------------
// 10b. SETTINGS PAGE
// Lets a signed-in user change their email/password from inside
// the dashboard. Both the email and password forms re-authenticate
// with the CURRENT password first — Firebase requires this
// ("recent login") for sensitive account changes, and it also means
// someone who merely stole a logged-in session can't silently take
// over the account.
// ---------------------------------------------------------
function settingsMsg(boxId, text, isError) {
  const box = document.getElementById(boxId);
  box.textContent = text;
  box.className = isError ? 'error-msg show' : 'success-msg show';
  box.style.marginBottom = '16px';
}
function clearSettingsMsg(boxId) {
  const box = document.getElementById(boxId);
  box.textContent = '';
  box.className = '';
}

async function reauthenticate(password) {
  const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, password);
  await auth.currentUser.reauthenticateWithCredential(cred);
}

// ---- Settings list → modal open/close ----
function openSettingsModal(modalId, formId, msgBoxId) {
  clearSettingsMsg(msgBoxId);
  document.getElementById(formId).reset();
  document.getElementById(modalId).classList.remove('hidden');
}
function closeSettingsModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function wireSettingsForms() {
  wireThemeToggle();

  document.getElementById('openChangeEmailBtn').addEventListener('click', () =>
    openSettingsModal('changeEmailModal', 'changeEmailForm', 'settingsEmailMsg'));
  document.getElementById('cancelChangeEmailBtn').addEventListener('click', () =>
    closeSettingsModal('changeEmailModal'));

  document.getElementById('openChangePasswordBtn').addEventListener('click', () =>
    openSettingsModal('changePasswordModal', 'changePasswordForm', 'settingsPasswordMsg'));
  document.getElementById('cancelChangePasswordBtn').addEventListener('click', () =>
    closeSettingsModal('changePasswordModal'));

  document.getElementById('openEditCompanyBtn').addEventListener('click', () => {
    showAppPage('company');
    setCompanyEditMode(false);
  });

  document.getElementById('openAboutBtn').addEventListener('click', () => {
    document.getElementById('aboutModal').classList.remove('hidden');
  });

  // "Add to Home Screen" is wired once, in wirePwaGuideModal() (boot
  // sequence, runs before login) — not here, so it isn't double-bound
  // and so the same install-or-guide logic covers both entry points.

  // ---- Change email ----
  document.getElementById('changeEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearSettingsMsg('settingsEmailMsg');
    const btn = document.getElementById('changeEmailBtn');
    const currentPassword = document.getElementById('emailChangeCurrentPassword').value;
    const newEmail = document.getElementById('newEmailInput').value.trim();
    btn.disabled = true; btn.textContent = 'Updating...';
    try {
      await reauthenticate(currentPassword);
      // verifyBeforeUpdateEmail sends a confirmation link to the NEW
      // address and only swaps the email once that link is clicked —
      // so a typo or someone else's inbox can't hijack the account.
      await auth.currentUser.verifyBeforeUpdateEmail(newEmail, actionCodeSettings);
      settingsMsg('settingsEmailMsg', `Verification link sent to ${newEmail}. Your sign-in email will update once you click it.`, false);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'REQUEST EMAIL CHANGE', `Requested change to ${newEmail}`);
      document.getElementById('changeEmailForm').reset();
    } catch (err) {
      settingsMsg('settingsEmailMsg', mapAuthError(err), true);
    } finally {
      btn.disabled = false; btn.textContent = 'Update Email';
    }
  });

  // ---- Change password ----
  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearSettingsMsg('settingsPasswordMsg');
    const btn = document.getElementById('changePasswordBtn');
    const currentPassword = document.getElementById('pwChangeCurrentPassword').value;
    const newPassword = document.getElementById('pwChangeNewPassword').value;
    btn.disabled = true; btn.textContent = 'Updating...';
    try {
      await reauthenticate(currentPassword);
      await auth.currentUser.updatePassword(newPassword);
      settingsMsg('settingsPasswordMsg', 'Password updated.', false);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'CHANGE PASSWORD', 'Password updated from Settings');
      document.getElementById('changePasswordForm').reset();
    } catch (err) {
      settingsMsg('settingsPasswordMsg', mapAuthError(err), true);
    } finally {
      btn.disabled = false; btn.textContent = 'Update Password';
    }
  });
}

// ---------------------------------------------------------
// 11. INACTIVITY AUTO-LOGOUT (15 min)
// Signs the user out after 15 minutes of no activity — including
// when the browser tab/window itself is inactive (switched away,
// minimized, or backgrounded). A plain setInterval alone isn't
// enough because browsers throttle timers in background tabs, so
// the 30s check can fire late. We fix that by also re-checking the
// instant the tab becomes visible/focused again.
// ---------------------------------------------------------
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
let lastActivity = Date.now();

function markActivity() { lastActivity = Date.now(); }
// 'scroll' does NOT bubble to document like other DOM events do, so a
// plain document-level listener only ever saw page-level scrolling and
// missed activity inside any inner scrollable panel (tables, modals,
// the sidebar) — the single biggest source of "I was clearly using the
// app but got logged out" reports. Listening in the CAPTURE phase (the
// `true` 3rd arg) is what actually fixes it: capture-phase listeners
// on an ancestor still see a descendant's scroll event on its way down,
// even though it never bubbles back up.
['click', 'keydown', 'mousemove', 'touchstart'].forEach(evt =>
  document.addEventListener(evt, markActivity, { passive: true })
);
document.addEventListener('scroll', markActivity, { passive: true, capture: true });

function checkInactivity() {
  if (auth.currentUser && Date.now() - lastActivity > INACTIVITY_LIMIT_MS) {
    // Fire-and-forget signOut() alone used to be silently swallowed
    // when suppressAutoRoute was left "true" by an in-flight Google
    // sign-in / email-verification flow — Firebase would sign the user
    // out under the hood, but onAuthStateChanged's routeUser() call
    // would be suppressed, so the dashboard just kept showing until the
    // next manual refresh and it LOOKED like auto-logout wasn't
    // happening at all. Force both explicitly here so the redirect to
    // the login screen always happens the moment the timeout fires,
    // regardless of what else is going on.
    auth.signOut().finally(() => {
      suppressAutoRoute = false;
      goToAuthScreen();
      toast('You were signed out after 15 minutes of inactivity.', 'error');
    });
  }
}

// Regular check while the tab is in the foreground.
setInterval(checkInactivity, 30000);

// Catch the case where the tab was backgrounded/minimized long
// enough that the timer above got throttled — re-check the moment
// the user comes back, so logout happens immediately if overdue.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkInactivity();
});
window.addEventListener('focus', checkInactivity);

// ---------------------------------------------------------
// 12. "/" KEYBOARD SHORTCUT — jump to the current page's search box
// Works on any dashboard page that has one (Employees, Audit Trail,
// Payroll Run, Exports). Ignored while already typing in a field, so
// it never steals a literal "/" from user input.
// ---------------------------------------------------------
const PAGE_SEARCH_INPUT_ID = {
  employees: 'employeeSearch',
  audit: 'auditSearch',
  disbursement: 'disbSearch',
  exports: 'exportsSearch'
};

// Escape dismisses any visible toast(s) — toast() had click-only
// dismiss before, with no keyboard equivalent.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.toast-host .toast').forEach((t) => {
    if (typeof t._toastRemove === 'function') t._toastRemove();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== '/') return;
  const target = e.target;
  const tag = (target.tagName || '').toLowerCase();
  const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  if (isEditable) return;

  const dashboardScreen = document.getElementById('screen-dashboard');
  if (!dashboardScreen || dashboardScreen.classList.contains('hidden')) return;

  const activeSection = document.querySelector('#screen-dashboard main > section:not(.hidden)');
  if (!activeSection) return;
  const pageId = activeSection.id.replace('page-', '');
  const inputId = PAGE_SEARCH_INPUT_ID[pageId];
  if (!inputId) return;

  const input = document.getElementById(inputId);
  if (!input) return;
  e.preventDefault();
  input.focus();
  input.select();
});