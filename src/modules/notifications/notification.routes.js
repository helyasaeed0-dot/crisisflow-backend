const express = require('express');
const controller = require('./notification.controller');
const schemas = require('./notification.validation');
const validate = require('../../middlewares/validate.middleware');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

// Every logged-in user can manage only their own notifications
router.use(protect);

router.get('/', validate(schemas.list, 'query'), controller.list);
router.get('/unread-count', controller.unreadCount);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', validate(schemas.idParam, 'params'), controller.markRead);

module.exports = router;