const mongoose = require('mongoose');
require('../src/config/env');
const connectDB = require('../src/config/db');
const User = require('../src/modules/users/user.model');
const { ROLES } = require('../src/utils/constants');

// Usage: set ADMIN_PASSWORD in .env, then run: node seeds/setAdminPassword.js
async function setAdminPassword() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be set in .env and be at least 12 characters');
  }

  await connectDB();

  const admins = await User.find({ role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } });
  for (const admin of admins) {
    admin.password = password; // hashed by the pre-save hook
    await admin.save();
    console.log(`Password updated: ${admin.email}`);
  }

  console.log(`Done. ${admins.length} admin account(s) updated.`);
  await mongoose.disconnect();
}

setAdminPassword().catch(async (err) => {
  console.error('Failed to set admin password:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});