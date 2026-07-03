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

function fmtDateOnly(ts) {
  if (!ts) return 'ukendt';
  return new Intl.DateTimeFormat('da-DK', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(ts));
}

function emailDateKey(ts) {
  if (!ts) return 'Ukendt dato';
  return fmtDateOnly(ts);
}

function byNewestUpdateThenName(a, b) {
  return Number(b.updatedAt || 0) - Number(a.updatedAt || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'da');
}

const lowItems = items
  .filter(lowFlag)
  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'da'));

function isUpdatedWithinLastMonth(item) {
  const ts = Number(item.updatedAt || 0);
  if (!ts) return false;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Date.now() - ts <= thirtyDaysMs;
}

function pushEmailItem(lines, item) {
  const stock = fmtQty(item.stock || 0);
  const unit = item.unit || 'stk';
  const updated = fmtDateOnly(item.updatedAt);
  lines.push(`• ${item.name}`);
  lines.push(`  På lager: ${stock} ${unit}`);
  lines.push(`  Sidst opdateret: ${updated}`);
  lines.push('');
}

function pushEmailSection(lines, list) {
  const groups = new Map();
  for (const item of list.slice().sort(byNewestUpdateThenName)) {
    const key = emailDateKey(item.updatedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const [date, group] of groups.entries()) {
    lines.push(date);
    lines.push('');
    for (const item of group) pushEmailItem(lines, item);
  }
}

const recentItems = lowItems.filter(isUpdatedWithinLastMonth);
const olderItems = lowItems.filter(item => !isUpdatedWithinLastMonth(item));

const now = new Intl.DateTimeFormat('da-DK', {
  timeZone,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
}).format(new Date());

const subject = `Indkøbsliste fra Sortiment liste – ${lowItems.length} varer`;
const lines = [
  'Hej,',
  '',
  'Her er indkøbslisten fra Sortiment liste.',
  `Dato: ${now}`,
  '',
  `I alt: ${lowItems.length} varer under lav-lager.`,
  ''
];

if (lowItems.length === 0) {
  lines.push('Ingen varer er under lav-lager lige nu.');
} else {
  lines.push(`NYLIGT ÆNDRET - sidste 30 dage (${recentItems.length})`);
  lines.push('========================================');
  lines.push('');
  if (recentItems.length) {
    pushEmailSection(lines, recentItems);
  } else {
    lines.push('Ingen varer i denne sektion.', '');
  }

  // Fire tomme linjer mellem sektionerne gør mailen lettere at læse på telefonen.
  lines.push('', '', '', '');

  lines.push(`ÆLDRE VARER - mere end 30 dage siden ændring (${olderItems.length})`);
  lines.push('========================================');
  lines.push('');
  if (olderItems.length) {
    pushEmailSection(lines, olderItems);
  } else {
    lines.push('Ingen varer i denne sektion.', '');
  }
}

lines.push('Mvh', 'Sortiment liste');
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
