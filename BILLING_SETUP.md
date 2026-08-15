# Pay-per-Export Billing — Setup Guide

Har naye user ka **pehla payroll export free** hai. Uske baad **har export ₹50** charge hota hai (Razorpay se). Yeh sab server-side (Netlify Functions) enforce hota hai — koi bhi browser/devtools se bypass nahi kar sakta.

## Kaise kaam karta hai (short version)

1. User "Confirm → Export" click karta hai.
2. Browser `consume-export` function ko call karta hai. Yeh function Firestore me user ka record check karta hai:
   - Agar free export use nahi hua → free export consume karke turant "allowed" bhej deta hai.
   - Agar free use ho chuka hai aur paid credit bacha hai → 1 credit minus karke "allowed" bhej deta hai.
   - Agar kuch nahi bacha → "payment_required" bhejta hai.
3. Payment required hone par browser Razorpay ka checkout popup kholta hai (₹50).
4. Payment hone ke baad, `verify-payment` function Razorpay ka signature check karta hai (yeh proof hai ki payment sach me hui) — tabhi Firestore me 1 credit add hota hai.
5. Fir se `consume-export` call hota hai jo wahi naya credit use karke export allow kar deta hai.
6. Tab jaake actual file browser me generate/download hoti hai (jaisa pehle hota tha).

**Client kabhi bhi `freeExportUsed` ya `credits` field ko directly nahi likh sakta** — Firestore rules isko block karte hain. Sirf yeh Netlify functions (jo Admin SDK use karte hain) likh sakte hain.

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

> Yeh normal Firestore read/write hai (Admin SDK), isliye Blaze plan ki zaroorat nahi — aapka free Spark plan kaafi hai.

### 3. Firestore Security Rules update karein
1. Firebase Console → **Firestore Database → Rules**.
2. Is repo ki `firestore.rules` file ka poora content copy-paste karke **Publish** karein.
3. Ye rule sirf itna karta hai: `freeExportUsed` aur `credits` fields ko client se likhne se rok deta hai — baaki sab (employees, company details) pehle jaisa hi kaam karega.

### 4. Netlify par deploy karein
1. https://app.netlify.com par login/signup karein (GitHub se ho sakta hai).
2. **Add new site → Import an existing project** — apna GitHub repo connect karein (ya poore folder ko drag-drop bhi kar sakte hain "Deploys" tab me).
3. Build settings: Publish directory = `.` (root), Functions directory = `netlify/functions` — ye `netlify.toml` me already set hai, kuch badalna nahi.
4. Deploy hone dein.

### 5. Environment Variables set karein
Netlify Dashboard → aapki site → **Site configuration → Environment variables** → ye 5 add karein:

| Key | Value |
|---|---|
| `RAZORPAY_KEY_ID` | Razorpay se mila Key Id |
| `RAZORPAY_KEY_SECRET` | Razorpay se mila Key Secret |
| `FIREBASE_PROJECT_ID` | Service account JSON ka `project_id` |
| `FIREBASE_CLIENT_EMAIL` | Service account JSON ka `client_email` |
| `FIREBASE_PRIVATE_KEY` | Service account JSON ka `private_key` (poora `-----BEGIN PRIVATE KEY-----...` sahit paste karein) |

Env vars set karne ke baad site ko ek baar **redeploy** kar dein (Deploys tab → "Trigger deploy").

### 6. app.js me ek line check karein
`app.js` me `FUNCTIONS_BASE_URL` naam ka constant hai (top ke paas):
```js
const FUNCTIONS_BASE_URL = ""; // "" = same origin
```
- Agar aapki poori site (HTML/CSS/JS + functions) Netlify par hi hai → isko `""` hi rehne dein.
- Agar site kahin aur (jaise GitHub Pages) rakhi hai aur sirf functions Netlify par hain → yahan apni Netlify site ka URL daalein, jaise `"https://payflow-billing.netlify.app"`.

### 7. Test karein
1. Test Mode Razorpay keys ke saath, checkout me test card use karein: `4111 1111 1111 1111`, koi bhi future expiry, koi bhi CVV.
2. Pehla export free hona chahiye (koi payment popup nahi).
3. Doosra export try karein — ₹50 ka Razorpay popup khulna chahiye.
4. Payment ke baad file download honi chahiye, aur Firestore me us user ke document par `credits: 0`, `freeExportUsed: true` dikhna chahiye.

### 8. Live jaane se pehle
- Razorpay dashboard me KYC complete karke **Live Keys** generate karein, unhi 2 env vars (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) me daal dein.
- Agar future me kuch aur charge karna ho, sirf `netlify/functions/create-order.js` me `EXPORT_PRICE_PAISE` badal dein (paise me — ₹50 = `5000`).

---

## Files jo isme add/change hue

- `netlify/functions/_firebaseAdmin.js` — shared Admin SDK setup + token verification
- `netlify/functions/consume-export.js` — free/paid export ki atomic check + consume
- `netlify/functions/create-order.js` — ₹50 ka Razorpay order banata hai
- `netlify/functions/verify-payment.js` — payment signature verify karke credit deta hai
- `firestore.rules` — billing fields ko client-write se protect karta hai
- `package.json`, `netlify.toml` — Netlify deployment config
- `index.html` — Razorpay checkout script tag add hua
- `app.js` — `ensureExportAllowed()` + `runRazorpayCheckout()` add hue, Export button me gate laga
