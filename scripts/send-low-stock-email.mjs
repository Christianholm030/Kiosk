from pathlib import Path
import re

src = Path("/mnt/data/Indsatte tekst (2).txt")
text = src.read_text(encoding="utf-8")

new_function = r'''
/**
 * Opretter en enkel og printvenlig indkøbsliste som PDF.
 *
 * Varerne er allerede sorteret efter countOrder.
 * Kategorierne vises derfor i samme rækkefølge som under optællingen,
 * og varerne beholder deres interne optællingsrækkefølge.
 */
function createShoppingListPdf(items, currentDate) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',

      margins: {
        top: 38,
        right: 38,
        bottom: 42,
        left: 38
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

    const left = document.page.margins.left;

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

    /*
     * Farver holdes afdæmpede, så PDF'en både ser godt ud
     * på skærm og er let at printe.
     */
    const colors = {
      ink: '#111827',
      muted: '#64748b',
      faint: '#94a3b8',
      border: '#d7dee8',
      row: '#f8fafc',
      accent: '#d97706',
      category: '#e8edf5',
      white: '#ffffff'
    };

    /*
     * Grupperer i den rækkefølge kategorierne først optræder.
     * Da items allerede er sorteret efter countOrder, følger både
     * kategorier og varer optællingsrækkefølgen.
     */
    function groupItemsByCategory() {
      const groups = [];
      const groupMap = new Map();

      for (const item of items) {
        const category =
          String(item.cat || 'Uden kategori').trim() ||
          'Uden kategori';

        if (!groupMap.has(category)) {
          const group = {
            category,
            items: []
          };

          groupMap.set(category, group);
          groups.push(group);
        }

        groupMap.get(category).items.push(item);
      }

      return groups;
    }

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
          `${currentDate}  ·  ${items.length} varer`,
          left,
          document.page.margins.top + 34,
          {
            width: contentWidth
          }
        );

      document
        .moveTo(
          left,
          document.page.margins.top + 54
        )
        .lineTo(
          left + contentWidth,
          document.page.margins.top + 54
        )
        .lineWidth(0.8)
        .strokeColor(colors.border)
        .stroke();

      document.y =
        document.page.margins.top + 69;
    }

    function startNewPage() {
      document.addPage();
      drawHeader();
    }

    function ensureSpace(requiredHeight) {
      if (document.y + requiredHeight > pageBottom) {
        startNewPage();
      }
    }

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
            width: contentWidth - 220
          }
        );

      document.text(
        'PÅ LAGER',
        left + contentWidth - 187,
        top,
        {
          width: 80,
          align: 'right'
        }
      );

      document.text(
        'KØB',
        left + contentWidth - 92,
        top,
        {
          width: 82,
          align: 'right'
        }
      );

      document.y = top + 15;
    }

    function drawCategoryHeader(category, count) {
      ensureSpace(
        categoryHeaderHeight +
        rowHeight +
        sectionSpacing
      );

      const top = document.y;

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
            width: contentWidth - 95,
            height: 14,
            ellipsis: true
          }
        );

      document
        .fillColor(colors.muted)
        .font('Helvetica')
        .fontSize(8)
        .text(
          `${count} ${count === 1 ? 'vare' : 'varer'}`,
          left + contentWidth - 78,
          top + 9,
          {
            width: 66,
            align: 'right'
          }
        );

      document.y =
        top + categoryHeaderHeight + 5;
    }

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

    function drawItemRow(item, index) {
      ensureSpace(rowHeight);

      const top = document.y;
      const stock = numberValue(item.stock);
      const minimum = reorderLevel(item);

      const amountToBuy =
        Math.max(0, minimum - stock);

      const unit = unitText(item);

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
            item.name || 'Unavngivet vare',
            62
          ),
          left + 29,
          top + 7,
          {
            width: contentWidth - 235,
            height: 15,
            ellipsis: true
          }
        );

      document
        .fillColor(colors.muted)
        .font('Helvetica')
        .fontSize(9)
        .text(
          `${formatQuantity(stock)} ${unit}`,
          left + contentWidth - 187,
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
          `${formatQuantity(amountToBuy)} ${unit}`,
          left + contentWidth - 92,
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

      categoryGroups.forEach((group, groupIndex) => {
        if (groupIndex > 0) {
          document.y += sectionSpacing;
        }

        drawCategoryHeader(
          group.category,
          group.items.length
        );

        drawColumnLabels();

        group.items.forEach((item, itemIndex) => {
          /*
           * Hvis sideskiftet sker midt i en kategori,
           * gentages kategorioverskrift og kolonnenavne.
           */
          if (
            document.y + rowHeight >
            pageBottom
          ) {
            startNewPage();

            drawCategoryHeader(
              group.category,
              group.items.length
            );

            drawColumnLabels();
          }

          drawItemRow(item, itemIndex);
        });
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
        .fillColor(colors.faint)
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
'''

pattern = re.compile(
    r"/\*\*\n \* Opretter PDF'en som en Buffer\.[\s\S]*?\n}\n\n/\*\n \* Hent og klargør data\.",
    re.MULTILINE
)

replacement = new_function + "\n\n/*\n * Hent og klargør data."

new_text, count = pattern.subn(replacement, text, count=1)

if count != 1:
    raise RuntimeError(f"Kunne ikke erstatte PDF-funktionen. Antal matches: {count}")

out = Path("/mnt/data/send-low-stock-email-stilren.mjs")
out.write_text(new_text, encoding="utf-8")

print(f"Oprettet: {out}")
print(f"Linjer: {len(new_text.splitlines())}")
