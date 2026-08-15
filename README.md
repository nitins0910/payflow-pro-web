# PayFlow Pro

A ledger-grade, browser-based payroll console for generating **bank-ready bulk payment files** — with a server-enforced, pay-per-export credit wallet and Razorpay billing built in.

Add employees once, enter each month's salary amounts, and export a bulk upload file formatted exactly the way your bank's corporate portal expects it — SBI, HDFC, ICICI, or PNB.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone the repo](#1-clone-the-repo)
  - [2. Firebase setup](#2-firebase-setup)
  - [3. Razorpay setup](#3-razorpay-setup)
  - [4. Deploy to Netlify](#4-deploy-to-netlify)
  - [5. Environment variables](#5-environment-variables)
  - [6. Help & Support email setup](#6-help--support-email-setup)
  - [7. Point the frontend at your functions](#7-point-the-frontend-at-your-functions)
- [Wallet & Billing Model](#wallet--billing-model)
- [Supported Banks & File Formats](#supported-banks--file-formats)
- [Security](#security)
- [Local Development](#local-development)
- [Migrating Existing Users](#migrating-existing-users)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

PayFlow Pro is a single-page web app (no backend server to manage) that lets a small business:

1. Maintain an employee roster (name, account number, IFSC, transfer type).
2. Enter a monthly salary amount against each employee.
3. Preview the batch, then export a bulk payment file in the exact column/format each supported bank expects.
4. Keep a full audit trail and re-downloadable export history.

Every export costs **credits** from an in-app wallet. New signups get free credits automatically; more can be bought via Razorpay. All billing logic (pricing, balance checks, payment verification) runs **server-side** in Netlify Functions — nothing about pricing or balances can be tampered with from the browser.

## Features

- **Employee management** — add/edit/delete employees with double-entry verification (account number & IFSC typed twice, live mismatch warnings) to prevent fat-finger errors before they reach a bank file.
- **Bulk CSV import** — import employees in bulk with a preview + validation step before committing.
- **Multi-bank export** — generate bulk payment files formatted for **SBI, HDFC, ICICI, and PNB**, with automatic Same Bank / RTGS / NEFT / IMPS mode detection per beneficiary.
- **Payroll Run workflow** — enter amounts, preview the batch (total, warnings for unusual amounts, invalid IFSCs, etc.), then export.
- **Export history** — every export batch is saved and can be reviewed or re-downloaded later, using the exact company/IFSC snapshot from the time it was generated.
- **Audit log** — every add, edit, delete, and export is automatically logged with who did it and when.
- **Wallet & credits billing** — pay-per-export model enforced entirely server-side (see [Wallet & Billing Model](#wallet--billing-model)).
- **Razorpay integration** — buy credit packs with server-verified payments (signature check + replay protection).
- **Firebase Authentication** — email/password and Google sign-in, with email verification and password reset flows.
- **Help & Support** — in-app contact form that emails the site owner directly, with replies routed back to the user's account email.
- **Guided onboarding tour** — a spotlight walkthrough that starts automatically right after a new user's free-credits welcome message.
- **Dark, monochrome, "ledger-grade" UI** — sharp edges, no unnecessary color, built for financial data.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (no framework, no build step) |
| Auth & Database | Firebase Authentication + Cloud Firestore |
| Serverless backend | Netlify Functions (Node.js) |
| Payments | Razorpay (Orders API + client checkout) |
| Email | Nodemailer via Gmail SMTP |
| Hosting | Netlify (functions) — frontend can be hosted on Netlify itself or separately (e.g. GitHub Pages) |

No frontend build tooling is required — `index.html`, `app.js`, and `style.css` are served as-is.

## Architecture

```
Browser (index.html / app.js)
   │
   ├── Firebase Auth SDK ──────────────► Firebase Authentication
   ├── Firestore SDK (employees, company profile, audit log, export history)
   │                                    ──────────────► Cloud Firestore
   │                                                        ▲
   │                                                        │ Admin SDK (bypasses
   │                                                        │ client security rules)
   └── fetch() ────────────────────────► Netlify Functions ─┘
                                          ├── init-wallet.js
                                          ├── consume-credits.js
                                          ├── create-order.js
                                          ├── verify-payment.js  ──► Razorpay API
                                          └── send-support-message.js ──► Gmail SMTP
```

**Why a server-side wallet?** Anything that decides "how many credits does this cost" or "how many credits did this payment buy" lives in Netlify Functions using the Firebase **Admin SDK**, which is not bound by client-side Firestore security rules. The browser can never write `credits` or `walletInitialized` directly — Firestore rules block it outright (see `firestore.rules`), so the only way those fields change is through the server functions below.

## Project Structure

```
.
├── index.html                          # Single-page app shell (all screens/modals)
├── app.js                              # All frontend logic (auth, employees, export, wallet, tour)
├── style.css                           # Dark/monochrome ledger-style UI
├── favicon.svg / favicon.ico / icon-*.png   # Browser tab & home-screen icons
├── firestore.rules                     # Firestore security rules
├── netlify.toml                        # Netlify build & functions config
├── package.json                        # Node dependencies for the functions
├── BILLING_SETUP.md                    # Step-by-step wallet/Razorpay setup guide
├── HELP_SUPPORT_SETUP.md               # Step-by-step Help & Support email setup guide
└── netlify/functions/
    ├── _firebaseAdmin.js               # Shared Admin SDK init, auth check, CORS helpers
    ├── _creditPacks.js                 # Server-side pricing source of truth
    ├── init-wallet.js                  # One-time free-credit grant on signup
    ├── consume-credits.js              # Atomically deducts credits before an export
    ├── create-order.js                 # Creates a Razorpay order for a chosen pack
    ├── verify-payment.js               # Verifies payment signature & credits the wallet
    └── send-support-message.js         # Emails the Help & Support form to the site owner
```

> **Note:** never commit a Firebase service-account `.json` key file to this repository. It grants full Admin SDK access (bypasses all Firestore rules) and must only ever live in Netlify's encrypted environment variables. If one was ever committed or shared anywhere, treat it as compromised — revoke it in Firebase Console → Project Settings → Service Accounts immediately and generate a new one.

## Getting Started

### Prerequisites

- A [Firebase](https://console.firebase.google.com) project (free **Spark** plan is enough)
- A [Razorpay](https://dashboard.razorpay.com/signup) account (Test Mode is free to start)
- A [Netlify](https://app.netlify.com) account
- A Gmail account for the Help & Support inbox (can be any Gmail address)

### 1. Clone the repo

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### 2. Firebase setup

1. Create a Firebase project at the [Firebase Console](https://console.firebase.google.com).
2. Enable **Authentication** → Sign-in methods: Email/Password and Google.
3. Enable **Cloud Firestore** (Native mode).
4. Go to **Project Settings → Service Accounts → Generate new private key**. This downloads a `.json` file — you'll need three values from it (`project_id`, `client_email`, `private_key`) for step 5. **Do not commit this file** — delete it from your machine once the values are copied into Netlify.
5. Go to **Firestore Database → Rules**, paste the contents of this repo's `firestore.rules`, and **Publish**. This is what stops the browser from ever writing `credits` or `walletInitialized` directly.
6. Copy your Firebase web app config into the `<script>` block near the top of `index.html` / `app.js` (`apiKey`, `authDomain`, `projectId`, etc.) if you haven't already.

### 3. Razorpay setup

1. Sign up at the [Razorpay Dashboard](https://dashboard.razorpay.com/signup) (KYC can be completed later; Test Mode works immediately).
2. Go to **Settings → API Keys → Generate Test Key** (switch to Live Keys once you're ready to accept real payments).
3. Copy the **Key Id** and **Key Secret** — both are needed as environment variables.

### 4. Deploy to Netlify

1. Log in to [Netlify](https://app.netlify.com) (GitHub login works).
2. **Add new site → Import an existing project**, and connect this repository.
3. Build settings (already set in `netlify.toml`, nothing to change):
   - Publish directory: `.`
   - Functions directory: `netlify/functions`
4. Deploy the site.

### 5. Environment variables

In Netlify: **Site configuration → Environment variables**, add:

| Key | Value |
|---|---|
| `RAZORPAY_KEY_ID` | From Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | From Razorpay dashboard |
| `FIREBASE_PROJECT_ID` | `project_id` from the service account JSON |
| `FIREBASE_CLIENT_EMAIL` | `client_email` from the service account JSON |
| `FIREBASE_PRIVATE_KEY` | `private_key` from the service account JSON (paste the full `-----BEGIN PRIVATE KEY-----...` block) |
| `SUPPORT_EMAIL_APP_PASSWORD` | See [Help & Support email setup](#6-help--support-email-setup) below |

After adding these, trigger a redeploy (**Deploys tab → Trigger deploy**).

### 6. Help & Support email setup

The in-app "Help & Support" form emails the site owner directly via Gmail SMTP.

1. Sign in to the Gmail account that should receive support messages.
2. Turn on **2-Step Verification** at [myaccount.google.com/security](https://myaccount.google.com/security) (required for app passwords).
3. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), create a new app password (any name, e.g. "PayFlow Support").
4. Copy the 16-character password into the `SUPPORT_EMAIL_APP_PASSWORD` environment variable above.
5. Update the `SUPPORT_INBOX` constant in `netlify/functions/send-support-message.js` to your own address.

Full details in [`HELP_SUPPORT_SETUP.md`](./HELP_SUPPORT_SETUP.md).

### 7. Point the frontend at your functions

In `app.js`, find:

```js
const FUNCTIONS_BASE_URL = ""; // "" = same origin
```

- If the whole site (HTML/CSS/JS **and** the functions) is on the same Netlify site → leave this as `""`.
- If the frontend is hosted elsewhere (e.g. GitHub Pages) and only the functions live on Netlify → set this to your Netlify site's URL, e.g. `"https://your-site.netlify.app"`.

Also update `ALLOWED_ORIGINS` in `netlify/functions/_firebaseAdmin.js` to include whatever origin(s) actually serve the frontend — this is required for the functions' CORS headers to allow the browser's requests through.

Full details in [`BILLING_SETUP.md`](./BILLING_SETUP.md).

## Wallet & Billing Model

- Every new user gets **5 free credits** automatically on their first login (once, ever — enforced by a Firestore transaction so a double-click or two open tabs can't grant it twice).
- Every payroll export costs **5 credits**.
- When exporting, the user can choose:
  - **Pay via Wallet** — deducts directly from the current balance (fails cleanly if the balance is insufficient).
  - **Pay via Razorpay** — buy a credit pack (bigger packs get a steeper per-credit discount), verified server-side, then the export proceeds.
- All pricing lives in **one place**: `netlify/functions/_creditPacks.js`. The copy of the price table in `app.js` is for **display only** — the amount actually charged always comes from the server file, so editing the client copy in DevTools changes nothing about what gets billed.
- Payment verification recomputes Razorpay's HMAC signature server-side and re-fetches the order from Razorpay's API to read the real credit amount — the browser can never claim it paid for more credits than it actually did, and a captured/replayed payment confirmation can only ever be credited once.

See [`BILLING_SETUP.md`](./BILLING_SETUP.md) for the full setup walkthrough and default pricing table.

## Supported Banks & File Formats

| Bank | IFSC prefix |
|---|---|
| State Bank of India (SBI) | `SBIN` |
| HDFC Bank | `HDFC` |
| ICICI Bank | `ICIC` |
| Punjab National Bank (PNB) | `PUNB` |

Every Indian bank's IFSC is **11 characters** — 4 letters (bank code) + a fixed `0` + 6 characters (branch code) — this is an RBI-wide standard and doesn't vary by bank. The app validates both the general 11-character format **and** that the code's prefix matches whichever bank is selected for the company profile.

Each bank has its own bulk-file column layout/delimiter, implemented in `app.js`'s `BankFormatters`. Transfer mode (Same Bank / NEFT / RTGS / IMPS) is auto-detected per beneficiary by comparing the company's and employee's IFSC prefixes.

## Security

- **Server-enforced billing** — all balance checks, price lookups, and payment verification happen in Netlify Functions using the Firebase Admin SDK; Firestore rules independently block the browser from writing `credits` or `walletInitialized` directly, so both layers have to agree before a balance ever changes.
- **Payment replay protection** — each verified Razorpay payment is recorded (by `razorpay_payment_id`) in the same atomic transaction that credits the wallet, so a captured/resent payment confirmation can't be used to claim credits more than once.
- **Authenticated functions only** — every Netlify function requires a valid Firebase ID token (`Authorization: Bearer <token>`); there is no unauthenticated write path.
- **Double-entry data guards** — account numbers and IFSC codes are typed twice (employee form and company profile) with live mismatch detection, to catch typos before they reach a real bank file.
- **Never commit secrets** — Razorpay keys, the Firebase service-account private key, and the support-email app password must live only in Netlify environment variables, never in the repository.

If you discover a security issue in this app, please do not open a public GitHub issue — contact the maintainer privately first.

## Local Development

Netlify Functions can be run locally with the [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
netlify login
netlify dev
```

This serves `index.html` and the functions together on `http://localhost:8888`, using the same environment variables configured in your Netlify site (or a local `.env` file — never commit it).

## Migrating Existing Users

If you already had live users on an older `freeExportUsed` / 1-credit-per-export system before adding the wallet, their existing `credits` values won't match the new 5-credits-per-export scale. Before deploying, either manually update Firestore or run a one-time script to:

1. Multiply each user's existing `credits` by 5.
2. Set `walletInitialized: true` on their document, so they don't get another free grant.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Checking..." hangs forever on export/buy | A CORS error — add your frontend's origin to `ALLOWED_ORIGINS` in `_firebaseAdmin.js` and redeploy. |
| "Could not reach the billing server" | `FUNCTIONS_BASE_URL` in `app.js` doesn't point at your actual Netlify functions URL. |
| Support emails land in Spam | First-time self-to-self Gmail sends are sometimes flagged — mark "Not Spam" once and it self-corrects. |
| Browser tab shows no icon | Make sure `favicon.svg`, `favicon.ico`, and the `icon-*.png` files are uploaded alongside `index.html` in the site root. |
| "This IFSC doesn't look like a [Bank] code" on save | The entered IFSC's 4-letter prefix doesn't match the selected bank — double check the code or the bank selection. |

## License

Add your preferred license here (e.g. MIT) before making this repository public.
