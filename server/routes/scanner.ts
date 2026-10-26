import { Router } from 'express';
import { db } from '../db/database.js';
import { config } from '../config/index.js';
import { isGeminiConfigured, analyzeBookCover } from '../services/gemini.js';
import {
  normalizeIsbn,
  isValidIsbn,
  matchBookAgainstCatalog,
  MatchResult
} from '../services/scannerMatcher.js';
import { scannerLimiter } from '../middleware/rateLimiter.js';

const router = Router();

function getFullCatalog(): any[] {
  return db.prepare(`
    SELECT 
      b.id, b.title, a.name as author, c.name as category, c.slug as categorySlug,
      b.price, b.discount, b.rating, b.stock, b.cover_image as coverImage,
      b.isbn, b.publisher, b.pages, b.publication_year as year, b.language, b.description
    FROM books b
    JOIN authors a ON b.author_id = a.id
    JOIN categories c ON b.category_id = c.id
    WHERE (b.is_archived IS NULL OR b.is_archived = 0)
  `).all();
}

export type ExternalIsbnLookupHandler = (cleanIsbn: string) => Promise<any | null>;
export type ExternalSearchHandler = (title: string, author?: string) => Promise<any | null>;
export type VisionAnalysisHandler = (imageBase64: string, mimeType: string) => Promise<any | null>;

let externalIsbnLookupHandler: ExternalIsbnLookupHandler = lookupOpenLibraryByIsbn;
let externalSearchHandler: ExternalSearchHandler = searchOpenLibraryByTitleAuthor;
let visionAnalysisHandler: VisionAnalysisHandler = analyzeBookCover;

export function setExternalLookupProvider(handlers?: {
  lookupByIsbn?: ExternalIsbnLookupHandler;
  searchByTitleAuthor?: ExternalSearchHandler;
}) {
  externalIsbnLookupHandler = handlers?.lookupByIsbn || lookupOpenLibraryByIsbn;
  externalSearchHandler = handlers?.searchByTitleAuthor || searchOpenLibraryByTitleAuthor;
}

export function setVisionAnalysisProvider(handler?: VisionAnalysisHandler) {
  visionAnalysisHandler = handler || analyzeBookCover;
}

/**
 * Searches OpenLibrary by ISBN.
 * Returns genuine metadata without fabricating prices, ratings, or publishers.
 */
async function lookupOpenLibraryByIsbn(cleanIsbn: string): Promise<any | null> {
  try {
    const openLibUrl = `${config.openLibraryBaseUrl}?bibkeys=ISBN:${cleanIsbn}&format=json&jscmd=data`;
    const openLibRes = await fetch(openLibUrl, { signal: AbortSignal.timeout(4000) });

    if (openLibRes.ok) {
      const data = await openLibRes.json();
      const bookData = data[`ISBN:${cleanIsbn}`];

      if (bookData) {
        return {
          id: -1, // Non-catalog flag
          title: bookData.title || 'Untitled Book',
          author: Array.isArray(bookData.authors)
            ? bookData.authors.map((a: any) => a.name).join(', ')
            : 'Unknown Author',
          isbn: cleanIsbn,
          category: bookData.subjects?.[0]?.name || 'General Literature',
          categorySlug: 'general',
          publisher: bookData.publishers?.[0]?.name || '',
          pages: bookData.number_of_pages || 0,
          year: bookData.publish_date ? parseInt(bookData.publish_date.slice(-4), 10) || 0 : 0,
          language: 'English',
          coverImage: bookData.cover?.large || bookData.cover?.medium || '',
          price: 0, // Honest: 0 indicates unavailable/external, never fabricated
          discount: 0,
          stock: 0, // Clearly marked: not in local warehouse
          rating: 0, // Not fabricated
          description: typeof bookData.notes === 'string'
            ? bookData.notes
            : (typeof bookData.subtitle === 'string'
              ? bookData.subtitle
              : `External publication found via OpenLibrary archive for ISBN ${cleanIsbn}. Currently not stocked in campus warehouse.`),
          isLocalCatalog: false
        };
      }
    }
  } catch (extErr) {
    // OpenLibrary lookup timed out or network error
  }
  return null;
}

/**
 * Searches OpenLibrary by title and author when local catalog has no match.
 */
async function searchOpenLibraryByTitleAuthor(title: string, author?: string): Promise<any | null> {
  if (!title || title.trim().length < 3) return null;
  try {
    const query = new URLSearchParams({
      title: title.trim(),
      limit: '1'
    });
    if (author && author.trim()) {
      query.set('author', author.trim());
    }

    const openLibUrl = `${config.openLibrarySearchUrl}?${query.toString()}`;
    const openLibRes = await fetch(openLibUrl, { signal: AbortSignal.timeout(4000) });

    if (openLibRes.ok) {
      const data = await openLibRes.json();
      if (Array.isArray(data.docs) && data.docs.length > 0) {
        const doc = data.docs[0];
        const coverId = doc.cover_i;
        const isbn = Array.isArray(doc.isbn) && doc.isbn.length > 0 ? doc.isbn[0] : '';

        return {
          id: -1,
          title: doc.title || title,
          author: Array.isArray(doc.author_name)
            ? doc.author_name.join(', ')
            : (author || 'Unknown Author'),
          isbn,
          category: Array.isArray(doc.subject) && doc.subject.length > 0 ? doc.subject[0] : 'General Literature',
          categorySlug: 'general',
          publisher: Array.isArray(doc.publisher) && doc.publisher.length > 0 ? doc.publisher[0] : '',
          pages: doc.number_of_pages_median || 0,
          year: doc.first_publish_year || 0,
          language: 'English',
          coverImage: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
          price: 0,
          discount: 0,
          stock: 0,
          rating: 0,
          description: `External publication found via OpenLibrary archive for "${doc.title}". Currently not stocked in campus warehouse.`,
          isLocalCatalog: false
        };
      }
    }
  } catch (searchErr) {
    // Search timeout or network error
  }
  return null;
}

/**
 * 0. Scanner Configuration Status
 * Returns whether AI Gemini optical vision is configured, plus general scanner capabilities.
 * Safe and non-sensitive: never returns or leaks the API key.
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    visionConfigured: isGeminiConfigured(),
    barcodeSupported: true,
    isbnLookupSupported: true,
    catalogCount: getFullCatalog().length
  });
});

/**
 * 1. Direct ISBN / Barcode Lookup
 * Supports ISBN-10, ISBN-13, EAN-13. Normalizes spaces & hyphens.
 * Searches local BookNest catalog first, falls back to OpenLibrary API if not in local warehouse.
 */
router.post('/isbn', scannerLimiter, async (req, res) => {
  const { isbn } = req.body;

  if (!isbn || typeof isbn !== 'string' || !isbn.trim()) {
    return res.status(400).json({ 
      success: false,
      error: 'A valid ISBN string is required.' 
    });
  }

  const cleanIsbn = normalizeIsbn(isbn);

  if (cleanIsbn.length < 9) {
    return res.status(400).json({
      success: false,
      error: `"${isbn}" is too short to be a valid ISBN or EAN code.`
    });
  }

  const catalog = getFullCatalog();
  const matchResult = matchBookAgainstCatalog({ isbn: cleanIsbn }, catalog);

  // 1. Found in local BookNest campus warehouse
  if (matchResult.matched && matchResult.bestMatch) {
    return res.json({
      success: true,
      matched: true,
      matchType: matchResult.matchType,
      confidence: matchResult.confidence,
      evidence: matchResult.evidence,
      book: { ...matchResult.bestMatch, isLocalCatalog: true },
      candidates: matchResult.candidates,
      isLocalCatalog: true
    });
  }

  // 2. Query external book metadata provider (OpenLibrary) if not found locally
  let externalBook: any = null;
  try {
    externalBook = await externalIsbnLookupHandler(cleanIsbn);
  } catch (extErr) {
    // OpenLibrary lookup timed out or network error handled gracefully
  }

  if (externalBook) {
    return res.json({
      success: true,
      matched: true,
      matchType: 'ISBN_EXACT',
      confidence: 1.0,
      evidence: `Verified ISBN ${cleanIsbn} via OpenLibrary metadata archive (External Catalog).`,
      book: externalBook,
      candidates: [],
      isLocalCatalog: false
    });
  }

  // 3. Genuine honest not found (never invent a fake book)
  return res.status(404).json({
    success: false,
    matched: false,
    matchType: 'NO_MATCH',
    confidence: 0,
    evidence: `No catalog titles or external records found for ISBN ${cleanIsbn}.`,
    error: `No book found matching ISBN "${isbn}" in the BookNest warehouse catalog or external archives.`,
    detectedIsbn: cleanIsbn,
    candidates: []
  });
});

export interface ImageMetadata {
  format: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/bmp' | 'image/tiff' | null;
  width?: number;
  height?: number;
}

/**
 * Inspects binary magic bytes and headers for JPEG, PNG, and WebP images.
 * Extracts image dimensions to prevent decompression bombs and memory exhaustion attacks.
 * Pure Node.js Buffer inspection with zero external dependencies.
 */
export function detectImageMetadata(buffer: Buffer): ImageMetadata {
  if (buffer.length < 8) {
    return { format: null };
  }

  // 1. JPEG: 0xFF, 0xD8, 0xFF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    let offset = 2;
    let width: number | undefined;
    let height: number | undefined;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xD9) break; // EOI (End of Image)
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) {
        offset += 2;
        continue;
      }
      if (offset + 4 > buffer.length) break;
      const len = buffer.readUInt16BE(offset + 2);
      if (len < 2) break;

      // Start of Frame (SOF) markers: SOF0-SOF15 excluding DHT (0xC4), JPG (0xC8), DAC (0xCC)
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
        if (offset + 9 <= buffer.length) {
          height = buffer.readUInt16BE(offset + 5);
          width = buffer.readUInt16BE(offset + 7);
          break;
        }
      }
      offset += 2 + len;
    }
    return { format: 'image/jpeg', width, height };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    let width: number | undefined;
    let height: number | undefined;
    if (buffer.toString('ascii', 12, 16) === 'IHDR') {
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    }
    return { format: 'image/png', width, height };
  }

  // 3. WebP: RIFF ... WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    let width: number | undefined;
    let height: number | undefined;
    const chunkType = buffer.toString('ascii', 12, 16);
    if (chunkType === 'VP8 ' && buffer.length >= 30) {
      if (buffer[23] === 0x9D && buffer[24] === 0x01 && buffer[25] === 0x2A) {
        width = buffer.readUInt16LE(26) & 0x3FFF;
        height = buffer.readUInt16LE(28) & 0x3FFF;
      }
    } else if (chunkType === 'VP8L' && buffer.length >= 25) {
      if (buffer[20] === 0x2F) {
        const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
        width = 1 + (((b2 & 0x3F) << 8) | b1);
        height = 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6));
      }
    } else if (chunkType === 'VP8X' && buffer.length >= 30) {
      width = 1 + buffer.readUIntLE(24, 3);
      height = 1 + buffer.readUIntLE(27, 3);
    }
    return { format: 'image/webp', width, height };
  }

  // 4. Detect other common image formats for helpful rejection errors
  if (buffer.toString('ascii', 0, 3) === 'GIF') {
    return { format: 'image/gif' };
  }
  if (buffer.toString('ascii', 0, 2) === 'BM') {
    return { format: 'image/bmp' };
  }
  if (buffer.toString('ascii', 0, 4) === 'II*\0' || buffer.toString('ascii', 0, 4) === 'MM\0*') {
    return { format: 'image/tiff' };
  }

  return { format: null };
}

/**
 * 2. Optical Cover / Camera Vision Analysis
 * Runs OCR Title, Author, Publisher extraction and genuine catalog similarity ranking.
 * Implements full fallback pipeline:
 * 1. Barcode/ISBN check -> Local catalog -> OpenLibrary
 * 2. Title + Author check -> Local catalog -> OpenLibrary
 * 3. Honest rejection with clear reason (Text unclear, No book, Not configured, etc.)
 */
router.post('/analyze', scannerLimiter, async (req, res) => {
  const { imageBase64, mimeType } = req.body;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ 
      success: false, 
      error: 'Base64 image data is required.' 
    });
  }

  // 1. Fast boundary check on encoded string length before expensive buffer allocation
  if (imageBase64.length > 14 * 1024 * 1024) {
    return res.status(413).json({
      success: false,
      error: 'Image file size exceeds the 10MB limit. Please upload a compressed or standard photo.'
    });
  }

  // 2. Validate declared MIME type format if provided
  const validMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  let declaredMime: string | undefined;
  if (mimeType !== undefined && mimeType !== null) {
    if (typeof mimeType !== 'string' || !mimeType.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mimeType format.'
      });
    }
    declaredMime = mimeType.trim().toLowerCase();
    if (!validMimes.includes(declaredMime)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported image format (${declaredMime}). Only JPG, JPEG, PNG, and WEBP images are supported.`
      });
    }
  }

  // 3. Strip data-URL scheme prefix and verify Base64 syntax
  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, '').trim();
  if (!cleanBase64) {
    return res.status(400).json({
      success: false,
      error: 'Base64 image data is empty.'
    });
  }

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(cleanBase64)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Base64 character encoding in image data.'
    });
  }

  // 4. Decode binary buffer safely and check decoded size
  let decodedBuffer: Buffer;
  try {
    decodedBuffer = Buffer.from(cleanBase64, 'base64');
  } catch {
    return res.status(400).json({
      success: false,
      error: 'Failed to decode Base64 image payload.'
    });
  }

  const MAX_DECODED_BYTES = 10 * 1024 * 1024; // 10MB decoded limit
  if (decodedBuffer.length > MAX_DECODED_BYTES) {
    return res.status(413).json({
      success: false,
      error: 'Decoded image size exceeds maximum allowed limit of 10MB.'
    });
  }

  if (decodedBuffer.length < 12) {
    return res.status(400).json({
      success: false,
      error: 'Decoded payload is too small to be a valid image.'
    });
  }

  // 5. Inspect magic bytes to confirm the payload is a genuine supported image
  const metadata = detectImageMetadata(decodedBuffer);
  if (metadata.format === 'image/gif') {
    return res.status(400).json({
      success: false,
      error: 'Unsupported image format (image/gif). Only JPG, JPEG, PNG, and WEBP images are supported.'
    });
  }
  if (metadata.format === 'image/bmp' || metadata.format === 'image/tiff') {
    return res.status(400).json({
      success: false,
      error: `Unsupported image format (${metadata.format}). Only JPG, JPEG, PNG, and WEBP images are supported.`
    });
  }
  if (!metadata.format || !['image/jpeg', 'image/png', 'image/webp'].includes(metadata.format)) {
    return res.status(400).json({
      success: false,
      error: 'Decoded payload is not a valid image. Magic bytes do not match supported formats (JPEG, PNG, WEBP).'
    });
  }

  const detectedMime = metadata.format;

  // 6. Verify declared MIME type and detected image format do not contradict
  if (declaredMime) {
    const normalizedDeclared = declaredMime === 'image/jpg' ? 'image/jpeg' : declaredMime;
    if (normalizedDeclared !== detectedMime) {
      return res.status(400).json({
        success: false,
        error: `Detected image format (${detectedMime}) contradicts declared MIME type (${declaredMime}).`
      });
    }
  }

  const effectiveMime = detectedMime;

  // 7. Enforce image dimensions and decompression bounds (mitigates decompression bombs / pixel floods)
  if (metadata.width !== undefined && metadata.height !== undefined) {
    const maxDimension = 10000;
    const maxPixels = 100_000_000; // 100 megapixels
    if (metadata.width > maxDimension || metadata.height > maxDimension || (metadata.width * metadata.height) > maxPixels) {
      return res.status(400).json({
        success: false,
        error: `Image dimensions (${metadata.width}x${metadata.height}) exceed maximum allowed dimensions (10000x10000) or 100 megapixels.`
      });
    }
    if (metadata.width < 1 || metadata.height < 1) {
      return res.status(400).json({
        success: false,
        error: 'Image dimensions must be at least 1x1 pixel.'
      });
    }
  }

  // 8. Check Gemini configuration before proceeding (BUG 4)
  if (!isGeminiConfigured()) {
    return res.status(503).json({
      success: false,
      matched: false,
      matchType: 'VISION_CONFIGURATION_ERROR',
      error: 'Gemini Vision is not configured on the backend.'
    });
  }

  try {
    const catalog = getFullCatalog();
    const extracted = await visionAnalysisHandler(imageBase64, effectiveMime);

    if (!extracted) {
      return res.status(404).json({
        success: false,
        matched: false,
        matchType: 'NO_MATCH',
        confidence: 0,
        error: 'Machine vision analysis failed to process the image frame.',
        candidates: []
      });
    }

    // Check if the image does not depict a book (BUG 9 state 5)
    if (extracted.isBook === false) {
      return res.status(404).json({
        success: false,
        matched: false,
        matchType: 'NO_BOOK_DETECTED',
        confidence: 0,
        error: 'The captured image does not appear to contain a book cover, spine, or barcode.',
        detectedMetadata: extracted,
        candidates: []
      });
    }

    // Check if image depicts a book but text is unclear/blurry (BUG 9 state 4)
    if (extracted.textUnclear || !extracted.hasOcrData) {
      return res.status(404).json({
        success: false,
        matched: false,
        matchType: 'TEXT_UNCLEAR',
        confidence: 0,
        error: 'Book cover detected, but printed text or barcode is too blurry or unclear to read reliably.',
        detectedMetadata: extracted,
        candidates: []
      });
    }

    // Step A: If machine vision detected a visible ISBN barcode/text
    if (extracted.isbn) {
      const cleanIsbn = normalizeIsbn(extracted.isbn);
      const isbnMatch = matchBookAgainstCatalog({ isbn: cleanIsbn }, catalog);

      if (isbnMatch.matched && isbnMatch.bestMatch) {
        return res.json({
          success: true,
          matched: true,
          matchType: 'ISBN_EXACT',
          confidence: 1.0,
          evidence: `Deterministic match on visible ISBN ${extracted.isbn} detected by machine vision.`,
          book: { ...isbnMatch.bestMatch, isLocalCatalog: true },
          candidates: isbnMatch.candidates,
          detectedMetadata: extracted,
          isLocalCatalog: true
        });
      }

      // Check OpenLibrary for this ISBN if not found in local catalog
      const externalBook = await externalIsbnLookupHandler(cleanIsbn);
      if (externalBook) {
        return res.json({
          success: true,
          matched: true,
          matchType: 'ISBN_EXTERNAL',
          confidence: 1.0,
          evidence: `Machine vision detected ISBN ${cleanIsbn}. Verified via OpenLibrary archive (Not stocked locally).`,
          book: externalBook,
          candidates: [],
          detectedMetadata: extracted,
          isLocalCatalog: false
        });
      }
    }

    // Step B: Match Title + Author (+ rawTextLines) against BookNest local catalog
    const matchResult: MatchResult = matchBookAgainstCatalog({
      isbn: extracted.isbn,
      title: extracted.title,
      author: extracted.author,
      publisher: extracted.publisher,
      rawTextLines: extracted.rawTextLines
    }, catalog);

    // 1. Confident single local match (>= 0.80)
    if (matchResult.matched && matchResult.bestMatch) {
      return res.json({
        success: true,
        matched: true,
        matchType: matchResult.matchType,
        confidence: matchResult.confidence,
        evidence: matchResult.evidence,
        book: { ...matchResult.bestMatch, isLocalCatalog: true },
        candidates: matchResult.candidates,
        detectedMetadata: extracted,
        isLocalCatalog: true
      });
    }

    // 2. Multiple possible matches found in local catalog
    if (matchResult.candidates.length > 0) {
      return res.json({
        success: true,
        matched: false,
        matchType: 'MULTIPLE_POSSIBLE_MATCHES',
        confidence: matchResult.confidence,
        evidence: `Multiple possible catalog matches detected for extracted text "${extracted.title || 'Book Cover'}".`,
        book: null,
        candidates: matchResult.candidates,
        detectedMetadata: extracted,
        isLocalCatalog: true
      });
    }

    // Step C: Fallback to OpenLibrary external title/author lookup (BUG 2 Fallback 6)
    if (extracted.title) {
      let extBookByTitle: any = null;
      try {
        extBookByTitle = await externalSearchHandler(extracted.title, extracted.author);
      } catch (searchErr) {
        // Handled gracefully
      }
      if (extBookByTitle) {
        return res.json({
          success: true,
          matched: true,
          matchType: 'EXTERNAL_TITLE_MATCH',
          confidence: 0.85,
          evidence: `Identified "${extBookByTitle.title}" via OpenLibrary external archive. Currently not stocked in BookNest warehouse.`,
          book: extBookByTitle,
          candidates: [],
          detectedMetadata: extracted,
          isLocalCatalog: false
        });
      }
    }

    // 3. Extracted text was readable, but zero catalog or external records matched
    return res.status(404).json({
      success: false,
      matched: false,
      matchType: 'NO_MATCH',
      confidence: 0,
      evidence: matchResult.evidence,
      error: `Extracted text "${extracted.title || 'Unknown Title'}" was detected, but it does not match any current BookNest warehouse catalog or external library records.`,
      detectedMetadata: extracted,
      candidates: []
    });

  } catch (err: any) {
    console.error('Optical scanner error:', err.message || err);
    res.status(502).json({
      success: false,
      error: 'Optical vision analysis failed or timed out.'
    });
  }
});

/**
 * 3. Textual / Title / Metadata Search Matcher
 * Runs the deterministic matcher on arbitrary user query or explicit metadata.
 */
router.post('/match-text', scannerLimiter, (req, res) => {
  const { query, title, author, isbn, rawTextLines } = req.body;

  const catalog = getFullCatalog();

  // If structured metadata was provided (for testing or direct lookup)
  if (title || author || isbn) {
    const matchResult = matchBookAgainstCatalog({ title, author, isbn, rawTextLines }, catalog);
    return res.json({
      success: true,
      matched: matchResult.matched,
      matchType: matchResult.matchType,
      confidence: matchResult.confidence,
      evidence: matchResult.evidence,
      book: matchResult.bestMatch ? { ...matchResult.bestMatch, isLocalCatalog: true } : null,
      candidates: matchResult.candidates
    });
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  const isDigits = /^[0-9X-]+$/i.test(query.trim());

  const matchResult = isDigits
    ? matchBookAgainstCatalog({ isbn: query.trim() }, catalog)
    : matchBookAgainstCatalog({ title: query.trim() }, catalog);

  res.json({
    success: true,
    matched: matchResult.matched,
    matchType: matchResult.matchType,
    confidence: matchResult.confidence,
    evidence: matchResult.evidence,
    book: matchResult.bestMatch ? { ...matchResult.bestMatch, isLocalCatalog: true } : null,
    candidates: matchResult.candidates
  });
});

export default router;
