const authService = require('./auth.service');
const asyncHandler = require('../../utils/asyncHandler');

const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);
  res.status(201).json({ success: true, message: 'Registration successful', data });
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  res.json({ success: true, message: 'Login successful', data });
});

const refresh = asyncHandler(async (req, res) => {
  const data = await authService.refresh(req.body.refreshToken);
  res.json({ success: true, data });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user._id);
  res.json({ success: true, message: 'Logged out successfully' });
});

const me = asyncHandler(async (req, res) => {
  const data = await authService.getMe(req.user);
  res.json({ success: true, data });
});

module.exports = { register, login, refresh, logout, me };