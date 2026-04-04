import { Tool } from './Tool.js';
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

/**
 * ReportTool: Independent document engineer.
 * Generates professional PDF reports from Markdown and structured data in the workspace.
 *
 * Note: Uses pdf-lib StandardFonts (WinAnsi only). Non-Latin characters (CJK, emoji)
 * are replaced with '?' placeholders. For full Unicode support, a custom font embedding
 * approach with @pdf-lib/fontkit would be required.
 */
export class ReportTool extends Tool {
  constructor() {
    super({
      name: 'ReportTool',
      description:
        'Generate a professional PDF report from Markdown content and structured data. Automatically formats text, headers, and metadata. Note: Only Latin characters are fully supported; CJK/emoji characters will be replaced with placeholders. For CJK reports, consider generating Markdown files instead.',
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
      const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      const timesBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

      // Track whether any non-Latin characters were encountered
      let containedNonLatin = false;

      /** Safely draw text with WinAnsi sanitization */
      const safeDrawText = (page, text, options) => {
        const { text: safe, hadUnsupported } = sanitizeForWinAnsi(text);
        if (hadUnsupported) containedNonLatin = true;
        page.drawText(safe, options);
      };

      /** Safely measure text width with WinAnsi sanitization */
      const safeWidthOfText = (font, text, size) => {
        const { text: safe } = sanitizeForWinAnsi(text);
        return font.widthOfTextAtSize(safe, size);
      };

      // Add a page
      let page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      let yPosition = height - 50;

      // Draw Title
      safeDrawText(page, title, {
        x: 50,
        y: yPosition,
        size: 24,
        font: timesBoldFont,
        color: rgb(0, 0, 0.5),
      });
      yPosition -= 40;

      // Draw Author & Date
      safeDrawText(page, `Author: ${author} | Date: ${new Date().toLocaleDateString()}`, {
        x: 50,
        y: yPosition,
        size: 10,
        font: timesRomanFont,
        color: rgb(0.3, 0.3, 0.3),
      });
      yPosition -= 40;

      // Simple Text-based Markdown Parser (Naive version for pure-JS implementation)
      const lines = content.split('\n');
      for (const line of lines) {
        if (yPosition < 50) {
          page = pdfDoc.addPage();
          yPosition = height - 50;
        }

        if (line.startsWith('# ')) {
          safeDrawText(page, line.substring(2), {
            x: 50,
            y: yPosition,
            size: 18,
            font: timesBoldFont,
          });
          yPosition -= 25;
        } else if (line.startsWith('## ')) {
          safeDrawText(page, line.substring(3), {
            x: 50,
            y: yPosition,
            size: 14,
            font: timesBoldFont,
          });
          yPosition -= 20;
        } else {
          // Break long lines into chunks
          const maxWidth = width - 100;
          const words = line.split(' ');
          let currentLine = '';

          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const textWidth = safeWidthOfText(timesRomanFont, testLine, 11);

            if (textWidth > maxWidth) {
              safeDrawText(page, currentLine, {
                x: 50,
                y: yPosition,
                size: 11,
                font: timesRomanFont,
              });
              yPosition -= 15;
              currentLine = word;

              if (yPosition < 50) {
                page = pdfDoc.addPage();
                yPosition = height - 50;
              }
            } else {
              currentLine = testLine;
            }
          }

          if (currentLine) {
            safeDrawText(page, currentLine, {
              x: 50,
              y: yPosition,
              size: 11,
              font: timesRomanFont,
            });
            yPosition -= 15;
          }
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
      ];

      if (containedNonLatin) {
        resultLines.push(
          ``,
          `[Warning] Some non-Latin characters (e.g., CJK, emoji) were replaced with '?' placeholders.`,
          `The PDF engine currently uses standard fonts that only support Latin characters.`,
          `For full CJK content, consider generating a Markdown (.md) or plain text (.txt) file instead.`,
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
