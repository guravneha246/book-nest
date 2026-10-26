import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';

export function isGeminiConfigured(): boolean {
  const rawKey = process.env.GEMINI_API_KEY || config.geminiApiKey;
  if (!rawKey) return false;
  const key = rawKey.trim().replace(/^["']|["']$/g, '');
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

export function getGeminiClient(): GoogleGenAI | null {
  const rawKey = process.env.GEMINI_API_KEY || config.geminiApiKey;
  if (!rawKey) return null;
  const key = rawKey.trim().replace(/^["']|["']$/g, '');
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({ apiKey: key });
}

// Retain exported instance for backward compatibility
export const ai = isGeminiConfigured() ? getGeminiClient() : null;

export interface ExtractedBookMetadata {
  title?: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  rawTextLines: string[];
  isBook: boolean;
  hasOcrData: boolean;
  textUnclear: boolean;
  notes?: string;
}

/**
 * Analyzes a book cover image base64 data to extract title, author, publisher, and ISBN.
 * Strictly extracts real visible text without hallucination.
 * Prioritizes front cover title + author extraction when barcode/ISBN is not present.
 */
export async function analyzeBookCover(
  imageBase64: string,
  mimeType = 'image/jpeg'
): Promise<ExtractedBookMetadata | null> {
  const client = getGeminiClient();
  if (!client) {
    return null;
  }

  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, '');

    const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'];
    let response: any = null;
    let lastError: any = null;

    for (const model of candidateModels) {
      try {
        response = await client.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `You are a high-precision optical book scanner and OCR analyzer.
Inspect this image carefully. Extract ONLY real text and barcodes actually visible in this image.
Do NOT guess, invent, or hallucinate titles, authors, or ISBNs.
Books are often photographed from the front cover, spine, or back cover. Front covers typically do NOT display an ISBN barcode — that is expected. Focus heavily on legibly extracting the prominent title and author from the front cover.

Return a valid JSON object matching this schema:
{
  "title": string or null (the prominent book title if legible),
  "author": string or null (author or authors if visible),
  "publisher": string or null (publisher name or imprint if visible),
  "isbn": string or null (10 or 13 digit barcode/ISBN numbers if visible, no hyphens or spaces),
  "rawTextLines": array of string (prominent visible text lines in reading order),
  "isBook": boolean (true if image depicts a book cover, spine, textbook, or book barcode; false if not a book),
  "textUnclear": boolean (true if image depicts a book but text is blurry, dark, occluded, or unreadable; false if legible),
  "notes": string or null (brief notes about extraction confidence, e.g. "Title clearly readable from front cover; ISBN not present")
}

Output ONLY the raw JSON object. Do not wrap in markdown tags or add conversational text.`
                },
                {
                  inlineData: {
                    data: cleanBase64,
                    mimeType
                  }
                }
              ]
            }
          ]
        });
        if (response && response.text) {
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Gemini model ${model} unavailable, trying fallback:`, err?.message || err);
      }
    }

    if (!response || !response.text) {
      console.error('All Gemini models failed:', lastError);
      return null;
    }

    const rawText = response.text || '';
    const cleanJsonText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const title = parsed.title ? String(parsed.title).trim() : undefined;
    const author = parsed.author ? String(parsed.author).trim() : undefined;
    const publisher = parsed.publisher ? String(parsed.publisher).trim() : undefined;
    const rawIsbn = parsed.isbn ? String(parsed.isbn).replace(/[^0-9X]/gi, '') : undefined;
    const isbn = rawIsbn && rawIsbn.length >= 9 ? rawIsbn : undefined;
    const rawTextLines = Array.isArray(parsed.rawTextLines)
      ? parsed.rawTextLines.map((l: any) => String(l).trim()).filter(Boolean)
      : [];
    const isBook = parsed.isBook !== false;
    const textUnclear = Boolean(parsed.textUnclear || (!title && !isbn && isBook && rawTextLines.length === 0));
    const hasOcrData = Boolean(
      (title && title.length > 1) ||
      (author && author.length > 1) ||
      (isbn && isbn.length >= 9) ||
      rawTextLines.length > 0
    );

    return {
      title,
      author,
      publisher,
      isbn,
      rawTextLines,
      isBook,
      hasOcrData,
      textUnclear,
      notes: parsed.notes ? String(parsed.notes).trim() : (!isBook ? 'Image does not appear to be a book or textbook.' : undefined)
    };
  } catch (err) {
    console.error('Gemini vision analysis error:', err);
    return null;
  }
}
