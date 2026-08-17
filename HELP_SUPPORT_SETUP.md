# Help & Support — Setup Guide

Sidebar me ek naya **Help & Support** icon (❓) add hua hai. User click karke subject + message likhta hai, "Send Message" dabata hai, aur woh seedha **nitins1009@gmail.com** par email ban jaata hai — koi ticket system nahi, bas ek email.

Reply karne ke liye normal reply karo — email ka "Reply-To" us user ke apne account email par set hota hai, isliye reply seedha unhi ko jaata hai.

## Kaise kaam karta hai

1. User form submit karta hai → browser `send-support-message` Vercel function ko call karta hai (login zaroori hai, jaise baaki functions).
2. Function Gmail SMTP (Nodemailer) se `nitins1009@gmail.com` se hi email bhejta hai, khud ko hi, but `Reply-To` user ke email par.
3. Subject line me `[PayFlow Pro Support]` prefix rehta hai taaki inbox me alag se dikhe.

---

## Setup Steps

### 1. Gmail par "App Password" banayein
Normal Gmail password se seedha SMTP login nahi hota — ek alag "App Password" chahiye.

1. `nitins1009@gmail.com` se sign in karke https://myaccount.google.com/security par jayein.
2. **2-Step Verification** on karein (agar pehle se on nahi hai — App Password ke liye yeh zaroori hai).
3. Fir https://myaccount.google.com/apppasswords par jayein.
4. Koi bhi naam de dein (jaise "PayFlow Support"), **Create** click karein.
5. Google ek 16-character password dikhayega (jaise `abcd efgh ijkl mnop`) — ise copy kar lein. (Bina space ke bhi chalega.)

### 2. Vercel Environment Variable set karein
Vercel Dashboard → aapka project → **Settings → Environment Variables** → yeh 1 naya add karein:

| Key | Value |
|---|---|
| `SUPPORT_EMAIL_APP_PASSWORD` | Step 1 me mila 16-character App Password |

(Baaki 5 env vars — Razorpay/Firebase wale — pehle se hain, unko chhedna nahi hai.)

Add karne ke baad project ko ek baar **redeploy** kar dein (Deployments tab → "..." → "Redeploy").

### 3. Test karein
1. App me login karke sidebar ka ❓ icon click karein.
2. Ek test subject + message bhejein.
3. `nitins1009@gmail.com` ka inbox check karein (pehli baar **Spam/Promotions folder bhi check kar lein** — apne hi address se apne ko mail aane par kabhi-kabhi Gmail usko spam samajh leta hai; ek baar "Not Spam" mark karne ke baad theek ho jaata hai).
4. Reply karke check kar lein ki reply user ke email par ja raha hai (na ki wapas `nitins1009@gmail.com` par).

---

## Files jo isme add/change hue

- `api/send-support-message.js` — email bhejta hai (Nodemailer + Gmail SMTP)
- `package.json` — `nodemailer` dependency add hui
- `index.html` — sidebar me Help & Support icon + modal add hua
- `style.css` — textarea styling add hui (form ke message box ke liye)
- `app.js` — `wireHelpSupport()` function add hua (modal open/close + form submit)
