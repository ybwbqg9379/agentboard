import { Tool } from './Tool.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import path from 'path';
import fs from 'fs/promises';

/**
 * Sanitize text for WinAnsi-compatible StandardFonts.
 * pdf-lib's StandardFonts (TimesRoman, Helvetica, etc.) only support WinAnsi
 * encoding (Latin-1 + Windows-1252). CJK/emoji characters will throw
 * "WinAnsi cannot encode ...".
 *
 * Strategy: Replace unsupported characters with '?' and track whether any
 * substitutions occurred so the caller can warn the user.
 */
function sanitizeForWinAnsi(text) {
  let hadUnsupported = false;
  // WinAnsi covers U+0000–U+00FF (Latin-1) plus ~30 Windows-1252 extras in 0x80–0x9F.
  // Characters outside this range cannot be encoded by StandardFonts.
  // eslint-disable-next-line no-control-regex -- intentionally matching control chars for WinAnsi range
  const sanitized = text.replace(/[^\u0000-\u00FF]/g, () => {
    hadUnsupported = true;
    return '?';
  });
  return { text: sanitized, hadUnsupported };
}

const UNICODE_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/arphic/ukai.ttc',
];

async function findUnicodeFontPath() {
  const explicitFontPath = process.env.AGENTBOARD_PDF_FONT?.trim();
  const candidates = explicitFontPath ? [explicitFontPath] : UNICODE_FONT_CANDIDATES;

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function wrapTextToWidth(text, measureText, fontSize, maxWidth) {
  if (!text) return [''];

  const lines = [];
  let currentLine = '';

  for (const char of Array.from(text.replace(/\t/g, '    '))) {
    const nextLine = currentLine + char;
    if (currentLine && measureText(nextLine, fontSize) > maxWidth) {
      lines.push(currentLine.trimEnd());
      currentLine = /^\s$/u.test(char) ? '' : char;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine || lines.length === 0) {
    lines.push(currentLine.trimEnd());
  }

  return lines;
}

async function createTextRuntime(pdfDoc) {
  const unicodeFontPath = await findUnicodeFontPath();

  if (unicodeFontPath) {
    try {
      pdfDoc.registerFontkit(fontkit);
      const fontBytes = await fs.readFile(unicodeFontPath);
      const unicodeFont = await pdfDoc.embedFont(fontBytes, { subset: true });

      return {
        regularFont: unicodeFont,
        boldFont: unicodeFont,
        isUnicodeFont: true,
        fontLabel: path.basename(unicodeFontPath),
        drawText(page, text, options) {
          page.drawText(text, options);
        },
        measureText(font, text, size) {
          return font.widthOfTextAtSize(text, size);
        },
      };
    } catch {
      // Fall through to the StandardFonts fallback.
    }
  }

  const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  let containedUnsupported = false;

  return {
    regularFont: timesRomanFont,
    boldFont: timesBoldFont,
    isUnicodeFont: false,
    fontLabel: 'TimesRoman',
    get containedUnsupported() {
      return containedUnsupported;
    },
    drawText(page, text, options) {
      const { text: safe, hadUnsupported } = sanitizeForWinAnsi(text);
      if (hadUnsupported) containedUnsupported = true;
      page.drawText(safe, options);
    },
    measureText(font, text, size) {
      const { text: safe } = sanitizeForWinAnsi(text);
      return font.widthOfTextAtSize(safe, size);
    },
  };
}

/**
 * ReportTool: Independent document engineer.
 * Generates professional PDF reports from Markdown and structured data in the workspace.
 *
 * Note: Prefers embedding a configured or auto-detected Unicode font for full CJK output.
 * If no usable Unicode font is available, it falls back to pdf-lib StandardFonts (WinAnsi)
 * and replaces unsupported characters with '?' placeholders while surfacing a warning.
 */
export class ReportTool extends Tool {
  constructor() {
    super({
      name: 'ReportTool',
      description:
        'Generate a professional PDF report from Markdown content and structured data. Automatically formats text, headers, and metadata. Prefers a Unicode font for full CJK output and falls back to StandardFonts with an explicit warning when no Unicode font is available.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The main Markdown content for the report.',
          },
          title: {
            type: 'string',
            description: 'The report title.',
          },
          fileName: {
            type: 'string',
            description: 'The output PDF file name (e.g., "Market_Research_2025.pdf").',
          },
          author: {
            type: 'string',
            description: 'The author of the report.',
          },
        },
        required: ['content', 'title', 'fileName'],
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { content, title, fileName, author = 'AgentBoard Research AI' } = input;
    const { userWorkspace } = context;

    if (!userWorkspace) {
      throw new Error('Report Context Error: Missing userWorkspace path.');
    }

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      throw new Error('Report Tool Error: Only .pdf extension is allowed.');
    }

    try {
      // Create a new PDF document
      const pdfDoc = await PDFDocument.create();
      const textRuntime = await createTextRuntime(pdfDoc);

      // Add a page
      let page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      let yPosition = height - 50;
      const maxWidth = width - 100;

      const drawWrappedBlock = (text, size, font, lineHeight, color = rgb(0, 0, 0)) => {
        const lines = wrapTextToWidth(
          text,
          (candidate, fontSize) => textRuntime.measureText(font, candidate, fontSize),
          size,
          maxWidth,
        );

        for (const line of lines) {
          if (yPosition < 50) {
            page = pdfDoc.addPage();
            yPosition = height - 50;
          }

          textRuntime.drawText(page, line, {
            x: 50,
            y: yPosition,
            size,
            font,
            color,
          });
          yPosition -= lineHeight;
        }
      };

      // Draw Title
      drawWrappedBlock(title, 24, textRuntime.boldFont, 28, rgb(0, 0, 0.5));
      yPosition -= 40;

      // Draw Author & Date
      drawWrappedBlock(
        `Author: ${author} | Date: ${new Date().toLocaleDateString()}`,
        10,
        textRuntime.regularFont,
        14,
        rgb(0.3, 0.3, 0.3),
      );
      yPosition -= 40;

      // Simple Text-based Markdown Parser (Naive version for pure-JS implementation)
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.startsWith('# ')) {
          drawWrappedBlock(line.substring(2), 18, textRuntime.boldFont, 24);
        } else if (line.startsWith('## ')) {
          drawWrappedBlock(line.substring(3), 14, textRuntime.boldFont, 20);
        } else if (line.trim() === '') {
          yPosition -= 10;
        } else {
          drawWrappedBlock(line, 11, textRuntime.regularFont, 15);
        }
      }

      // Finalize the PDF
      const pdfBytes = await pdfDoc.save();
      const safePath = path.join(userWorkspace, path.basename(fileName));
      await fs.writeFile(safePath, pdfBytes);

      const resultLines = [
        `[Report Generated Successfully]`,
        `File: ${fileName}`,
        `Location: ${safePath}`,
        `Pages: ${pdfDoc.getPageCount()}`,
        `Font: ${textRuntime.fontLabel}`,
      ];

      if (!textRuntime.isUnicodeFont && textRuntime.containedUnsupported) {
        resultLines.push(
          ``,
          `[Warning] Some non-Latin characters (e.g., CJK, emoji) were replaced with '?' placeholders.`,
          `The PDF engine currently uses standard fonts that only support Latin characters.`,
          `Set AGENTBOARD_PDF_FONT to a Unicode .ttf/.otf font to render full CJK content.`,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: resultLines.join('\n'),
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `[Report Generation Failure]\n${err.message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
