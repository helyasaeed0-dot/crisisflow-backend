const crypto = require('crypto');

// Human-friendly tracking ID, e.g. CF-260927-A1B2C3
function generateReferenceId() {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CF-${date}-${random}`;
}

module.exports = { generateReferenceId };