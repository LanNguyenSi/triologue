import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
const DEFAULT_TEXT_BYTE_LIMIT = 200_000;
const DEFAULT_BASE64_BYTE_LIMIT = 64 * 1024;
const TOOL_TIMEOUT_MS = 20_000;
const TOOL_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);
const SUPPORTED_PDF_MIME_TYPES = new Set([
  'application/pdf',
]);
const SUPPORTED_OCR_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const ALL_SUPPORTED_MIME_TYPES = new Set([
  ...SUPPORTED_TEXT_MIME_TYPES,
  ...SUPPORTED_PDF_MIME_TYPES,
  ...SUPPORTED_OCR_IMAGE_MIME_TYPES,
]);
const execFileAsync = promisify(execFile);

export type AttachmentProcessingStatus = 'ready' | 'unsupported' | 'missing' | 'error';

export interface ReadAttachmentContentOptions {
  includeBase64?: boolean;
  textByteLimit?: unknown;
  base64ByteLimit?: unknown;
}

export interface AttachmentContentResult {
  status: AttachmentProcessingStatus;
  parser: 'plain-text' | 'pdf-poppler' | 'ocr-tesseract' | 'none';
  note: string | null;
  mimeType: string;
  supportedMimeTypes: string[];
  text: string | null;
  excerpt: string | null;
  truncated: boolean;
  bytesRead: number;
  base64: string | null;
  base64Included: boolean;
  base64Truncated: boolean;
  fileSize: number | null;
}

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function parseIncludeBase64Flag(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveUploadPath(url: string): string | null {
  if (!url || !url.startsWith('/uploads/')) return null;
  const filename = path.basename(url.replace('/uploads/', '').trim());
  if (!filename) return null;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  return path.join(UPLOAD_DIR, filename);
}

function normalizeExtractedText(raw: string, byteLimit: number): {
  text: string;
  excerpt: string | null;
  truncated: boolean;
  bytesRead: number;
} {
  const compact = raw.replace(/\u0000/g, '').trim();
  const rawBytes = Buffer.byteLength(compact, 'utf8');
  if (rawBytes <= byteLimit) {
    const excerpt = compact ? compact.replace(/\s+/g, ' ').trim().slice(0, 800) : null;
    return {
      text: compact,
      excerpt,
      truncated: false,
      bytesRead: rawBytes,
    };
  }

  const truncatedText = Buffer.from(compact, 'utf8').subarray(0, byteLimit).toString('utf8');
  const excerpt = truncatedText
    ? truncatedText.replace(/\s+/g, ' ').trim().slice(0, 800)
    : null;
  return {
    text: truncatedText,
    excerpt,
    truncated: true,
    bytesRead: byteLimit,
  };
}

async function extractWithCliTool(
  command: string,
  args: string[],
): Promise<{ ok: true; text: string } | { ok: false; missingTool: boolean; error: string }> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: TOOL_TIMEOUT_MS,
      maxBuffer: TOOL_MAX_BUFFER_BYTES,
    });
    return {
      ok: true,
      text: String(result.stdout || ''),
    };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return { ok: false, missingTool: true, error: `${command} is not installed` };
    }
    const partialOutput = typeof error?.stdout === 'string' ? error.stdout : '';
    if (partialOutput.trim()) {
      return { ok: true, text: partialOutput };
    }
    const message = String(error?.message || `${command} failed`);
    return { ok: false, missingTool: false, error: message };
  }
}

export async function readAttachmentContent(
  uploadUrl: string,
  mimeTypeRaw: unknown,
  options: ReadAttachmentContentOptions = {},
): Promise<AttachmentContentResult> {
  const mimeType = String(mimeTypeRaw || '').trim().toLowerCase();
  const textByteLimit = normalizeLimit(options.textByteLimit, DEFAULT_TEXT_BYTE_LIMIT, 800_000);
  const base64ByteLimit = normalizeLimit(options.base64ByteLimit, DEFAULT_BASE64_BYTE_LIMIT, 512_000);

  const filePath = resolveUploadPath(uploadUrl);
  if (!filePath) {
    return {
      status: 'missing',
      parser: 'none',
      note: null,
      mimeType,
      supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
      text: null,
      excerpt: null,
      truncated: false,
      bytesRead: 0,
      base64: null,
      base64Included: false,
      base64Truncated: false,
      fileSize: null,
    };
  }

  let fileSize: number;
  try {
    const stat = await fs.stat(filePath);
    fileSize = stat.size;
  } catch {
    return {
      status: 'missing',
      parser: 'none',
      note: null,
      mimeType,
      supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
      text: null,
      excerpt: null,
      truncated: false,
      bytesRead: 0,
      base64: null,
      base64Included: false,
      base64Truncated: false,
      fileSize: null,
    };
  }

  const includeBase64 = Boolean(options.includeBase64);
  let base64: string | null = null;
  let base64Included = false;
  let base64Truncated = false;

  if (includeBase64) {
    if (fileSize <= base64ByteLimit) {
      try {
        const buf = await fs.readFile(filePath);
        base64 = buf.toString('base64');
        base64Included = true;
      } catch {
        return {
          status: 'error',
          parser: 'none',
          note: 'Failed to read file for base64 conversion',
          mimeType,
          supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
          text: null,
          excerpt: null,
          truncated: false,
          bytesRead: 0,
          base64: null,
          base64Included: false,
          base64Truncated: false,
          fileSize,
        };
      }
    } else {
      base64Truncated = true;
    }
  }

  if (SUPPORTED_PDF_MIME_TYPES.has(mimeType)) {
    const pdfResult = await extractWithCliTool('pdftotext', [
      '-q',
      '-nopgbrk',
      '-enc',
      'UTF-8',
      '-f',
      '1',
      '-l',
      '50',
      filePath,
      '-',
    ]);

    if (!pdfResult.ok && pdfResult.missingTool) {
      return {
        status: 'unsupported',
        parser: 'none',
        note: 'Install poppler-utils (pdftotext) to enable PDF extraction.',
        mimeType,
        supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
        text: null,
        excerpt: null,
        truncated: false,
        bytesRead: 0,
        base64,
        base64Included,
        base64Truncated,
        fileSize,
      };
    }
    if (!pdfResult.ok) {
      return {
        status: 'error',
        parser: 'none',
        note: pdfResult.error,
        mimeType,
        supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
        text: null,
        excerpt: null,
        truncated: false,
        bytesRead: 0,
        base64,
        base64Included,
        base64Truncated,
        fileSize,
      };
    }

    const normalized = normalizeExtractedText(pdfResult.text, textByteLimit);
    return {
      status: 'ready',
      parser: 'pdf-poppler',
      note: normalized.text ? null : 'No text extracted from PDF.',
      mimeType,
      supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
      text: normalized.text,
      excerpt: normalized.excerpt,
      truncated: normalized.truncated,
      bytesRead: normalized.bytesRead,
      base64,
      base64Included,
      base64Truncated,
      fileSize,
    };
  }

  if (SUPPORTED_OCR_IMAGE_MIME_TYPES.has(mimeType)) {
    const ocrResult = await extractWithCliTool('tesseract', [
      filePath,
      'stdout',
      '-l',
      'eng+deu',
      '--psm',
      '6',
    ]);

    if (!ocrResult.ok && ocrResult.missingTool) {
      return {
        status: 'unsupported',
        parser: 'none',
        note: 'Install tesseract-ocr (with eng/deu language packs) to enable image OCR.',
        mimeType,
        supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
        text: null,
        excerpt: null,
        truncated: false,
        bytesRead: 0,
        base64,
        base64Included,
        base64Truncated,
        fileSize,
      };
    }
    if (!ocrResult.ok) {
      return {
        status: 'error',
        parser: 'none',
        note: ocrResult.error,
        mimeType,
        supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
        text: null,
        excerpt: null,
        truncated: false,
        bytesRead: 0,
        base64,
        base64Included,
        base64Truncated,
        fileSize,
      };
    }

    const normalized = normalizeExtractedText(ocrResult.text, textByteLimit);
    return {
      status: 'ready',
      parser: 'ocr-tesseract',
      note: normalized.text ? null : 'No text detected in image.',
      mimeType,
      supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
      text: normalized.text,
      excerpt: normalized.excerpt,
      truncated: normalized.truncated,
      bytesRead: normalized.bytesRead,
      base64,
      base64Included,
      base64Truncated,
      fileSize,
    };
  }

  if (!SUPPORTED_TEXT_MIME_TYPES.has(mimeType)) {
    return {
      status: 'unsupported',
      parser: 'none',
      note: null,
      mimeType,
      supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
      text: null,
      excerpt: null,
      truncated: false,
      bytesRead: 0,
      base64,
      base64Included,
      base64Truncated,
      fileSize,
    };
  }

  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const readLimit = Math.min(fileSize, textByteLimit);
      const buffer = Buffer.alloc(readLimit);
      const { bytesRead } = await handle.read(buffer, 0, readLimit, 0);
      const text = bytesRead > 0 ? buffer.toString('utf8', 0, bytesRead) : '';
      const excerpt = text ? text.replace(/\s+/g, ' ').trim().slice(0, 800) : '';
      return {
        status: 'ready',
        parser: 'plain-text',
        note: null,
        mimeType,
        supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
        text,
        excerpt: excerpt || null,
        truncated: fileSize > textByteLimit,
        bytesRead,
        base64,
        base64Included,
        base64Truncated,
        fileSize,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return {
      status: 'error',
      parser: 'none',
      note: 'Failed to read text attachment content',
      mimeType,
      supportedMimeTypes: Array.from(ALL_SUPPORTED_MIME_TYPES),
      text: null,
      excerpt: null,
      truncated: false,
      bytesRead: 0,
      base64,
      base64Included,
      base64Truncated,
      fileSize,
    };
  }
}
