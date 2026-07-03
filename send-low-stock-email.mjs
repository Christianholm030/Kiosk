import nodemailer from 'nodemailer';

const REQUIRED = [
  'FIREBASE_DATABASE_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
  'EMAIL_TO'
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable / GitHub secret: ${key}`);
  }
}

const timeZone = 'Europe/Copenhagen';
const databaseUrl = process.env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
const auth = process.env.FIREBASE_DATABASE_AUTH || '';
const url = new URL(`${databaseUrl}/inventory.json`);
if (auth) url.searchParams.set('auth', auth);

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Could not read Firebase inventory: ${response.status} ${await response.text()}`);
}

const inventory = await response.json();
const items = Object.values(inventory || {});
const defaultReorder = Number(process.env.DEFAULT_REORDER || 2);

function lowFlag(item) {
  return Number(item.stock || 0) <= Number(item.reorder ?? defaultReorder);
}

function fmtQty(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(2)).replace('.', ',');
}

function fmtDateTime(ts) {
  if (!ts) return 'ukendt';
  return new Intl.DateTimeFormat('da-DK', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts));
}

const lowItems = items
  .filter(lowFlag)
  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'da'));

const now = new Intl.DateTimeFormat('da-DK', {
  timeZone,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
}).format(new Date());

const subject = `Indkøbsliste fra Sortiment liste – ${lowItems.length} varer under grænsen`;
const lines = [
  'Hej,',
  '',
  `Her er indkøbslisten fra Sortiment liste (${now}).`,
  ''
];

if (lowItems.length === 0) {
  lines.push('Ingen varer er under lav-lager grænsen.');
} else {
  lines.push('Varer under lav-lager grænsen:');
  lines.push('');
  for (const item of lowItems) {
    const stock = fmtQty(item.stock || 0);
    const reorder = fmtQty(item.reorder ?? defaultReorder);
    const unit = item.unit || 'stk';
    const updated = fmtDateTime(item.updatedAt);
    lines.push(`- ${item.name} | På lager: ${stock} ${unit} | Grænse: ${reorder} | Sidst opdateret: ${updated}`);
  }
}

lines.push('', 'Mvh', 'Sortiment liste');
const text = lines.join('\n');

const port = Number(process.env.SMTP_PORT || 465);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

await transporter.sendMail({
  from: process.env.EMAIL_FROM,
  to: process.env.EMAIL_TO,
  cc: process.env.EMAIL_CC || undefined,
  subject,
  text
});

console.log(`Sent low-stock email to ${process.env.EMAIL_TO}. Low-stock items: ${lowItems.length}`);
