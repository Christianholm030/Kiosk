import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

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
    throw new Error(
      `Missing required environment variable / GitHub secret: ${key}`
    );
  }
}

const timeZone = 'Europe/Copenhagen';
const databaseUrl = process.env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
const auth = process.env.FIREBASE_DATABASE_AUTH || '';
const defaultReorder = Number(process.env.DEFAULT_REORDER || 2);

const url = new URL(`${databaseUrl}/inventory.json`);

if (auth) {
  url.searchParams.set('auth', auth);
}

const response = await fetch(url);

if (!response.ok) {
  throw new Error(
    `Could not read Firebase inventory: ${response.status} ${await response.text()}`
  );
}

const inventory = await response.json();
const items = Object.values(inventory || {});

function isDiscontinued(item) {
  return Boolean(item.discontinued);
}

function reorderLevel(item) {
  return Number(item.reorder ?? defaultReorder);
}

function lowFlag(item) {
  return (
    !isDiscontinued(item) &&
    Number(item.stock || 0) < reorderLevel(item)
  );
}

function fmtQty(value) {
  const number = Number(value || 0);

  return Number.isInteger(number)
    ? String(number)
    : String(+number.toFixed(2)).replace('.', ',');
}

function fmtDateOnly(timestamp) {
  if (!timestamp) {
    return 'ukendt';
  }

  return new Intl.DateTimeFormat('da-DK', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(timestamp));
}

function countOrderValue(item) {
  const order = Number(item.countOrder);

  return Number.isFinite(order)
    ? order
    : Number.MAX_SAFE_INTEGER;
}

function byCountOrderThenName(a, b) {
  return (
    countOrderValue(a) - countOrderValue(b) ||
    String(a.name || '').localeCompare(
      String(b.name || ''),
      'da'
    )
  );
}

function safeUnit(item) {
  return String(item.unit || 'stk');
}

const activeItems = items.filter(
  item => !isDiscontinued(item)
);

const discontinuedItems = items.filter(isDiscontinued);

const lowItems = activeItems
  .filter(lowFlag)
  .sort(byCountOrderThenName);

const now = new Intl.DateTimeFormat('da-DK', {
  timeZone,
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
}).format(new Date());

function createShoppingListPdf(list) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: 42,
        right: 38,
        bottom: 42,
        left: 38
      },
      bufferPages: true,
      info: {
        Title: 'Indkøbsliste fra Sortiment liste',
        Author: 'Sortiment liste'
      }
    });

    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const contentWidth =
      pageWidth -
      doc.page.margins.left -
      doc.page.margins.right;

    const left = doc.page.margins.left;
    const cardHeight = 94;
    const cardGap = 10;

    const bottomLimit =
      doc.page.height -
      doc.page.margins.bottom;

    function addHeader() {
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(24)
        .text('INDKØBSLISTE', left, doc.y, {
          width: contentWidth
        });

      doc.moveDown(0.2);

      doc
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(10)
        .text(
          `${now} · ${list.length} varer skal købes`,
          left,
          doc.y,
          {
            width: contentWidth
          }
        );

      doc.moveDown(1.1);
    }

    function ensureSpace(height) {
      if (doc.y + height > bottomLimit) {
        doc.addPage();
        addHeader();
      }
    }

    function drawSectionHeading(label) {
      ensureSpace(28 + cardHeight);

      doc.moveDown(0.35);

      doc
        .fillColor('#334155')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(
          String(label || 'Uden kategori').toUpperCase(),
          left,
          doc.y,
          {
            width: contentWidth,
            characterSpacing: 0.7
          }
        );

      doc.moveDown(0.6);
    }

    function drawItem(item) {
      ensureSpace(cardHeight + cardGap);

      const top = doc.y;
      const stock = Number(item.stock || 0);
      const minimum = reorderLevel(item);
      const amount = Math.max(0, minimum - stock);
      const unit = safeUnit(item);
      const x = left;

      doc
        .roundedRect(
          x,
          top,
          contentWidth,
          cardHeight,
          10
        )
        .fillAndStroke('#f8fafc', '#cbd5e1');

      doc
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(16)
        .text(
          String(item.name || 'Unavngivet vare'),
          x + 14,
          top + 12,
          {
            width: contentWidth - 190,
            height: 22,
            ellipsis: true
          }
        );

      doc
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(9)
        .text(
          `${item.cat || 'Uden kategori'} · senest opdateret ${fmtDateOnly(item.updatedAt)}`,
          x + 14,
          top + 36,
          {
            width: contentWidth - 190,
            height: 15,
            ellipsis: true
          }
        );

      const labelY = top + 58;
      const valueY = top + 72;
      const columnWidth = 104;

      const stats = [
        ['På lager', `${fmtQty(stock)} ${unit}`],
        ['Minimum', `${fmtQty(minimum)} ${unit}`],
        ['Skal købes', `${fmtQty(amount)} ${unit}`]
      ];

      stats.forEach(([label, value], index) => {
        const statX =
          x + 14 + index * columnWidth;

        doc
          .fillColor('#64748b')
          .font('Helvetica')
          .fontSize(8)
          .text(label, statX, labelY, {
            width: columnWidth - 8
          });

        doc
          .fillColor('#0f172a')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(value, statX, valueY, {
            width: columnWidth - 8
          });
      });

      doc
        .fillColor('#d97706')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(
          `Køb ${fmtQty(amount)} ${unit}`,
          x + contentWidth - 184,
          top + 34,
          {
            width: 168,
            align: 'right'
          }
        );

      doc.y = top + cardHeight + cardGap;
    }

    addHeader();

    if (list.length === 0) {
      doc
        .fillColor('#475569')
        .font('Helvetica')
        .fontSize(14)
        .text(
          'Ingen varer er under minimum lige nu.',
          left,
          doc.y,
          {
            width: contentWidth
          }
        );
    } else {
      let previousCategory = null;

      for (const item of list) {
        const category = String(
          item.cat || 'Uden kategori'
        );

        if (category !== previousCategory) {
          drawSectionHeading(category);
          previousCategory = category;
        }

        drawItem(item);
      }
    }

    const range = doc.bufferedPageRange();

    for (
      let index = range.start;
      index < range.start + range.count;
      index += 1
    ) {
      doc.switchToPage(index);

      doc
        .fillColor('#94a3b8')
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Side ${index + 1} af ${range.count}`,
          left,
          doc.page.height - 28,
          {
            width: contentWidth,
            align: 'right'
          }
        );
    }

    doc.end();
  });
}

const pdfBuffer =
  await createShoppingListPdf(lowItems);

const subject =
  `Indkøbsliste fra Sortiment liste – ${lowItems.length} varer`;

const text = [
  'Hej,',
  '',
  `Indkøbslisten for ${now} er vedhæftet som PDF.`,
  `PDF'en indeholder ${lowItems.length} varer, der er under minimum.`,
  `Udgåede varer er ignoreret: ${discontinuedItems.length}.`,
  '',
  'Mvh',
  'Sortiment liste'
].join('\n');

const port = Number(
  process.env.SMTP_PORT || 465
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

await transporter.verify();

await transporter.sendMail({
  from: process.env.EMAIL_FROM,
  to: process.env.EMAIL_TO,
  cc: process.env.EMAIL_CC || undefined,
  subject,
  text,
  attachments: [
    {
      filename:
        `indkoebsliste-${new Date()
          .toISOString()
          .slice(0, 10)}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }
  ]
});

console.log(
  `Sent low-stock PDF email to ${process.env.EMAIL_TO}. ` +
  `Low-stock items: ${lowItems.length}`
);
