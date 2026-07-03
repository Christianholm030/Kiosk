# Sortiment liste — automatic weekly email with GitHub Actions

This sends the low-stock list every Sunday at 02:00 Europe/Copenhagen from GitHub Actions.

## Files to copy into your GitHub repository

Copy these into the root of your repo:

```text
.github/workflows/weekly-low-stock-email.yml
scripts/send-low-stock-email.mjs
package.json
```

## GitHub secrets to create

Go to your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

Create these secrets:

```text
FIREBASE_DATABASE_URL=https://bordfodbolddtu-default-rtdb.europe-west1.firebasedatabase.app
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-sender-email@gmail.com
SMTP_PASS=your-app-password-or-smtp-password
EMAIL_FROM=Sortiment liste <your-sender-email@gmail.com>
EMAIL_TO=recipient@example.com
```

Optional:

```text
EMAIL_CC=someone@example.com
FIREBASE_DATABASE_AUTH=only-if-your-database-needs-a-token
```

For Gmail, do not use your normal Google password. Use a Gmail app password.

## Test it

1. Push the files to the default branch, usually `main`.
2. Go to **Actions**.
3. Open **Weekly low-stock email**.
4. Press **Run workflow**.
5. Check the workflow log and your inbox.

## Email format

```text
Hej,

Her er indkøbslisten fra Sortiment liste (03.07.2026, 11.47).

Varer under lav-lager grænsen:

- Flæskesværd | På lager: 1 Kasser | Grænse: 1 | Sidst opdateret: 03.07.2026, 11.47

Mvh
Sortiment liste
```
