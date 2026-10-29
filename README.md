# CDL+BS Verification and Update

A web app for divisions of the Directorate of Forests, West Bengal, to check their **DLs / CDLs** and enter their **Ban Sahayaks**. An operator signs in, picks a division, fills what is missing and verifies each person. The DFO then certifies each list. Admins see every division, approve additions and removals, and read the full change log.

```
GitHub Pages (docs/)  ──►  Apps Script API (apps-script/Code.gs)  ──►  "CDL+BS" Google Sheet
  sign up / in · tables · admin    checks the sign-in, reads/writes, emails   DL-CDL · Ban Sahayak · Change Log · Certificates · Lists · Users
```

CDL+BS is separate from UPMC2 and FV. It has its own repo, Apps Script project, Google Sheet and sessions.

## Accounts
- **Division users sign up themselves:** circle, division, email (their username), name, designation, mobile and password.
  - The sign-up page says *"Only 1 person per division. Please sign up for your own division."* If the division already has a user, it warns but still allows a second person.
  - A 6-digit code is emailed (Apps Script MailApp, from the Google account that owns the script). The account is created only when the code is entered. Codes last 30 minutes; five wrong tries and the code is gone.
  - **Forgot password** emails a code in the same way.
  - Passwords are kept as plain text in the **Users** tab, so an admin can see and set any of them (**Show passwords** on the Users page). Keep the sheet private. Five wrong sign-ins lock that email for 15 minutes.
- **A division user can change only their own division.** They can look at others. The API enforces this, not just the screen.
- **Admins** are in the private `Config.local.gs`, with the same usernames and passwords as UPMC2 and FV, and sign in with their username. Their **Users** page shows the users in each division (divisions with none are marked, as are those with more than 1). From there they can disable or enable a user (a disabled user is signed out at once) and set a new password. The Dashboard shows **Divisions with a user**.
- Every change in the Change Log records the user's name, designation and division.
- Email limit: a normal Gmail account sends about 100 emails a day, which is enough for the divisions signing up. Codes may land in spam; the screens say so.

**Real names never go to GitHub.** They live only in the Google Sheet. `private/` (the import workbook) and `apps-script/Config.local.gs` are in `.gitignore`. Without an API address, the website runs as a demo with made-up names (`docs/js/demo-data.js`).

## What the operator sees
- **DL / CDL | Ban Sahayaks** tabs on every page: all divisions, a circle, a division.
- **DL / CDL** arrive pre-filled from the July 2026 returns. Orange **Fill** marks what is missing.
  - **✏️ Edit** makes the row editable in the table. While editing, **💾 Save** and **✓ Save and verify** appear.
  - **✓ Verify** works only when everything is filled.
  - After a save that leaves a person complete, the app asks whether to verify them.
- **Posted at** comes first: **Division HQ** or a **Range** (with **+ New range…**). The places of work offered depend on it.
- **Nature of duty**: one main duty out of 9, any other duties, and the work written out for **Others**.
- **Remarks** (optional) is the last field.
- **Track changes** (off by default) colours every cell changed from the return. Pointing at a cell shows the old value.
- **Ban Sahayaks** are added by the division ("Add & next" for the next one). Pay is fixed at Rs 12,000, and there is no mode or agency.
- **Mark as not working** and **+ Add a person not in the list** (DL / CDL) wait for an admin. Ban Sahayaks the division adds count straight away.
- **Problem** (red) is a possible double entry. The operator says whether they are different people.
- **Certify list**: when everyone is verified, the DFO certifies the division's DL / CDL list and, separately, its Ban Sahayak list. A certified list is locked; only an admin can reopen it.

## How saving works
- Each change is shown at once and sent to the API in the background, one at a time. The top bar shows **Saving…** and then **All changes saved**.
- Each save carries the person's "Last updated on" as the website last saw it. If someone else saved that person in between, nothing is overwritten. The operator is told who changed it, and the division is loaded again.
- **Speed:**
  - The API keeps each division and the summary in its cache (gzipped, split under the 100 KB limit).
  - A save reads only the ID column and that person's row, then updates the cached division and its line of the summary instead of clearing them. The next page opens without reading the sheet.
  - A timer (`warm`, every 10 minutes, set up by `cdlSetup`) refills the cache before it expires.
  - The website loads a division and the summary together. It keeps the summary and the last 3 divisions opened on the device, so the next visit shows them at once and updates them quietly in the background. Signing out removes that copy.
  - While something loads, it shows UPMC's loading animation: a tree that draws itself, a moving bar, and rotating messages and tips.

## Setup (once)

### 1. The Google Sheet
1. Make the import workbook on this computer (needs `openpyxl`):
   `python3 scripts/make_data.py ../CDL/Cleaning` writes `private/CDL_BS_import.xlsx`.
2. Upload it to Google Drive, open it with Google Sheets, and choose **File → Save as Google Sheets**.
3. Rename it `CDL+BS Verification and Update`. Copy its ID, which is the long part of its link between `/d/` and `/edit`.

### 2. Apps Script API (a new project of its own)
1. Go to https://script.google.com and click **New project**. Rename it `CDL+BS API`.
2. Replace `Code.gs` with `apps-script/Code.gs`.
3. Click **+ → Script** and name it `Config.local`. Paste the private `apps-script/Config.local.gs` from this computer (not in GitHub; `Config.example.gs` is the blank template), and put the sheet ID in `SHEET_ID`.
4. In **Project Settings (⚙)**, tick **Show "appsscript.json" manifest file in editor**, then replace that file with `apps-script/appsscript.json`.
5. Select the function **cdlSetup** and click **Run**. Allow the permissions (Sheets, and sending email for the sign-up codes). It also adds the **Users** tab.
   - If you see "Google hasn't verified this app", click **Advanced → Go to CDL+BS API (unsafe)**. This is your own script.
   - The log shows the sheet's link and the numbers in it: 3,767 DL / CDL rows and 0 Ban Sahayaks.
6. Go to **Deploy → New deployment → ⚙ → Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then copy the URL that ends in `/exec`.

### 3. Connect the website
1. Put the `/exec` URL in `docs/js/config.js` (`API_URL`).
2. Push. GitHub Pages serves `docs/` from `main` (https://priyanshaias.github.io/cdlbs/). For cdl.forestwb.in: add a DNS CNAME record `cdl` → `priyanshaias.github.io`, then put `cdl.forestwb.in` in `docs/CNAME`.

### Changing the script later
1. Paste the new `Code.gs` (and `appsscript.json` if it changed) and save.
2. Run **cdlSetup** once. It asks for any new permission, refills the cache and checks the timer.
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**, so the `/exec` URL stays the same. To roll back, choose the earlier version there.

### Changing a password
- **Division users:** "Forgot password" on the sign-in page, **Change my password** in their menu, or an admin sets a new one on the **Users** page.
- **Accounts in `Config.local.gs` (grv, user…):** they start with their UPMC / FV password. An admin can set a new one on the **Users** page (it is then kept as plain text in the Users tab and applies to CDL+BS only), and anyone can use **Change my password** in their menu. **Use the UPMC / FV password** brings back the one in the file.

## Files
- `docs/`: the website (GitHub Pages). `js/config.js` holds the API address, `js/api.js` talks to it, `js/store.js` holds the data and rules, and `js/app.js` draws the screens.
- `apps-script/`: the API. `Code.gs`, `appsscript.json` and `Config.example.gs` are in GitHub. `Config.local.gs` is private.
- `scripts/`: builds the starting list from the cleaned returns (`make_data.py`, private) and the demo data (`make_demo.py`, made-up names). The duty rules are in `duty_classify.py`.
