const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const ApiError = require('../utils/ApiError');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Allowed MIME types and the extension we save them with
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/webm': '.weba',
  'audio/wav': '.wav',
};

// ----- File signature ("magic bytes") checks -----
const isFtyp = (b) => b.length >= 8 && b.toString('ascii', 4, 8) === 'ftyp';
const isEbml = (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
const isRiff = (b, type) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === type;

const SIGNATURES = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => isRiff(b, 'WEBP'),
  'video/mp4': isFtyp,
  'audio/mp4': isFtyp,
  'video/webm': isEbml,
  'audio/webm': isEbml,
  'audio/mpeg': (b) => (b.length >= 3 && b.toString('ascii', 0, 3) === 'ID3') || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  'audio/wav': (b) => isRiff(b, 'WAVE'),
};

function readHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function contentMatchesType(file) {
  const check = SIGNATURES[file.mimetype];
  if (!check) return false;
  try {
    return check(readHeader(file.path));
  } catch {
    return false;
  }
}

function removeFiles(files = []) {
  files.forEach((file) => {
    fs.unlink(file.path, (err) => {
      if (err && err.code !== 'ENOENT') console.error('Failed to delete upload:', err.message);
    });
  });
}

// ----- Multer setup -----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // Random file names so user input never controls the path
  filename: (req, file, cb) => {
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED_TYPES[file.mimetype]}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    return cb(new ApiError(400, `Unsupported file type: ${file.mimetype}`));
  },
});

// Accepts up to 3 files in the "media" field and verifies their real content.
// Note: production should also add malware scanning and private cloud storage.
const uploadMedia = (req, res, next) => {
  upload.array('media', 3)(req, res, (err) => {
    const files = req.files || [];

    if (err) {
      removeFiles(files);
      return next(err instanceof multer.MulterError ? new ApiError(400, err.message) : err);
    }

    // If the request fails later (e.g. validation error), delete the saved files
    res.on('finish', () => {
      if (res.statusCode >= 400) removeFiles(files);
    });

    for (const file of files) {
      if (!contentMatchesType(file)) {
        removeFiles(files);
        return next(new ApiError(400, `File content does not match its type: ${file.originalname}`));
      }
    }

    return next();
  });
};

module.exports = { uploadMedia, UPLOAD_DIR };