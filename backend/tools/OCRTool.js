import { Tool } from './Tool.js';
import { createWorker } from 'tesseract.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * OCRTool: Local image-to-text conversion worker.
 * Supports multiple languages (default English) and runs entirely locally.
 */
export class OCRTool extends Tool {
  constructor() {
    super({
      name: 'OCRTool',
      description:
        'Extract text and structured data from local images (JPG, PNG, TIFF). Perfect for analyzing screenshots or scanned documents in the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          imagePath: {
            type: 'string',
            description: 'The name or path of the image file in the workspace.',
          },
          language: {
            type: 'string',
            description:
              'The language for text recognition (e.g., "eng", "chi_sim"). Default is "eng".',
            default: 'eng',
          },
        },
        required: ['imagePath'],
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { imagePath, language = 'eng' } = input;
    const { userWorkspace } = context;

    if (!userWorkspace) {
      throw new Error('OCR Context Error: Missing userWorkspace path.');
    }

    try {
      const safePath = path.join(userWorkspace, path.basename(imagePath));

      // Check if file exists
      await fs.access(safePath);

      // Create Tesseract Worker (Running in the background)
      const worker = await createWorker(language);

      try {
        const {
          data: { text, confidence },
        } = await worker.recognize(safePath);
        return {
          content: [
            {
              type: 'text',
              text: `[OCR Output - Confidence: ${confidence}%]\n\nEXTRACTED_TEXT:\n${text}`,
            },
          ],
          isError: false,
        };
      } finally {
        await worker.terminate();
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `[OCR Execution Error]\n${err.message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
