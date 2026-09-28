const mongoose = require('mongoose');
require('../src/config/env');
const connectDB = require('../src/config/db');
const User = require('../src/modules/users/user.model');
const Responder = require('../src/modules/responders/responder.model');
const {
  ROLES,
  RESPONDER_AVAILABILITY,
  VERIFICATION_STATUS,
} = require('../src/utils/constants');

const password = process.env.SEED_PASSWORD || 'Demo@12345';
const centerLat = Number(process.env.DEMO_CENTER_LAT || 31.5204);
const centerLng = Number(process.env.DEMO_CENTER_LNG || 74.3587);

// Random offset in degrees, roughly within the given radius in km
const randomOffset = (km) => (Math.random() - 0.5) * 2 * (km / 111);

async function upsertUser({ name, email, role, phone }) {
  let user = await User.findOne({ email });
  if (user) {
    console.log(`User already exists: ${email}`);
    return user;
  }
  user = await User.create({ name, email, phone, password, role, isDemo: true });
  console.log(`Created ${role}: ${email}`);
  return user;
}

const staffUsers = [
  { name: 'Super Admin', email: 'superadmin@crisisflow.demo', role: ROLES.SUPER_ADMIN },
  { name: 'Command Center Admin', email: 'admin@crisisflow.demo', role: ROLES.ADMIN },
  { name: 'Demo Citizen', email: 'citizen@crisisflow.demo', role: ROLES.CITIZEN },
];

const demoResponders = [
  { name: 'Ambulance Unit 1', email: 'ambulance1@crisisflow.demo', type: 'AMBULANCE' },
  { name: 'Ambulance Unit 2', email: 'ambulance2@crisisflow.demo', type: 'AMBULANCE' },
  { name: 'Medical Team 1', email: 'medical1@crisisflow.demo', type: 'MEDICAL_TEAM' },
  { name: 'Fire Brigade 1', email: 'fire1@crisisflow.demo', type: 'FIRE_BRIGADE' },
  { name: 'Police Unit 1', email: 'police1@crisisflow.demo', type: 'POLICE' },
  { name: 'Rescue Team 1', email: 'rescue1@crisisflow.demo', type: 'RESCUE_TEAM' },
  { name: 'Utility Team 1', email: 'utility1@crisisflow.demo', type: 'UTILITY_TEAM' },
];

async function seed() {
  await connectDB();

  for (const staff of staffUsers) {
    await upsertUser(staff);
  }

  for (const r of demoResponders) {
    const user = await upsertUser({ name: r.name, email: r.email, role: ROLES.RESPONDER });

    await Responder.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          type: r.type,
          location: {
            type: 'Point',
            coordinates: [centerLng + randomOffset(5), centerLat + randomOffset(5)],
          },
          lastLocationAt: new Date(),
          availability: RESPONDER_AVAILABILITY.AVAILABLE,
          verificationStatus: VERIFICATION_STATUS.VERIFIED,
          isDemo: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    console.log(`Responder profile ready: ${r.name} (${r.type})`);
  }

  console.log('Seeding completed');
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('Seeding failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});