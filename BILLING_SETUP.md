# Wallet & Credits Billing — Setup Guide

Har naye user ko signup pe **5 free credits** milte hain (turant, "🎉 Congratulations" popup ke saath). Har payroll export **5 credits** use karta hai. Jab wallet khaali ho jaaye, user credit-pack khareed sakta hai (Razorpay se) — jitna bada pack utna zyada discount. Yeh sab server-side (**Vercel Serverless Functions**, `/api/*`) enforce hota hai — koi bhi browser/devtools se bypass nahi kar sakta.

## Credit packs (default pricing)

| Pack | Credits | Price | Per-credit | Discount |
|---|---|---|---|---|
| Quick top-up | 5 | ₹50 | ₹10.0 | — |
| — | 15 | ₹135 | ₹9.0 | 10% |
| Popular | 30 | ₹240 | ₹8.0 | 20% |
| — | 60 | ₹420 | ₹7.0 | 30% |
| Best value | 120 | ₹720 | ₹6.0 | 40% |

Yeh table sirf **`api/lib/creditPacks.js`** me hai — wahi asli price hai jo charge hota hai. `app.js` me bhi wahi list dikhti hai UI ke liye, lekin sirf display ke liye — agar koi devtools se `app.js` ka list badal bhi de, actual charge hamesha server wale table se hi hoga. Price ya export cost (`EXPORT_COST_CREDITS`, abhi 5) badalne ke liye sirf `creditPacks.js` edit karein — dono jagah nahi.

## Kaise kaam karta hai (short version)

1. User pehli baar login/signup karta hai → browser `init-wallet` function call karta hai. Agar wallet pehli baar init ho rahi hai, 5 credits mil jaate hain aur "Congratulations" popup dikhta hai. Baad ke har login pe yeh sirf current balance return karta hai (dobara credits nahi milte).
2. User "Confirm → Export" click karta hai → browser `consume-credits` function ko call karta hai:
   - Balance ≥ 5 → 5 credits minus karke turant "allowed" bhej deta hai.
   - Balance < 5 → "insufficient_credits" bhejta hai, kitne credits kam hain wo bhi bataata hai.
3. Insufficient hone par browser "Buy Credits" modal kholta hai (ya Wallet page se seedha) — user koi bhi pack chuun sakta hai, Razorpay checkout khulta hai.
4. Payment hone ke baad, `verify-payment` function Razorpay ka signature check karta hai, fir Razorpay se hi order ka asli detail (kitne credits, kis user ka) wapas fetch karta hai — tabhi Firestore me utne credits add hote hain. Client kabhi nahi bata sakta ki kitne credits milne chahiye, order khud Razorpay ke paas se confirm hota hai.
5. Fir se `consume-credits` call hota hai jo naya balance use karke export allow kar deta hai.
6. Tab jaake actual file browser me generate/download hoti hai (jaisa pehle hota tha).

**Client kabhi bhi `credits` ya `walletInitialized` field ko directly nahi likh sakta** — Firestore rules isko block karte hain. Sirf yeh Vercel functions (jo Admin SDK use karte hain) likh sakte hain.

### Transaction History

Har credit-affecting event (free signup grant, credit-pack purchase, export debit) `users/{uid}/transactions/{id}` me ek row bhi likhta hai — yeh bhi sirf server-side functions (Admin SDK) se hi likha jaata hai, `firestore.rules` client ko is subcollection me write karne se block karta hai (sirf apna record read kar sakta hai). Wallet page par "Transaction History" table isi data se banti hai (`Api.getTransactions()` → `app.js`), sabse naya transaction sabse upar.

---

## Setup Steps

### 1. Razorpay account banayein
1. https://dashboard.razorpay.com/signup par account banayein (KYC baad me bhi kar sakte hain, Test Mode turant use ho jaata hai).
2. Dashboard → **Settings → API Keys** → "Generate Test Key" (ya Live Key jab ready ho).
3. `Key Id` aur `Key Secret` copy kar lein — dono chahiye honge.

### 2. Firebase service account banayein
1. Firebase Console → aapka project → ⚙️ **Project Settings → Service Accounts**.
2. **Generate new private key** click karein — ek `.json` file download hogi.
3. Is file me se 3 cheezein chahiye: `project_id`, `client_email`, `private_key`.
4. **Is file ko kabhi bhi repo/uploads me na rakhein** — sirf Vercel env vars me daalein, fir apni machine se delete kar dein.

> Yeh normal Firestore read/write hai (Admin SDK), isliye Blaze plan ki zaroorat nahi — aapka free Spark plan kaafi hai.

### 3. Firestore Security Rules update karein
1. Firebase Console → **Firestore Database → Rules**.
2. Is repo ki `firestore.rules` file ka poora content copy-paste karke **Publish** karein.
3. Ye rule sirf itna karta hai: `credits` aur `walletInitialized` fields ko client se likhne se rok deta hai — baaki sab (employees, company details) pehle jaisa hi kaam karega.

### 4. Vercel par deploy karein
1. https://vercel.com par login/signup karein (GitHub se ho sakta hai).
2. **Add New → Project** — apna GitHub repo import karein (jisme `api/` folder ho).
3. Framework Preset = "Other" rehne dein — koi build step nahi chahiye, Vercel `api/*.js` files ko khud hi serverless functions ki tarah detect kar leta hai. `vercel.json` me sirf region (`bom1` — Mumbai, lowest latency) already set hai, kuch badalna nahi.
4. Deploy hone dein.

### 5. Environment Variables set karein
Vercel Dashboard → aapka project → **Settings → Environment Variables** → ye 5 add karein (Help & Support ka `SUPPORT_EMAIL_APP_PASSWORD` alag doc me hai):

| Key | Value |
|---|---|
| `RAZORPAY_KEY_ID` | Razorpay se mila Key Id |
| `RAZORPAY_KEY_SECRET` | Razorpay se mila Key Secret |
| `FIREBASE_PROJECT_ID` | Service account JSON ka `project_id` |
| `FIREBASE_CLIENT_EMAIL` | Service account JSON ka `client_email` |
| `FIREBASE_PRIVATE_KEY` | Service account JSON ka `private_key` (poora `-----BEGIN PRIVATE KEY-----...` sahit paste karein) |

Env vars set karne ke baad project ko ek baar **redeploy** kar dein (Deployments tab → "..." → "Redeploy").

### 6. app.js me ek line check karein
`app.js` me `FUNCTIONS_BASE_URL` naam ka constant hai (top ke paas):
```js
const FUNCTIONS_BASE_URL = "https://your-project.vercel.app/"; // "" = same origin
```
- Agar aapki poori site (HTML/CSS/JS + functions) Vercel par hi hai → isko `""` rakh dein.
- Agar site kahin aur (jaise GitHub Pages) rakhi hai aur sirf functions Vercel par hain (jaisa abhi hai) → yahan apni Vercel deployment ka URL daalein, aur `api/lib/firebaseAdmin.js` ki `ALLOWED_ORIGINS` list me apni GitHub Pages domain add karna na bhoolein — warna browser CORS error dega.

### 7. Purane users ka migration
Agar aapke paas pehle se live users hain jo purane `freeExportUsed` / `credits` (1 credit = 1 export) system par the, unka data naye system se match nahi karega — purana `credits:1` matlab ab sirf 1/5 export hoga. Deploy se pehle ek baar Firestore me manually (ya ek chhota one-time script se) sabke `credits` ko naye scale me convert kar dein (purana credit × 5), aur `walletInitialized: true` set kar dein taaki unhe dobara 5 free credits na milein.

### 8. Test karein
1. Test Mode Razorpay keys ke saath, checkout me test card use karein: `4111 1111 1111 1111`, koi bhi future expiry, koi bhi CVV.
2. Naya account banayein — login hote hi "Congratulations, 5 free credits" popup dikhna chahiye.
3. Pehla export try karein — 5 credits minus hone chahiye, balance 0 dikhna chahiye Wallet page pe.
4. Doosra export try karein — "Buy Credits" modal khulna chahiye. Koi bhi pack chunein, payment ke baad file download honi chahiye aur balance update hona chahiye.

### 9. Live jaane se pehle
- Razorpay dashboard me KYC complete karke **Live Keys** generate karein, unhi 2 env vars (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) me daal dein.
- Pricing/pack sizes badalne ho to sirf `api/lib/creditPacks.js` edit karein (`CREDIT_PACKS` array aur `EXPORT_COST_CREDITS`) — `app.js` ka `CREDIT_PACKS` bhi wahi values match karke update kar dein taaki UI aur actual price alag na dikhein.

---

## Files jo isme add/change hue

- `api/lib/firebaseAdmin.js` — shared Admin SDK setup + token verification + CORS
- `api/lib/creditPacks.js` — **pricing source of truth**: pack sizes, prices, export cost, free-signup credits
- `api/init-wallet.js` — signup pe ek baar 5 free credits grant karta hai
- `api/consume-credits.js` — export se pehle 5 credits atomically deduct karta hai
- `api/create-order.js` — chuni hui pack ka Razorpay order banata hai
- `api/verify-payment.js` — payment signature verify karke order ke asli credits wallet me add karta hai
- `firestore.rules` — `credits` / `walletInitialized` aur `transactions` subcollection ko client-write se protect karta hai (read allowed, write sirf Admin SDK se)
- `package.json`, `vercel.json` — Vercel deployment config
- `index.html` — Wallet page, Buy Credits modal, "Congratulations" modal, sidebar wallet balance chip
- `style.css` — wallet chip + credit-pack card styling
- `app.js` — wallet balance state, `initWallet()`, `ensureExportAllowed()`, `buyCreditPack()`, Wallet page rendering