# PayFlow Pro

**PayFlow Pro** is a simple, secure web app for running your company's monthly payroll and generating a **bank-ready bulk payment file** — the file you upload to your bank's corporate/net-banking portal to pay everyone in one go.

Keep your employee list in one place, enter each month's salary amounts, and export a file formatted exactly the way your bank expects it. No spreadsheets to reformat by hand every month, no manual NEFT/RTGS entries one-by-one.

---

## Table of Contents

- [What PayFlow Pro Does](#what-payflow-pro-does)
- [Supported Banks](#supported-banks)
- [Getting Started](#getting-started)
- [How to Use](#how-to-use)
  - [1. Set up your company details](#1-set-up-your-company-details)
  - [2. Add your employees](#2-add-your-employees)
  - [3. Run payroll and export the payment file](#3-run-payroll-and-export-the-payment-file)
  - [4. Upload the file to your bank](#4-upload-the-file-to-your-bank)
  - [5. Review past exports](#5-review-past-exports)
  - [6. Check the Activity Log](#6-check-the-activity-log)
- [Wallet & Credits](#wallet--credits)
- [Settings](#settings)
- [Help & Support](#help--support)
- [Data Security](#data-security)
- [FAQ](#faq)

---

## What PayFlow Pro Does

- **Employee Ledger** — one place for every employee's name, account number, IFSC, and transfer type, with double-entry checks so a typo in an account number never slips through.
- **Payroll Run** — enter this month's amount against each employee and see a running batch total as you go.
- **Bulk Export** — generates a bank-ready upload file in the exact format your bank expects, with the correct transfer mode (Same Bank / NEFT / RTGS / IMPS) worked out automatically for each employee.
- **Export History** — every batch you've ever exported is saved and can be reviewed or re-downloaded later.
- **Activity Log** — a running record of every add, edit, delete, and export, so you always know who did what and when.
- **Wallet & Credits** — a simple pay-per-export model; new accounts start with free credits, and more can be bought in a few taps.
- **Bulk CSV Import** — already have your employee list in a spreadsheet? Import it in one shot instead of typing everyone in by hand.
- **Guided Tour** — a short walkthrough that shows you around the app the first time you sign in (replayable any time from Settings).
- **Works on mobile too** — the full dashboard adapts to phone screens, so you can check balances or review exports on the go.

## Supported Banks

PayFlow Pro currently generates payment files for:

- State Bank of India (**SBI**)
- **HDFC** Bank
- **ICICI** Bank
- Punjab National Bank (**PNB**)

You choose your company's bank once (under Settings → Edit Company Details), and every export is automatically formatted for that bank.

## Getting Started

1. Open the PayFlow Pro website.
2. Click **Sign Up**, enter your name, email, and a password (or use **Sign in with Google**).
3. Verify your email if prompted.
4. You'll land on the Employees page with **5 free credits** already in your wallet — enough for your first export.
5. A short guided tour starts automatically to show you around. You can skip it any time, and replay it later from Settings if you want.

## How to Use

### 1. Set up your company details

Before your first export, tell PayFlow Pro which bank you pay salaries from:

1. Go to **Settings** (the ⚙️ icon in the sidebar) → **Edit Company Details**.
2. Select your **company's bank** first (SBI / HDFC / ICICI / PNB) — this decides both the export file format and which IFSC prefix is expected.
3. Enter your **Company Name**, **Account Number** (typed twice to confirm), and your account's **IFSC code** (also typed twice). Every Indian bank's IFSC is 11 characters — the app checks the format and warns you if it doesn't match the bank you selected.
4. Click **Save Company Profile**.

### 2. Add your employees

Go to the **Employees** page:

- Click **+ Add Employee** and fill in their name, employee code, mobile, email, account number (typed twice), IFSC (typed twice), and transfer type.
- Already have your team's details in a spreadsheet? Click **Bulk Import CSV** instead — download the sample CSV first to match the expected columns, then upload your file. You'll see a preview of exactly what will be imported (and what will be skipped, with the reason) before anything is saved.
- Use **Export Ledger CSV** any time to download your current employee list as a CSV.
- Search, sort, edit, or delete employees directly from the table. Select multiple rows to bulk-delete.

### 3. Run payroll and export the payment file

Go to the **Payroll Run** page:

1. Choose the **Transfer Type** (Same Bank / Other Bank), the **Payroll Cycle** (month), and the **Transfer Date**.
2. Enter the salary amount for each employee — the **Batch Total** at the bottom updates live as you type.
3. Click **Export File**, then choose how to pay for the export:
   - **Pay via Wallet** — uses your existing credit balance.
   - **Pay via Razorpay** — buy more credits first, then export.
4. Once payment is confirmed, the bulk payment file downloads automatically, formatted for your selected bank.

Every export costs a small number of credits from your wallet (see [Wallet & Credits](#wallet--credits) below).

### 4. Upload the file to your bank

Log in to your bank's corporate/net-banking portal, find its **bulk upload / bulk payment** section, and upload the file PayFlow Pro just generated. Your bank will handle the actual transfer to each employee's account from there — PayFlow Pro only prepares the file, it never moves money itself.

### 5. Review past exports

The **Exports** page keeps a full history of every batch you've generated — click any row to expand it and see the exact employee-by-employee breakdown that was included, and re-download the file if you need it again.

### 6. Check the Activity Log

The 📋 icon in the sidebar opens the **Activity Log** — a searchable, filterable record of every employee added/edited/deleted and every export run, with who did it and when.

## Wallet & Credits

- New accounts get **5 free credits** automatically on first sign-in.
- Each payroll export costs a fixed number of credits.
- When you run low, open the **Wallet** page (the 🪙 chip in the sidebar shows your current balance) and pick a credit pack — bigger packs work out cheaper per credit.
- Payments are handled securely through **Razorpay**.

## Settings

From the ⚙️ icon in the sidebar you can:

- **Appearance** — switch between the dark theme and a lighter, grey interface. Your choice is saved to your account, so it follows you to any device you sign in on.
- **Sign-in Email / Password** — update your login credentials (not available if you signed in with Google — those are managed through your Google Account).
- **Edit Company Details** — update your company name, bank, account number, or IFSC.
- **Replay Guided Tour** — see the app walkthrough again any time.
- **About PayFlow Pro** — a quick summary of what the app does.

## Help & Support

Click the ❓ icon in the sidebar, fill in a subject and message, and hit **Send**. Your message goes straight to the PayFlow Pro support inbox, and any reply lands directly in your own email — no ticket numbers, no separate portal to check.

## Data Security

- Your account is protected by Firebase Authentication (email/password or Google sign-in).
- Account numbers are shown masked by default in the app.
- Employee bank details are typed twice everywhere they're entered, with live mismatch warnings, to catch typos before they ever reach a real bank file.
- Wallet balances and billing are enforced entirely on the server — nothing about your credits or pricing can be changed from the browser.

## FAQ

**Do I need to install anything?**
No — PayFlow Pro runs entirely in your browser. Works on desktop and mobile.

**What happens if I enter the wrong account number?**
Every account number and IFSC field is typed twice, with an immediate warning if the two don't match — so mistakes get caught before they're saved.

**Can I edit an export after it's been generated?**
No — exports are a permanent record for your Activity Log and audit trail. If details were wrong, correct the employee/amount and run a fresh export.

**What if I run out of credits mid-export?**
You'll be prompted to top up via Razorpay before the export continues — nothing is generated until payment is confirmed.

**Is my data shared with anyone?**
No. Your employee list, company details, and export history are private to your account.
