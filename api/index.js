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

  const payload = {
    firstName,
    lastName,
    email:               data.email             || '',
    cityID:              data.cityID             || '',
    countryCode1:        91,
    mobilePhone:         data.mobileNumber       || '',
    address1:            data.address      || '',
    address: {
      line1:       data.address      || null,
      line2:       data.locality     || null,
      countryDesc: data.country      || null,
      cityDesc:    data.city         ? data.city.toUpperCase() : null,
      zipCode:     data.pinCode      || null,
    },
    comments:            data.referenceDetails   || '',
    originFrom:          data.hearAboutUs        || 'Website Form',
    product:             data.project            || '',
    campaign:            '',
    externalAPIObjectId: 'Farvision',
    occupationId:        data.occupation         || '',
    industryId:          data.industry           || '',
    designationId:       data.designation        || '',
    budgetFrom,
    budgetTo,
    udF_17:              data.occupation         || '',
    udF_18:              data.organization       || '',
    udF_19:              data.officeLocation     || '',
    udF_20:              data.purposeOfPurchase  || '',
    udF_21:              data.currentResidentType || '',
    udF_22:              data.willBuyIn          || '',
    udF_23:              data.mobileNumber       || '',
    udF_24:              '',
    udF_25:              data.email              || '',
    organization:        data.organization       || '',
    officeLocation:      data.officeLocation     || '',
    purposeOfPurchase:   data.purposeOfPurchase  || '',
    typology:            data.propertyType       || '',
    currentResidentType: data.currentResidentType || '',
    willByInPeriod:      data.willBuyIn          || '',
    ownerID:             data.leadOwner          || '',
    leadDate,
    DumpdataObjectId:    String(Math.floor(100000 + Math.random() * 900000)),
    tenantId:            Number(FARVISION_TENANT_ID),
  };

  console.log('[Farvision] Built payload:', JSON.stringify(payload));
  return payload;
}

// ─── FARVISION PUSH HELPER ───────────────────────────────────────────────────────
async function pushToFarvision(database, leadId, leadData) {
  try {
    const payload = buildFarvisionPayload(leadData);
    console.log('[Farvision] Pushing lead:', leadId);
    console.log('[Farvision] Payload:', JSON.stringify(payload));

    const fvRes = await axios.post(FARVISION_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
      maxBodyLength: Infinity,
    });

    console.log('[Farvision] SUCCESS - HTTP:', fvRes.status, 'Body:', JSON.stringify(fvRes.data));

    await database.collection(COL_LEADS).updateOne(
      { _id: new ObjectId(leadId) },
      { $set: {
          farvisionSynced:    true,
          farvisionSyncedAt:  new Date(),
          farvisionResponse:  fvRes.data,
          farvisionError:     null,
      }}
    );
  } catch (fvErr) {
    console.error('[Farvision] FAILED - Lead:', leadId);
    console.error('[Farvision] Message:', fvErr.message);
    if (fvErr.response) {
      console.error('[Farvision] HTTP status:', fvErr.response.status);
      console.error('[Farvision] Response body:', JSON.stringify(fvErr.response.data));
    }
    await database.collection(COL_LEADS).updateOne(
      { _id: new ObjectId(leadId) },
      { $set: {
          farvisionSynced:      false,
          farvisionError:       fvErr.message,
          farvisionErrorDetail: fvErr.response?.data  || null,
          farvisionErrorStatus: fvErr.response?.status || null,
      }}
    );
  }
}

// ─── EXPRESS APP ──────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type'] }));
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

    // Strip control flags — never persist these in MongoDB
    const { skipErp: _s, pushToErp: _p, ...cleanBody } = req.body;

    const leadData = {
      ...cleanBody,
      status:          cleanBody.status || 'New',
      source:          cleanBody.source || 'Website Form',
      otpVerification: false,
      farvisionSynced: false,
      createdAt:       new Date(),
      updatedAt:       new Date(),
    };

    const mongoResult = await database.collection(COL_LEADS).insertOne(leadData);

    // Push to Farvision only when skipErp is NOT set (i.e. OTP already verified)
    let farvisionStatus = 'skipped';
    if (!req.body.skipErp) {
      try {
        const payload = buildFarvisionPayload(leadData);
        const fvRes = await axios.request({ method: 'post', maxBodyLength: Infinity, url: FARVISION_URL, headers: { 'Content-Type': 'application/json' }, data: payload, timeout: 15000 });
        farvisionStatus = 'success';
        await database.collection(COL_LEADS).updateOne({ _id: mongoResult.insertedId }, { $set: { farvisionSynced: true, farvisionSyncedAt: new Date(), farvisionResponse: fvRes.data } });
      } catch (fvErr) {
        farvisionStatus = 'failed';
        await database.collection(COL_LEADS).updateOne({ _id: mongoResult.insertedId }, { $set: { farvisionSynced: false, farvisionError: fvErr.message } });
      }
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

    // All form fields the frontend can update (covers both "go back & edit" and post-OTP patch)
    const allowed = [
      'project', 'fullName', 'email', 'mobileNumber', 'address', 'locality', 'city', 'country', 'pinCode',
      'visitingFor', 'occupation', 'organization', 'industry', 'designation', 'officeLocation', 'officePinCode',
      'purposeOfPurchase', 'propertyType', 'currentResidentType', 'budgetRange', 'willBuyIn',
      'hearAboutUs', 'referenceDetails',
      'channelPartnerCompany', 'channelPartnerName', 'channelPartnerMobile', 'channelPartnerRERA', 'channelPartnerEmail',
      'leadOwner',
      // CRM / internal fields
      'status', 'assignedTo', 'notes', 'family', 'reason', 'funding', 'inventoryPitched',
      'quotation', 'interested', 'ageGroup', 'caste', 'comments',
      'revisitDate', 'nextFollowUp', 'otpVerification',
    ];

    const $set = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) $set[key] = req.body[key];
    }

    // Step 1: update the document
    const updateResult = await database.collection(COL_LEADS).updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set }
    );
    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Step 2: re-fetch as a clean plain JS object — avoids BSON ObjectId spread crash
    const updated = await database.collection(COL_LEADS).findOne(
      { _id: new ObjectId(req.params.id) }
    );
    if (!updated) return res.status(404).json({ error: 'Lead not found after update' });

    // Step 3: push to Farvision ERP after OTP verification
    // IMPORTANT: On Vercel serverless, fire-and-forget after res.send() is killed immediately.
    // We MUST await the push BEFORE responding, then always return 200 regardless of ERP result.
    if (req.body.pushToErp) {
      let farvisionStatus = 'pending';
      let farvisionError  = null;
      try {
        const payload = buildFarvisionPayload(updated);
        console.log('[Farvision] Pushing lead:', req.params.id);
        console.log('[Farvision] Payload:', JSON.stringify(payload));

        const fvRes = await axios.post(FARVISION_URL, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 25000,       // 25s — must complete before Vercel's 30s max
          maxBodyLength: Infinity,
        });

        console.log('[Farvision] SUCCESS - HTTP:', fvRes.status, 'Body:', JSON.stringify(fvRes.data));
        farvisionStatus = 'success';

        await database.collection(COL_LEADS).updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: {
              farvisionSynced:    true,
              farvisionSyncedAt:  new Date(),
              farvisionResponse:  fvRes.data,
              farvisionError:     null,
          }}
        );
      } catch (fvErr) {
        farvisionStatus = 'failed';
        farvisionError  = fvErr.message;
        console.error('[Farvision] FAILED - Lead:', req.params.id);
        console.error('[Farvision] Message:', fvErr.message);
        if (fvErr.response) {
          console.error('[Farvision] HTTP status:', fvErr.response.status);
          console.error('[Farvision] Response body:', JSON.stringify(fvErr.response.data));
        }
        await database.collection(COL_LEADS).updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: {
              farvisionSynced:      false,
              farvisionError:       fvErr.message,
              farvisionErrorDetail: fvErr.response?.data  || null,
              farvisionErrorStatus: fvErr.response?.status || null,
          }}
        );
      }
      // Always return 200 — OTP is verified regardless of ERP result
      return res.json({ success: true, farvisionStatus, farvisionError });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/leads/:id] Unhandled error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/leads/:id  (used when user goes back and changes mobile number)
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const database = await getDB();
    const result = await database.collection(COL_LEADS).deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true });
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

// ── POST /api/retry-farvision/:id  (retry Farvision push for a failed/pending lead)
app.post('/api/retry-farvision/:id', async (req, res) => {
  try {
    const database = await getDB();
    const lead = await database.collection(COL_LEADS).findOne({ _id: new ObjectId(req.params.id) });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.otpVerification) return res.status(400).json({ error: 'OTP not verified for this lead. Cannot push to ERP.' });

    // Await push — fire-and-forget does NOT work on Vercel serverless
    await pushToFarvision(database, req.params.id, lead);
    res.json({ success: true, message: 'Farvision push completed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/debug/farvision/:id  (test Farvision push for any lead — remove in production)
app.get('/api/debug/farvision/:id', async (req, res) => {
  try {
    const database = await getDB();
    const lead = await database.collection(COL_LEADS).findOne({ _id: new ObjectId(req.params.id) });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const payload = buildFarvisionPayload(lead);
    console.log('[DEBUG Farvision] Payload:', JSON.stringify(payload, null, 2));

    try {
      const fvRes = await axios.post(FARVISION_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      res.json({ status: 'success', httpStatus: fvRes.status, farvisionResponse: fvRes.data, payloadSent: payload });
    } catch (fvErr) {
      res.json({
        status: 'failed',
        error: fvErr.message,
        httpStatus: fvErr.response?.status,
        farvisionResponse: fvErr.response?.data,
        payloadSent: payload,
      });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /health
app.get('/health', async (req, res) => {
  res.json({ status: 'ok', db: db ? 'connected' : 'disconnected' });
});

// ─── EXPORT for Vercel serverless ─────────────────────────────────────────────
module.exports = app;
