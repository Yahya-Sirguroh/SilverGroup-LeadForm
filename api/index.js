'use strict';

const express        = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors           = require('cors');
const axios          = require('axios');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const MONGODB_URI     = process.env.MONGODB_URI;
const DB_NAME         = 'silvergroup';
const COL_LEADS       = 'tblleadform';
const COL_PROJECTS    = 'tblproject';
const COL_USERS       = 'tblusers';

const FARVISION_URL       = process.env.FARVISION_URL || 'https://fvintegration.farvisioncloud.com/LeadSync/api/SyncLeadsV2/RawLeads';
const FARVISION_TENANT_ID = process.env.FARVISION_TENANT_ID || 995;
const GUPSHUP_USERID      = process.env.GUPSHUP_USERID   || '2000264784';
const GUPSHUP_PASSWORD    = process.env.GUPSHUP_PASSWORD || 'ZSHN3pyY';
const GUPSHUP_URL         = 'https://enterprise.smsgupshup.com/GatewayAPI/rest';
const OTP_EXPIRY_MIN      = 10;

// ─── OTP STORE (in-memory) ────────────────────────────────────────────────────
const otpStore = new Map();

// ─── DB CONNECTION (cached across warm invocations) ───────────────────────────
let db;
async function getDB() {
  if (db) return db;
  const client = new MongoClient(MONGODB_URI, { tls: true, tlsInsecure: true });
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function splitName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.length > 1 ? parts.slice(1).join(' ') : '.' };
}

function parseBudget(range = '') {
  const crToNum = s => { const n = parseFloat(s.replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : Math.round(n * 10000000); };
  const parts = range.split('-').map(s => s.trim());
  return { budgetFrom: parts[0] ? crToNum(parts[0]) : 0, budgetTo: parts[1] ? crToNum(parts[1]) : 0 };
}

function buildFarvisionPayload(data) {
  const { firstName, lastName }  = splitName(data.fullName);
  const leadDate                 = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const { budgetFrom, budgetTo } = parseBudget(data.budgetRange);
  return {
    firstName, lastName,
    email:               data.email        || '',
    countryCode1:        91,
    mobilePhone:         data.mobileNumber || '',
    address1:            data.address      || '',
    comments:            data.referenceDetails || '',
    originFrom:          data.hearAboutUs      || 'Website Form',
    product:             data.project          || '',
    campaign:            '',
    externalAPIObjectId: 'Farvision',
    occupationId:        data.occupation  || '',
    industryId:          data.industry    || '',
    designationId:       data.designation || '',
    budgetFrom, budgetTo,
    udF_17:              data.purposeOfPurchase   || '',
    udF_18:              data.propertyType        || '',
    udF_19:              data.currentResidentType || '',
    udF_20:              data.willBuyIn           || '',
    udF_21:              data.locality            || '',
    udF_22:              data.leadOwner           || '',
    organization:        data.organization        || '',
    officeLocation:      data.officeLocation      || '',
    purposeOfPurchase:   data.purposeOfPurchase   || '',
    typology:            data.propertyType        || '',
    currentResidentType: data.currentResidentType || '',
    willByInPeriod:      data.willBuyIn           || '',
    owner:               data.leadOwner           || '',
    leadDate,
    DumpdataObjectId:    String(Math.floor(100000 + Math.random() * 900000)),
    tenantId:            FARVISION_TENANT_ID,
  };
}

// ─── EXPRESS APP ──────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// ── GET /api/projects
app.get('/api/projects', async (req, res) => {
  try {
    const database = await getDB();
    const projects = await database.collection(COL_PROJECTS)
      .find({ isActive: { $ne: false } }).sort({ projectName: 1 }).toArray();
    res.json(projects);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/projects
app.post('/api/projects', async (req, res) => {
  try {
    const { projectName, location, description } = req.body;
    if (!projectName?.trim()) return res.status(400).json({ error: 'projectName is required' });
    const database = await getDB();
    const doc = { projectName: projectName.trim(), location: location || '', description: description || '', isActive: true, createdAt: new Date(), updatedAt: new Date() };
    const result = await database.collection(COL_PROJECTS).insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/users
app.get('/api/users', async (req, res) => {
  try {
    const database = await getDB();
    const users = await database.collection(COL_USERS)
      .find({ isActive: { $ne: false } }).sort({ name: 1 }).toArray();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/users
app.post('/api/users', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const database = await getDB();
    const exists = await database.collection(COL_USERS).findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ error: 'User already exists' });
    const doc = { name: name.trim(), isActive: true, createdAt: new Date() };
    const result = await database.collection(COL_USERS).insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/leads/check-mobile/:mobile
app.get('/api/leads/check-mobile/:mobile', async (req, res) => {
  try {
    const database = await getDB();
    const exists = await database.collection(COL_LEADS).findOne({ mobileNumber: req.params.mobile });
    res.json({ exists: !!exists });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/leads
app.get('/api/leads', async (req, res) => {
  try {
    const database = await getDB();
    const filter = {};
    if (req.query.status)  filter.status  = req.query.status;
    if (req.query.project) filter.project = req.query.project;
    const leads = await database.collection(COL_LEADS)
      .find(filter).sort({ createdAt: -1 }).toArray();
    res.json(leads);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/leads
app.post('/api/leads', async (req, res) => {
  try {
    const database = await getDB();

    // Duplicate mobile check
    const existing = await database.collection(COL_LEADS).findOne({ mobileNumber: req.body.mobileNumber });
    if (existing) return res.status(409).json({ error: 'duplicate_mobile', message: 'Mobile number already registered.' });

    const leadData = {
      ...req.body,
      status:          req.body.status || 'New',
      source:          req.body.source || 'Website Form',
      otpVerification: false,
      createdAt:       new Date(),
      updatedAt:       new Date(),
    };

    const mongoResult = await database.collection(COL_LEADS).insertOne(leadData);

    // Push to Farvision (non-blocking)
    let farvisionStatus = 'pending';
    try {
      const payload = buildFarvisionPayload(leadData);
      const fvRes = await axios.request({ method: 'post', maxBodyLength: Infinity, url: FARVISION_URL, headers: { 'Content-Type': 'application/json' }, data: payload, timeout: 15000 });
      farvisionStatus = 'success';
      await database.collection(COL_LEADS).updateOne({ _id: mongoResult.insertedId }, { $set: { farvisionSynced: true, farvisionSyncedAt: new Date(), farvisionResponse: fvRes.data } });
    } catch (fvErr) {
      farvisionStatus = 'failed';
      await database.collection(COL_LEADS).updateOne({ _id: mongoResult.insertedId }, { $set: { farvisionSynced: false, farvisionError: fvErr.message } });
    }

    res.status(201).json({ success: true, message: 'Lead saved successfully', _id: mongoResult.insertedId, id: mongoResult.insertedId, farvisionStatus });

  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'duplicate_mobile', message: 'Mobile number already registered.' });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id
app.get('/api/leads/:id', async (req, res) => {
  try {
    const database = await getDB();
    const lead = await database.collection(COL_LEADS).findOne({ _id: new ObjectId(req.params.id) });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/leads/:id
app.patch('/api/leads/:id', async (req, res) => {
  try {
    const database = await getDB();
    const allowed = ['status', 'assignedTo', 'willBuyIn', 'notes', 'project', 'family', 'reason', 'funding', 'inventoryPitched', 'quotation', 'interested', 'ageGroup', 'occupation', 'caste', 'comments', 'revisitDate', 'nextFollowUp', 'otpVerification'];
    const $set = { updatedAt: new Date() };
    for (const key of allowed) { if (req.body[key] !== undefined) $set[key] = req.body[key]; }
    const result = await database.collection(COL_LEADS).findOneAndUpdate({ _id: new ObjectId(req.params.id) }, { $set }, { returnDocument: 'after' });
    const updated = result?.value ?? result;
    if (!updated) return res.status(404).json({ error: 'Lead not found' });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/send-otp
app.post('/api/send-otp', async (req, res) => {
  const { mobile, projectName } = req.body;
  if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: 'Valid 10-digit Indian mobile number required' });
  const otp       = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + OTP_EXPIRY_MIN * 60 * 1000;
  otpStore.set(mobile, { otp, expiresAt });
  const senderName = (projectName && projectName.trim()) ? projectName.trim() : 'Silver Group';
  const message = encodeURIComponent(`Dear Customer, your OTP for verifying your enquiry with ${senderName} is ${otp} Valid for ${OTP_EXPIRY_MIN} minutes. Thank You for being our valuable customer- Silver Group`);
  try {
    const url = `${GUPSHUP_URL}?method=SendMessage&send_to=91${mobile}&msg=${message}&msg_type=TEXT&userid=${GUPSHUP_USERID}&auth_scheme=plain&password=${GUPSHUP_PASSWORD}&v=1.1&format=text`;
    await axios.request({ method: 'post', maxBodyLength: Infinity, url, headers: {}, timeout: 10000 });
    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    otpStore.delete(mobile);
    res.status(502).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// ── POST /api/verify-otp
app.post('/api/verify-otp', (req, res) => {
  const { mobile, otp } = req.body;
  if (!mobile || !otp) return res.status(400).json({ error: 'mobile and otp are required' });
  const record = otpStore.get(mobile);
  if (!record)                    return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
  if (Date.now() > record.expiresAt) { otpStore.delete(mobile); return res.status(400).json({ error: 'OTP expired. Please request a new one.' }); }
  if (String(otp).trim() !== record.otp) return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  otpStore.delete(mobile);
  res.json({ success: true, message: 'OTP verified successfully' });
});

// ── GET /health
app.get('/health', async (req, res) => {
  res.json({ status: 'ok', db: db ? 'connected' : 'disconnected' });
});

// ─── EXPORT for Vercel serverless ─────────────────────────────────────────────
module.exports = app;
