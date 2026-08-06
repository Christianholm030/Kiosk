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
const DEFAULT_REORDER = Number(
  process.env.DEFAULT_REORDER || 2
);

const databaseUrl =
  process.env.FIREBASE_DATABASE_URL.replace(/\/$/, '');

const databaseAuth =
  process.env.FIREBASE_DATABASE_AUTH || '';

const inventoryUrl =
  new URL(`${databaseUrl}/inventory.json`);

if (databaseAuth) {
  inventoryUrl.searchParams.set(
    'auth',
    databaseAuth
  );
}

/**
 * Henter sortimentslisten fra Firebase.
 */
async function fetchInventory() {
  const response = await fetch(inventoryUrl);

  if (!response.ok) {
    const responseBody =
      await response.text();

    throw new Error(
      `Could not read Firebase inventory: ` +
      `${response.status} ${responseBody}`
    );
  }

  const inventory =
    await response.json();

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
 * En vare skal købes, når lageret er
 * lavere end minimumslageret.
 */
function isLowStock(item) {
  const stock =
    numberValue(item.stock);

  return (
    !isDiscontinued(item) &&
    stock < reorderLevel(item)
  );
}

/**
 * Den manuelle placering, der gemmes fra
 * Administration → Optællingsrækkefølge.
 */
function countOrderValue(item) {
  const order =
    Number(item.countOrder);

  return Number.isFinite(order)
    ? order
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Sorterer efter optællingsrækkefølgen.
 *
 * Navnet bruges kun som fallback, hvis en vare
 * ikke har fået en countOrder.
 */
function compareByCountOrder(a, b) {
  return (
    countOrderValue(a) -
      countOrderValue(b) ||
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
  const number =
    numberValue(value);

  return new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(number);
}

/**
 * Finder varens enhed.
 */
function unitText(item) {
  return (
    String(item.unit || 'stk').trim() ||
    'stk'
  );
}

/**
 * Dato til mail og PDF-overskrift.
 */
function formatCurrentDate() {
  return new Intl.DateTimeFormat(
    'da-DK',
    {
      timeZone: TIME_ZONE,
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }
  ).format(new Date());
}

/**
 * Dato til filnavnet.
 *
 * en-CA giver formatet YYYY-MM-DD.
 */
function fileDate() {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).format(new Date());
}

/**
 * Forkorter lange varenavne.
 */
function shortenText(
  value,
  maximumLength
) {
  const text =
    String(value || '');

  if (text.length <= maximumLength) {
    return text;
  }

  return (
    `${text.slice(
      0,
      maximumLength - 1
    )}…`
  );
}

/**
 * Opretter en enkel og printvenlig
 * indkøbsliste som PDF.
 *
 * Varerne modtages allerede sorteret
 * efter countOrder.
 */
function createShoppingListPdf(
  items,
  currentDate
) {
  return new Promise(
    (resolve, reject) => {
      const document =
        new PDFDocument({
          size: 'A4',

          margins: {
            top: 38,
            right: 38,
            bottom: 42,
            left: 38
          },

          bufferPages: true,

          info: {
            Title:
              'Indkøbsliste fra Sortiment liste',
            Author:
              'Sortiment liste',
            Subject:
              'Ugentlig indkøbsliste'
          }
        });

      const chunks = [];

      document.on(
        'data',
        chunk => {
          chunks.push(chunk);
        }
      );

      document.on(
        'end',
        () => {
          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      document.on(
        'error',
        error => {
          reject(error);
        }
      );

      const left =
        document.page.margins.left;

      const contentWidth =
        document.page.width -
        document.page.margins.left -
        document.page.margins.right;

      const pageBottom =
        document.page.height -
        document.page.margins.bottom;

      const rowHeight = 27;
      const categoryHeaderHeight = 28;
      const sectionSpacing = 13;

      const colors = {
        ink: '#111827',
        muted: '#64748b',
        faint: '#94a3b8',
        border: '#d7dee8',
        row: '#f8fafc',
        accent: '#d97706',
        category: '#e8edf5'
      };

      /**
       * Grupperer varerne efter kategori.
       *
       * Kategorierne vises i den rækkefølge,
       * de først optræder i countOrder-listen.
       */
      function groupItemsByCategory() {
        const groups = [];
        const groupMap = new Map();

        for (const item of items) {
          const category =
            String(
              item.cat ||
              'Uden kategori'
            ).trim() ||
            'Uden kategori';

          if (
            !groupMap.has(category)
          ) {
            const group = {
              category,
              items: []
            };

            groupMap.set(
              category,
              group
            );

            groups.push(group);
          }

          groupMap
            .get(category)
            .items
            .push(item);
        }

        return groups;
      }

      /**
       * Tegner sidens hovedoverskrift.
       */
      function drawHeader() {
        document
          .fillColor(colors.ink)
          .font('Helvetica-Bold')
          .fontSize(25)
          .text(
            'INDKØBSLISTE',
            left,
            document.page.margins.top,
            {
              width: contentWidth
            }
          );

        document
          .fillColor(colors.muted)
          .font('Helvetica')
          .fontSize(9.5)
          .text(
            `${currentDate}  ·  ` +
            `${items.length} varer`,
            left,
            document.page.margins.top +
              34,
            {
              width: contentWidth
            }
          );

        document
          .moveTo(
            left,
            document.page.margins.top +
              54
          )
          .lineTo(
            left + contentWidth,
            document.page.margins.top +
              54
          )
          .lineWidth(0.8)
          .strokeColor(colors.border)
          .stroke();

        document.y =
          document.page.margins.top +
          69;
      }

      /**
       * Starter en ny PDF-side.
       */
      function startNewPage() {
        document.addPage();
        drawHeader();
      }

      /**
       * Kontrollerer om der er plads
       * til næste element.
       */
      function ensureSpace(
        requiredHeight
      ) {
        if (
          document.y +
            requiredHeight >
          pageBottom
        ) {
          startNewPage();
        }
      }

      /**
       * Tegner kolonneoverskrifter.
       */
      function drawColumnLabels() {
        const top = document.y;

        document
          .fillColor(colors.faint)
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text(
            'VARE',
            left + 29,
            top,
            {
              width:
                contentWidth - 220
            }
          );

        document.text(
          'PÅ LAGER',
          left +
            contentWidth -
            187,
          top,
          {
            width: 80,
            align: 'right'
          }
        );

        document.text(
          'KØB',
          left +
            contentWidth -
            92,
          top,
          {
            width: 82,
            align: 'right'
          }
        );

        document.y =
          top + 15;
      }

      /**
       * Tegner en kategorioverskrift.
       */
      function drawCategoryHeader(
        category,
        count
      ) {
        ensureSpace(
          categoryHeaderHeight +
          rowHeight +
          sectionSpacing
        );

        const top =
          document.y;

        document
          .roundedRect(
            left,
            top,
            contentWidth,
            categoryHeaderHeight,
            6
          )
          .fill(colors.category);

        document
          .fillColor(colors.ink)
          .font('Helvetica-Bold')
          .fontSize(11.5)
          .text(
            category,
            left + 12,
            top + 8,
            {
              width:
                contentWidth - 95,
              height: 14,
              ellipsis: true
            }
          );

        document
          .fillColor(colors.muted)
          .font('Helvetica')
          .fontSize(8)
          .text(
            `${count} ${
              count === 1
                ? 'vare'
                : 'varer'
            }`,
            left +
              contentWidth -
              78,
            top + 9,
            {
              width: 66,
              align: 'right'
            }
          );

        document.y =
          top +
          categoryHeaderHeight +
          5;
      }

      /**
       * Tegner en tom afkrydsningsboks.
       */
      function drawCheckbox(x, y) {
        document
          .roundedRect(
            x,
            y,
            11,
            11,
            2
          )
          .lineWidth(0.8)
          .strokeColor(colors.faint)
          .stroke();
      }

      /**
       * Tegner én varelinje.
       */
      function drawItemRow(
        item,
        index
      ) {
        ensureSpace(rowHeight);

        const top =
          document.y;

        const stock =
          numberValue(item.stock);

        const minimum =
          reorderLevel(item);

        const amountToBuy =
          Math.max(
            0,
            minimum - stock
          );

        const unit =
          unitText(item);

        if (index % 2 === 0) {
          document
            .roundedRect(
              left,
              top,
              contentWidth,
              rowHeight,
              4
            )
            .fill(colors.row);
        }

        drawCheckbox(
          left + 9,
          top + 8
        );

        document
          .fillColor(colors.ink)
          .font('Helvetica')
          .fontSize(10)
          .text(
            shortenText(
              item.name ||
              'Unavngivet vare',
              62
            ),
            left + 29,
            top + 7,
            {
              width:
                contentWidth -
                235,
              height: 15,
              ellipsis: true
            }
          );

        document
          .fillColor(colors.muted)
          .font('Helvetica')
          .fontSize(9)
          .text(
            `${formatQuantity(
              stock
            )} ${unit}`,
            left +
              contentWidth -
              187,
            top + 8,
            {
              width: 80,
              align: 'right',
              height: 14,
              ellipsis: true
            }
          );

        document
          .fillColor(colors.accent)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            `${formatQuantity(
              amountToBuy
            )} ${unit}`,
            left +
              contentWidth -
              92,
            top + 7,
            {
              width: 82,
              align: 'right',
              height: 15,
              ellipsis: true
            }
          );

        document
          .moveTo(
            left + 29,
            top + rowHeight
          )
          .lineTo(
            left + contentWidth,
            top + rowHeight
          )
          .lineWidth(0.35)
          .strokeColor(colors.border)
          .stroke();

        document.y =
          top + rowHeight;
      }

      drawHeader();

      if (items.length === 0) {
        document
          .fillColor(colors.muted)
          .font('Helvetica')
          .fontSize(13)
          .text(
            'Ingen varer er under minimum lige nu.',
            left,
            document.y + 10,
            {
              width: contentWidth
            }
          );
      } else {
        const categoryGroups =
          groupItemsByCategory();

        categoryGroups.forEach(
          (
            group,
            groupIndex
          ) => {
            if (
              groupIndex > 0
            ) {
              document.y +=
                sectionSpacing;
            }

            drawCategoryHeader(
              group.category,
              group.items.length
            );

            drawColumnLabels();

            group.items.forEach(
              (
                item,
                itemIndex
              ) => {
                /*
                 * Hvis en kategori fortsætter
                 * på næste side, gentages
                 * kategorioverskriften.
                 */
                if (
                  document.y +
                    rowHeight >
                  pageBottom
                ) {
                  startNewPage();

                  drawCategoryHeader(
                    group.category,
                    group.items.length
                  );

                  drawColumnLabels();
                }

                drawItemRow(
                  item,
                  itemIndex
                );
              }
            );
          }
        );
      }

      /**
       * Tilføjer sidenumre.
       */
      const pageRange =
        document.bufferedPageRange();

      for (
        let pageIndex =
          pageRange.start;
        pageIndex <
        pageRange.start +
          pageRange.count;
        pageIndex += 1
      ) {
        document.switchToPage(
          pageIndex
        );

        document
          .fillColor(colors.faint)
          .font('Helvetica')
          .fontSize(8)
          .text(
            `Side ${
              pageIndex + 1
            } af ${
              pageRange.count
            }`,
            left,
            document.page.height -
              27,
            {
              width: contentWidth,
              align: 'right'
            }
          );
      }

      document.end();
    }
  );
}

/**
 * Hent og klargør data.
 */
const inventoryItems =
  await fetchInventory();

const activeItems =
  inventoryItems.filter(
    item =>
      !isDiscontinued(item)
  );

const discontinuedItems =
  inventoryItems.filter(
    isDiscontinued
  );

/**
 * Kun varer under minimum kommer med.
 * Derefter sorteres de efter countOrder.
 */
const lowStockItems =
  activeItems
    .filter(isLowStock)
    .sort(compareByCountOrder);

const currentDate =
  formatCurrentDate();

const pdfBuffer =
  await createShoppingListPdf(
    lowStockItems,
    currentDate
  );

/**
 * Mailens emne og tekst.
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

/**
 * Opretter SMTP-forbindelsen.
 */
const smtpPort =
  Number(
    process.env.SMTP_PORT ||
    465
  );

const transporter =
  nodemailer.createTransport({
    host:
      process.env.SMTP_HOST,

    port:
      smtpPort,

    /*
     * Port 465 bruger direkte TLS.
     * Port 587 bruger normalt STARTTLS.
     */
    secure:
      smtpPort === 465,

    auth: {
      user:
        process.env.SMTP_USER,

      pass:
        process.env.SMTP_PASS
    }
  });

/**
 * Kontrollerer forbindelsen
 * inden mailen sendes.
 */
await transporter.verify();

/**
 * Sender mailen med PDF'en
 * som vedhæftet fil.
 */
await transporter.sendMail({
  from:
    process.env.EMAIL_FROM,

  to:
    process.env.EMAIL_TO,

  cc:
    process.env.EMAIL_CC ||
    undefined,

  subject,
  text:
    mailText,

  attachments: [
    {
      filename:
        `indkoebsliste-${fileDate()}.pdf`,

      content:
        pdfBuffer,

      contentType:
        'application/pdf'
    }
  ]
});

console.log(
  `Sent low-stock PDF email to ` +
  `${process.env.EMAIL_TO}. ` +
  `Low-stock items: ` +
  `${lowStockItems.length}.`
);
