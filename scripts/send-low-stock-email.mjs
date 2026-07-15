import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

const REQUIRED_ENVIRONMENT_VARIABLES = [
  'FIREBASE_DATABASE_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
  'EMAIL_TO'
];

for (const key of REQUIRED_ENVIRONMENT_VARIABLES) {
  if (!process.env[key]) {
    throw new Error(
      `Missing required environment variable / GitHub secret: ${key}`
    );
  }
}

const TIME_ZONE = 'Europe/Copenhagen';
const DEFAULT_REORDER = Number(process.env.DEFAULT_REORDER || 2);

const databaseUrl =
  process.env.FIREBASE_DATABASE_URL.replace(/\/$/, '');

const databaseAuth =
  process.env.FIREBASE_DATABASE_AUTH || '';

const inventoryUrl =
  new URL(`${databaseUrl}/inventory.json`);

if (databaseAuth) {
  inventoryUrl.searchParams.set('auth', databaseAuth);
}

/**
 * Henter sortimentslisten fra Firebase.
 */
async function fetchInventory() {
  const response = await fetch(inventoryUrl);

  if (!response.ok) {
    const responseBody = await response.text();

    throw new Error(
      `Could not read Firebase inventory: ` +
      `${response.status} ${responseBody}`
    );
  }

  const inventory = await response.json();

  return Object.values(inventory || {});
}

/**
 * Konverterer en værdi til et gyldigt tal.
 */
function numberValue(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/**
 * Om varen er markeret som udgået.
 */
function isDiscontinued(item) {
  return Boolean(item.discontinued);
}

/**
 * Varens minimumslager.
 */
function reorderLevel(item) {
  return numberValue(
    item.reorder,
    DEFAULT_REORDER
  );
}

/**
 * En vare skal købes, når dens lager er lavere end minimum.
 */
function isLowStock(item) {
  const stock = numberValue(item.stock);

  return (
    !isDiscontinued(item) &&
    stock < reorderLevel(item)
  );
}

/**
 * Den manuelle placering, som gemmes fra
 * Administration → Optællingsrækkefølge.
 */
function countOrderValue(item) {
  const order = Number(item.countOrder);

  return Number.isFinite(order)
    ? order
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Sorteringen til PDF'en.
 *
 * Først anvendes countOrder, så PDF'en følger præcis
 * samme rækkefølge som optællingen.
 *
 * Navnet bruges kun som fallback for varer, der ikke
 * har fået en manuel countOrder endnu.
 */
function compareByCountOrder(a, b) {
  return (
    countOrderValue(a) - countOrderValue(b) ||
    String(a.name || '').localeCompare(
      String(b.name || ''),
      'da'
    )
  );
}

/**
 * Formaterer antal med dansk decimalkomma.
 */
function formatQuantity(value) {
  const number = numberValue(value);

  return new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(number);
}

/**
 * Formaterer enhed.
 */
function unitText(item) {
  return String(item.unit || 'stk').trim() || 'stk';
}

/**
 * Formaterer dato uden klokkeslæt.
 */
function formatDate(timestamp) {
  if (!timestamp) {
    return 'ukendt';
  }

  const date = new Date(Number(timestamp));

  if (Number.isNaN(date.getTime())) {
    return 'ukendt';
  }

  return new Intl.DateTimeFormat('da-DK', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

/**
 * Dato til mail og PDF-overskrift.
 */
function formatCurrentDate() {
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());
}

/**
 * Dato til filnavnet.
 *
 * en-CA giver formatet YYYY-MM-DD.
 */
function fileDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * Forkorter tekst, så den ikke løber ud af PDF-kortet.
 */
function shortenText(value, maximumLength) {
  const text = String(value || '');

  if (text.length <= maximumLength) {
    return text;
  }

  return `${text.slice(0, maximumLength - 1)}…`;
}

/**
 * Opretter PDF'en som en Buffer.
 *
 * Vigtigt:
 * Listen sorteres ikke inde i denne funktion.
 * Den tegnes direkte i den rækkefølge, den modtages i.
 */
function createShoppingListPdf(items, currentDate) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',

      margins: {
        top: 40,
        right: 36,
        bottom: 44,
        left: 36
      },

      bufferPages: true,

      info: {
        Title: 'Indkøbsliste fra Sortiment liste',
        Author: 'Sortiment liste',
        Subject: 'Ugentlig indkøbsliste'
      }
    });

    const chunks = [];

    document.on('data', chunk => {
      chunks.push(chunk);
    });

    document.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    document.on('error', error => {
      reject(error);
    });

    const pageWidth = document.page.width;

    const contentWidth =
      pageWidth -
      document.page.margins.left -
      document.page.margins.right;

    const left = document.page.margins.left;

    const pageBottom =
      document.page.height -
      document.page.margins.bottom;

    const cardHeight = 100;
    const cardSpacing = 10;

    /**
     * PDF-overskrift på hver side.
     */
    function drawHeader() {
      document
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(24)
        .text(
          'INDKØBSLISTE',
          left,
          document.page.margins.top,
          {
            width: contentWidth
          }
        );

      document
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(10)
        .text(
          `${currentDate} · ${items.length} varer skal købes`,
          left,
          document.page.margins.top + 34,
          {
            width: contentWidth
          }
        );

      document
        .moveTo(
          left,
          document.page.margins.top + 55
        )
        .lineTo(
          left + contentWidth,
          document.page.margins.top + 55
        )
        .lineWidth(0.8)
        .strokeColor('#cbd5e1')
        .stroke();

      document.y =
        document.page.margins.top + 70;
    }

    /**
     * Starter en ny side, når der ikke er plads
     * til et helt varekort.
     */
    function ensureCardFits() {
      if (
        document.y +
        cardHeight +
        cardSpacing >
        pageBottom
      ) {
        document.addPage();
        drawHeader();
      }
    }

    /**
     * Tegner ét varekort.
     */
    function drawItemCard(item, position) {
      ensureCardFits();

      const cardTop = document.y;
      const stock = numberValue(item.stock);
      const minimum = reorderLevel(item);

      const amountToBuy =
        Math.max(0, minimum - stock);

      const unit = unitText(item);

      const cardLeft = left;
      const rightColumnWidth = 160;

      const informationWidth =
        contentWidth -
        rightColumnWidth -
        30;

      /*
       * Kortets baggrund og kant.
       */
      document
        .roundedRect(
          cardLeft,
          cardTop,
          contentWidth,
          cardHeight,
          10
        )
        .fillAndStroke(
          '#f8fafc',
          '#cbd5e1'
        );

      /*
       * Varenavn.
       */
      document
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(16)
        .text(
          shortenText(
            item.name || 'Unavngivet vare',
            55
          ),
          cardLeft + 14,
          cardTop + 12,
          {
            width: informationWidth,
            height: 22,
            ellipsis: true
          }
        );

      /*
       * Kategori og seneste opdatering.
       */
      const category =
        item.cat || 'Uden kategori';

      document
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(9)
        .text(
          `${category} · senest opdateret ${formatDate(item.updatedAt)}`,
          cardLeft + 14,
          cardTop + 36,
          {
            width: informationWidth,
            height: 14,
            ellipsis: true
          }
        );

      /*
       * Lille placering/rækkefølge.
       */
      document
        .fillColor('#94a3b8')
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Placering i optælling: ${position}`,
          cardLeft + 14,
          cardTop + 52,
          {
            width: informationWidth
          }
        );

      /*
       * Lagerfelter.
       */
      const statsTop = cardTop + 68;
      const statsColumnWidth = 108;

      const statistics = [
        {
          label: 'På lager',
          value: `${formatQuantity(stock)} ${unit}`
        },
        {
          label: 'Minimum',
          value: `${formatQuantity(minimum)} ${unit}`
        },
        {
          label: 'Skal købes',
          value: `${formatQuantity(amountToBuy)} ${unit}`
        }
      ];

      statistics.forEach((statistic, index) => {
        const statisticLeft =
          cardLeft +
          14 +
          index * statsColumnWidth;

        document
          .fillColor('#64748b')
          .font('Helvetica')
          .fontSize(8)
          .text(
            statistic.label,
            statisticLeft,
            statsTop,
            {
              width: statsColumnWidth - 8
            }
          );

        document
          .fillColor('#0f172a')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(
            statistic.value,
            statisticLeft,
            statsTop + 13,
            {
              width: statsColumnWidth - 8,
              height: 16,
              ellipsis: true
            }
          );
      });

      /*
       * Stor købsmængde i højre side.
       */
      document
        .fillColor('#d97706')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(
          `Køb ${formatQuantity(amountToBuy)} ${unit}`,
          cardLeft +
            contentWidth -
            rightColumnWidth -
            14,
          cardTop + 35,
          {
            width: rightColumnWidth,
            align: 'right',
            height: 50,
            ellipsis: true
          }
        );

      document.y =
        cardTop +
        cardHeight +
        cardSpacing;
    }

    drawHeader();

    if (items.length === 0) {
      document
        .fillColor('#475569')
        .font('Helvetica')
        .fontSize(14)
        .text(
          'Ingen varer er under minimum lige nu.',
          left,
          document.y,
          {
            width: contentWidth
          }
        );
    } else {
      /*
       * Ingen gruppering og ingen ny sortering.
       *
       * Varerne tegnes direkte i countOrder-rækkefølgen.
       * Varer, der ikke mangler, er allerede filtreret væk.
       */
      items.forEach((item, index) => {
        drawItemCard(item, index + 1);
      });
    }

    /*
     * Sidenumre.
     */
    const pageRange =
      document.bufferedPageRange();

    for (
      let pageIndex = pageRange.start;
      pageIndex <
      pageRange.start + pageRange.count;
      pageIndex += 1
    ) {
      document.switchToPage(pageIndex);

      document
        .fillColor('#94a3b8')
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Side ${pageIndex + 1} af ${pageRange.count}`,
          left,
          document.page.height - 27,
          {
            width: contentWidth,
            align: 'right'
          }
        );
    }

    document.end();
  });
}

/*
 * Hent og klargør data.
 */
const inventoryItems =
  await fetchInventory();

const activeItems =
  inventoryItems.filter(
    item => !isDiscontinued(item)
  );

const discontinuedItems =
  inventoryItems.filter(isDiscontinued);

/*
 * Det er denne kæde, der sikrer:
 *
 * 1. Kun varer under minimum kommer med.
 * 2. Rækkefølgen følger countOrder fra optællingen.
 */
const lowStockItems = activeItems
  .filter(isLowStock)
  .sort(compareByCountOrder);

const currentDate =
  formatCurrentDate();

const pdfBuffer =
  await createShoppingListPdf(
    lowStockItems,
    currentDate
  );

/*
 * Kort mailtekst. Selve listen ligger i PDF'en.
 */
const subject =
  `Indkøbsliste fra Sortiment liste – ` +
  `${lowStockItems.length} varer`;

const mailText = [
  'Hej,',
  '',
  `Indkøbslisten for ${currentDate} er vedhæftet som PDF.`,
  '',
  `PDF'en indeholder ${lowStockItems.length} varer, der er under minimum.`,
  `Udgåede varer er ignoreret: ${discontinuedItems.length}.`,
  '',
  'Varerne i PDF’en står i samme rækkefølge som under optællingen.',
  '',
  'Mvh',
  'Sortiment liste'
].join('\n');

/*
 * Mailforbindelse.
 */
const smtpPort =
  Number(process.env.SMTP_PORT || 465);

const transporter =
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,

    /*
     * Port 465 bruger normalt direkte TLS.
     * Port 587 starter normalt uden secure og
     * opgraderer efterfølgende med STARTTLS.
     */
    secure: smtpPort === 465,

    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

/*
 * Test forbindelsen inden afsendelse.
 */
await transporter.verify();

/*
 * Send mail med PDF som vedhæftet fil.
 */
await transporter.sendMail({
  from: process.env.EMAIL_FROM,
  to: process.env.EMAIL_TO,
  cc: process.env.EMAIL_CC || undefined,

  subject,
  text: mailText,

  attachments: [
    {
      filename:
        `indkoebsliste-${fileDate()}.pdf`,

      content: pdfBuffer,
      contentType: 'application/pdf'
    }
  ]
});

console.log(
  `Sent low-stock PDF email to ` +
  `${process.env.EMAIL_TO}. ` +
  `Low-stock items: ${lowStockItems.length}.`
);
