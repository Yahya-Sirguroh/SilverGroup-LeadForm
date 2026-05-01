// Load .env in local development (Vercel injects env vars directly, so .env is optional)
const dotenvResult = require('dotenv').config();
if (dotenvResult.error && !process.env.MONGODB_URI) {
  console.warn('⚠️  No .env file found — make sure environment variables are set');
}

const express  = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors     = require('cors');
const axios    = require('axios');

const app  = express();
//const PORT = process.env.PORT || 5000;
const PORT = 5000;
// ─── CONFIGURATION (all secrets loaded from environment variables) ────────────
//const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_URI = "mongodb://yahyasirguroh_db_user:dknwd2A0TLVYkgwD@ac-ztmxqj8-shard-00-00.quxfls4.mongodb.net:27017,ac-ztmxqj8-shard-00-01.quxfls4.mongodb.net:27017,ac-ztmxqj8-shard-00-02.quxfls4.mongodb.net:27017/silvergroup?ssl=true&tls=true&replicaSet=atlas-krjyrr-shard-0&authSource=admin&retryWrites=true&w=majority";
if (!MONGODB_URI) throw new Error('❌ MONGODB_URI environment variable is not set');

const DB_NAME             = 'silvergroup';
const COLLECTION_LEADS    = 'tblleadform';
const COLLECTION_PROJECTS = 'tblproject';
const COLLECTION_USERS    = 'tblusers';

// Farvision ERP endpoint
const FARVISION_URL       = process.env.FARVISION_URL       || 'https://fvintegration.farvisioncloud.com/LeadSync/api/SyncLeadsV2/RawLeads';
const FARVISION_TENANT_ID = process.env.FARVISION_TENANT_ID || 995;

// GupShup SMS / OTP gateway
const GUPSHUP_USERID   = process.env.GUPSHUP_USERID   || '2000264786';
const GUPSHUP_PASSWORD = process.env.GUPSHUP_PASSWORD || 'ZSHN3pyz';
const GUPSHUP_URL      = 'https://enterprise.smsgupshup.com/GatewayAPI/rest';
const OTP_EXPIRY_MIN   = 10;                  // minutes OTP stays valid

// In-memory OTP store  { mobile: { otp, expiresAt } }
const otpStore = new Map();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'],
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// ─── DATABASE CONNECTION ──────────────────────────────────────────────────────
let db;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI, { tls: true, tlsInsecure: true });
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    db = client.db(DB_NAME);
    console.log(`✅ Connected to MongoDB — Database: ${DB_NAME}`);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function splitName(fullName = '') {
  const parts     = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName  = parts.length > 1 ? parts.slice(1).join(' ') : '.';
  return { firstName, lastName };
}

// ── Budget helper: splits "1Cr - 1.25Cr" → { budgetFrom: 10000000, budgetTo: 12500000 }
function parseBudget(range) {
  range = range || '';
  const crToNum = (s) => {
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    return isNaN(n) ? 0 : Math.round(n * 10000000); // 1 Cr = 10,000,000
  };
  const parts = range.split('-').map(function(s){ return s.trim(); });
  return {
    budgetFrom: parts[0] ? crToNum(parts[0]) : 0,
    budgetTo:   parts[1] ? crToNum(parts[1]) : 0,
  };
}

function buildFarvisionPayload(data) {
  const { firstName, lastName }  = splitName(data.fullName);
  const leadDate                 = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const { budgetFrom, budgetTo } = parseBudget(data.budgetRange);

  return {
    // ── Core contact fields ──────────────────────────────────────────────────
    firstName,
    lastName,
    email:               data.email        || '',
    countryCode1:        91,                            // India dial code (hardcoded)
    mobilePhone:         data.mobileNumber || '',
    address1:            data.address      || '',

    // ── Lead classification ──────────────────────────────────────────────────
    comments:            data.referenceDetails || '',
    originFrom:          data.hearAboutUs      || 'Website Form',
    product:             data.project          || '',
    campaign:            '',                            // not captured in form
    externalAPIObjectId: 'Farvision',                   // hardcoded integration name

    // ── Profession (text values passed as-is) ────────────────────────────────
    occupationId:        data.occupation  || '',
    industryId:          data.industry    || '',
    designationId:       data.designation || '',

    // ── Budget (split into numeric From / To) ────────────────────────────────
    budgetFrom,
    budgetTo,

    // ── User-defined fields (udF_17 – udF_22) ────────────────────────────────
    udF_17:              data.purposeOfPurchase   || '', // e.g. "Personal Use"
    udF_18:              data.propertyType        || '', // e.g. "3 BHK"
    udF_19:              data.currentResidentType || '', // e.g. "Own Residence"
    udF_20:              data.willBuyIn           || '', // e.g. "3-6 months"
    udF_21:              data.locality            || '', // e.g. "Andheri West"
    udF_22:              data.leadOwner           || '', // e.g. "John"

    // ── Legacy fields kept for backward compatibility ─────────────────────────
    organization:        data.organization        || '',
    officeLocation:      data.officeLocation      || '',
    purposeOfPurchase:   data.purposeOfPurchase   || '',
    typology:            data.propertyType        || '',
    currentResidentType: data.currentResidentType || '',
    willByInPeriod:      data.willBuyIn           || '',
    owner:               data.leadOwner           || '',
    leadDate,

    // ── System fields ────────────────────────────────────────────────────────
    DumpdataObjectId:    String(Math.floor(100000 + Math.random() * 900000)),
    tenantId:            FARVISION_TENANT_ID,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  PROJECTS   /api/projects
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/projects
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await db.collection(COLLECTION_PROJECTS)
      .find({ isActive: { $ne: false } })
      .sort({ projectName: 1 })
      .toArray();
    res.json(projects);
  } catch (err) {
    console.error('GET /api/projects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects
app.post('/api/projects', async (req, res) => {
  try {
    const { projectName, location, description } = req.body;
    if (!projectName?.trim()) return res.status(400).json({ error: 'projectName is required' });
    const doc = {
      projectName:  projectName.trim(),
      location:     location    || '',
      description:  description || '',
      isActive:     true,
      createdAt:    new Date(),
      updatedAt:    new Date(),
    };
    const result = await db.collection(COLLECTION_PROJECTS).insertOne(doc);
    console.log(`✅ Project added → "${doc.projectName}"`);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    console.error('POST /api/projects:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  USERS   /api/users
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/users
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.collection(COLLECTION_USERS)
      .find({ isActive: { $ne: false } })
      .sort({ name: 1 })
      .toArray();
    res.json(users);
  } catch (err) {
    console.error('GET /api/users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users
app.post('/api/users', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const exists = await db.collection(COLLECTION_USERS).findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ error: 'User already exists' });
    const doc = { name: name.trim(), isActive: true, createdAt: new Date() };
    const result = await db.collection(COLLECTION_USERS).insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    console.error('POST /api/users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  LEADS   /api/leads
// ═════════════════════════════════════════════════════════════════════════════

// ── GET /api/leads/check-mobile/:mobile
// ⚠️ MUST be defined BEFORE /api/leads/:id — otherwise Express matches
//    "check-mobile" as a MongoDB ObjectId and throws a cast error
app.get('/api/leads/check-mobile/:mobile', async (req, res) => {
  try {
    const existing = await db.collection(COLLECTION_LEADS).findOne(
      { mobileNumber: req.params.mobile },
      { projection: { fullName: 1, mobileNumber: 1 } }
    );
    // Returns { exists: true/false, name: "Lead Name" | null }
    res.json({ exists: !!existing, name: existing?.fullName || null });
  } catch (err) {
    console.error('GET /api/leads/check-mobile:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads  (with optional dashboard filters)
app.get('/api/leads', async (req, res) => {
  try {
    const { status, city, propertyType, project, q } = req.query;
    const filter = {};

    if (status)       filter.status       = status;
    if (city)         filter.city         = new RegExp(city, 'i');
    if (propertyType) filter.propertyType = propertyType;
    if (project)      filter.project      = new RegExp(`^${project.trim()}$`, 'i');

    if (q) {
      const rx = new RegExp(q, 'i');
      filter.$or = [
        { fullName: rx }, { mobileNumber: rx }, { email: rx },
        { city: rx }, { address: rx }, { budgetRange: rx },
        { source: rx }, { project: rx },
      ];
    }

    const leads = await db.collection(COLLECTION_LEADS)
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json(leads);
  } catch (err) {
    console.error('GET /api/leads:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads — Save to MongoDB + push to Farvision ERP
app.post('/api/leads', async (req, res) => {
  try {
    // 1. Validate required fields
    const required = ['fullName', 'mobileNumber'];
    for (const field of required) {
      if (!req.body[field] || !String(req.body[field]).trim()) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }

    // 2. ── Duplicate mobile number check ──────────────────────────────────
    const duplicate = await db.collection(COLLECTION_LEADS).findOne(
      { mobileNumber: req.body.mobileNumber },
      { projection: { fullName: 1 } }
    );
    if (duplicate) {
      return res.status(409).json({
        error:   'duplicate_mobile',
        message: `Mobile number ${req.body.mobileNumber} is already registered. Lead exists for: ${duplicate.fullName}`,
      });
    }

    // 3. Build and save lead document
    const leadData = {
      ...req.body,
      status:          req.body.status || 'New',
      source:          req.body.source || 'Website Form',
      otpVerification: false,          // will be set to true after OTP confirmed
      createdAt:       new Date(),
      updatedAt:       new Date(),
    };

    const col         = db.collection(COLLECTION_LEADS);
    const mongoResult = await col.insertOne(leadData);
    console.log(`✅ Lead saved → ID: ${mongoResult.insertedId} | Name: ${leadData.fullName}`);

    // 4. Push to Farvision ERP (non-blocking — MongoDB save already done)
    let farvisionStatus = 'pending';
    try {
      const payload = buildFarvisionPayload(leadData);
      console.log('📤 Pushing to Farvision ERP...');
      const fvRes = await axios.request({
        method: 'post', maxBodyLength: Infinity,
        url: FARVISION_URL,
        headers: { 'Content-Type': 'application/json' },
        data: payload, timeout: 15000,
      });
      farvisionStatus = 'success';
      console.log('✅ Farvision sync successful:', JSON.stringify(fvRes.data));
      await col.updateOne(
        { _id: mongoResult.insertedId },
        { $set: { farvisionSynced: true, farvisionSyncedAt: new Date(), farvisionResponse: fvRes.data } }
      );
    } catch (fvErr) {
      farvisionStatus = 'failed';
      console.error('❌ Farvision sync failed:', fvErr.message);
      await col.updateOne(
        { _id: mongoResult.insertedId },
        { $set: { farvisionSynced: false, farvisionError: fvErr.message } }
      );
    }

    // 5. Always respond success if MongoDB save worked
    res.status(201).json({
      success:         true,
      message:         'Lead saved successfully',
      _id:             mongoResult.insertedId,
      id:              mongoResult.insertedId,
      farvisionStatus,
    });

  } catch (err) {
    // MongoDB unique index duplicate key fallback (error code 11000)
    if (err.code === 11000) {
      return res.status(409).json({
        error:   'duplicate_mobile',
        message: 'Mobile number already registered.',
      });
    }
    console.error('POST /api/leads:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id
app.get('/api/leads/:id', async (req, res) => {
  try {
    const lead = await db.collection(COLLECTION_LEADS)
      .findOne({ _id: new ObjectId(req.params.id) });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id — update lead from dashboard Update modal
app.patch('/api/leads/:id', async (req, res) => {
  try {
    const allowed = [
      // core fields
      'status', 'assignedTo', 'willBuyIn', 'notes', 'project',
      // update modal extra fields
      'family', 'reason', 'funding', 'inventoryPitched', 'quotation',
      'interested', 'ageGroup', 'occupation', 'caste', 'comments',
      'revisitDate', 'nextFollowUp',
      // OTP verification flag
      'otpVerification',
    ];

    const $set = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) $set[key] = req.body[key];
    }

    const result = await db.collection(COLLECTION_LEADS).findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set },
      { returnDocument: 'after' }
    );

    const updated = result?.value ?? result;
    if (!updated) return res.status(404).json({ error: 'Lead not found' });
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/leads/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ═════════════════════════════════════════════════════════════════════════════
//  OTP   /api/send-otp   /api/verify-otp
// ═════════════════════════════════════════════════════════════════════════════

// ── POST /api/send-otp
app.post('/api/send-otp', async (req, res) => {
  const { mobile, projectName } = req.body;
  if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ error: 'Valid 10-digit Indian mobile number required' });
  }

  // Generate 6-digit OTP
  const otp       = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + OTP_EXPIRY_MIN * 60 * 1000;

  // Store in memory (overwrite any previous OTP for this number)
  otpStore.set(mobile, { otp, expiresAt });

  // Use selected project name in SMS, fallback to "Silver Group" if not provided
  const senderName = (projectName && projectName.trim()) ? projectName.trim() : 'Silver Group';

  const message = encodeURIComponent(
    `Dear Customer, your OTP for verifying your enquiry with ${senderName} is ${otp} Valid for ${OTP_EXPIRY_MIN} minutes. Thank You for being our valuable customer- Silver Group`
  );

  try {
    const url = `${GUPSHUP_URL}?method=SendMessage&send_to=91${mobile}&msg=${message}&msg_type=TEXT&userid=${GUPSHUP_USERID}&auth_scheme=plain&password=${GUPSHUP_PASSWORD}&v=1.1&format=text`;

    const response = await axios.request({
      method: 'post',
      maxBodyLength: Infinity,
      url,
      headers: {},
      timeout: 10000,
    });

    console.log(`✅ OTP sent to ${mobile} → GupShup response:`, response.data);
    res.json({ success: true, message: 'OTP sent successfully' });

  } catch (err) {
    console.error('❌ GupShup OTP send failed:', err.message);
    // Clean up OTP from store on send failure
    otpStore.delete(mobile);
    res.status(502).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// ── POST /api/verify-otp
app.post('/api/verify-otp', (req, res) => {
  const { mobile, otp } = req.body;

  if (!mobile || !otp) {
    return res.status(400).json({ error: 'mobile and otp are required' });
  }

  const record = otpStore.get(mobile);

  if (!record) {
    return res.status(400).json({ error: 'No OTP found for this number. Please request a new one.' });
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(mobile);
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  }

  if (String(otp).trim() !== record.otp) {
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  }

  // OTP matched — remove from store (single-use)
  otpStore.delete(mobile);
  console.log(`✅ OTP verified for mobile: ${mobile}`);
  res.json({ success: true, message: 'OTP verified successfully' });
});

// ═════════════════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═════════════════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: db ? 'connected' : 'disconnected' });
});

app.get('/', (req, res) => {
  res.json({ status: 'Silver Group API ✅' });
});

// ─── START ────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running → http://localhost:${PORT}\n`);
    console.log(`   PROJECTS`);
    console.log(`   GET   /api/projects                  — list all projects`);
    console.log(`   POST  /api/projects                  — add new project`);
    console.log(`\n   USERS`);
    console.log(`   GET   /api/users                     — list all users`);
    console.log(`   POST  /api/users                     — add new user`);
    console.log(`\n   LEADS`);
    console.log(`   GET   /api/leads/check-mobile/:mob   — real-time duplicate check`);
    console.log(`   GET   /api/leads                     — list / filter all leads`);
    console.log(`   POST  /api/leads                     — save (otpVerification:false) + Farvision ERP sync`);
    console.log(`   GET   /api/leads/:id                 — get single lead`);
    console.log(`   PATCH /api/leads/:id                 — update lead / set otpVerification:true`);
    console.log(`\n   OTP`);
    console.log(`   POST  /api/send-otp                  — send OTP via GupShup SMS`);
    console.log(`   POST  /api/verify-otp                — verify OTP (single-use, ${OTP_EXPIRY_MIN}min expiry)`);
    console.log(`\n   GET   /health                        — health check`);
  });
});
