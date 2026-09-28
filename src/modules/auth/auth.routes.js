const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./auth.controller');
const schemas = require('./auth.validation');
const validate = require('../../middlewares/validate.middleware');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

// Stricter limit for login/register to slow down brute-force attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later' },
});

router.post('/register', authLimiter, validate(schemas.register), controller.register);
router.post('/login', authLimiter, validate(schemas.login), controller.login);
router.post('/refresh', validate(schemas.refresh), controller.refresh);
router.post('/logout', protect, controller.logout);
router.get('/me', protect, controller.me);

module.exports = router;