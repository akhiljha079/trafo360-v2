// Best-effort text extraction from an uploaded scan (image files only - PDFs
// are not rasterized here, so a scanned PDF won't be OCR'd) via Tesseract.js,
// plus simple regex heuristics suggesting a document number and date. This
// is an assist to speed up cataloguing, never a hard auto-fill: OCR accuracy
// varies with scan quality/fonts/handwriting, so results are always shown to
// a human to confirm on the document's page (views/documents/view.ejs),
// never applied to doc_code/doc_name automatically.
const path = require('path');

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);

function isSupportedForOcr(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// Lazily require tesseract.js - it bundles a WASM OCR engine and is fairly
// heavy to load, so don't pay that cost on every server boot for a feature
// most requests never touch.
async function extractText(absFilePath) {
  if (!isSupportedForOcr(absFilePath)) return null;
  try {
    const { recognize } = require('tesseract.js');
    const { data } = await recognize(absFilePath, 'eng', { logger: () => {} });
    const text = (data && data.text || '').trim();
    return text || null;
  } catch (err) {
    console.error('[ocr] extraction failed:', err.message);
    return null;
  }
}

// Looks for common certificate/report labeling patterns - always a
// suggestion, never applied automatically.
function guessDocNumber(text) {
  if (!text) return null;
  const m = text.match(/\b(?:report|certificate|cert|invoice|doc(?:ument)?)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,30})/i);
  return m ? m[1] : null;
}

function guessDate(text) {
  if (!text) return null;
  const m = text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/);
  return m ? m[1] : null;
}

// Fire-and-forget: runs OCR on a just-uploaded document's file and, if any
// text came back, saves it to documents.ocr_text. Callers don't await this -
// cataloguing a document shouldn't be blocked by a multi-second OCR pass.
function processDocumentOcrAsync(pool, documentId, absFilePath) {
  if (!isSupportedForOcr(absFilePath)) return;
  extractText(absFilePath)
    .then(text => {
      if (text) return pool.query('UPDATE documents SET ocr_text=? WHERE id=?', [text, documentId]);
    })
    .catch(err => console.error(`[ocr] async processing failed for document #${documentId}:`, err.message));
}

module.exports = { isSupportedForOcr, extractText, guessDocNumber, guessDate, processDocumentOcrAsync };
