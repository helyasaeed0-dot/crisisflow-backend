const userService = require('./user.service');
const asyncHandler = require('../../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const data = await userService.listUsers(req.query);
  res.json({ success: true, data });
});

const update = asyncHandler(async (req, res) => {
  const data = await userService.updateUser(req.user, req.params.id, req.body);
  res.json({ success: true, message: 'User updated', data });
});

module.exports = { list, update };