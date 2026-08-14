# PayFlow Pro — Web Edition (v1)

First working version: login/signup (email+password + Google), and a hybrid
dashboard (one user type, no separate Maker/Authenticator accounts) with
Employee Ledger fully wired to your existing Google Sheet. Disbursement
export and Audit Trail view are placeholders — next iteration.

## ⚠️ Before you do anything

Your old `maincode31.py` has a real Gmail app password hardcoded
(`SENDER_APP_PASSWORD`). Once any version of this project is pushed to a
public GitHub repo, treat that password as compromised — go rotate/revoke it
in your Google Account now. Never put real passwords, API keys, or
`credentials.json` into this web project.

## Step-by-step setup

### 1. Create a Firebase project
- Go to https://console.firebase.google.com → Add project (free plan is fine).
- Inside the project: **Build → Authentication → Get started**.
- Under **Sign-in method**, enable:
  - **Email/Password**
  - **Google**

### 2. Get your Firebase web config
- Project Settings (gear icon) → General → scroll to "Your apps" → click the `</>` (Web) icon → register app.
- Copy the `firebaseConfig` object it gives you.
- Paste those values into `js/firebase-config.js` in this project (replace the `PASTE_...` placeholders).

### 3. Connect your existing Google Sheet
- Open your `SBI_Salary_Database` sheet (the same one your Python app already uses).
- Extensions → Apps Script.
- Delete the default code, paste in the contents of `apps-script/Code.gs` from this project.
- Click **Deploy → New deployment**.
  - Type: **Web app**
  - Execute as: **Me**
  - Who has access: **Anyone**
- Click Deploy, authorize when prompted, and copy the **Web app URL**.
- Paste that URL into `js/api.js`, replacing `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`.

### 4. Put it on GitHub
- Create a new GitHub repo (e.g. `payflow-pro-web`).
- Push everything in this folder to it.
- Repo → Settings → Pages → Source: Deploy from branch → `main` → `/ (root)` → Save.
- GitHub gives you a URL like `https://yourusername.github.io/payflow-pro-web/`.

### 5. Allow your GitHub Pages domain in Firebase
- Firebase Console → Authentication → Settings → **Authorized domains** → Add
  `yourusername.github.io`.
- (Without this step, Google login will fail with an "unauthorized domain" error.)

### 6. Test it
- Open your GitHub Pages URL.
- Sign up with an email/password, or sign in with Google.
- You should land on the dashboard and see the Employee Ledger — add a test
  employee and confirm it appears in your Google Sheet.

## What's next (tell me when ready)
- Disbursement tab: salary entry grid + SBI bulk `.txt` file export (SBST/OBST)
- Audit Trail tab reading from the `Audit_Trail` sheet
- Company details panel
- Any role-based permission tweaks now that Maker/Authenticator are merged
