require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { fetchChannelVideos } = require('./youtube');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  if (!URI || !URI.trim()) {
    throw new Error(
      'MongoDB URI missing. Add REACT_APP_MONGODB_URI to your .env file.\n' +
      'Get a free connection string at https://www.mongodb.com/cloud/atlas'
    );
  }
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

// ── YouTube channel download ───────────────────────────────────────────────────

// ── Image generation (Gemini Imagen) ───────────────────────────────────────────

app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, anchorImageBase64 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt required' });

    const apiKey = process.env.REACT_APP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey?.trim()) {
      return res.status(500).json({ error: 'GEMINI_API_KEY or REACT_APP_GEMINI_API_KEY required for image generation' });
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    let imageBase64;
    if (anchorImageBase64) {
      // Use Gemini 2.5 Flash Image for image + text → image (supports reference/editing)
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          { inlineData: { mimeType: 'image/png', data: anchorImageBase64 } },
          { text: prompt },
        ],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });
      const imgPart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      imageBase64 = imgPart?.inlineData?.data;
    } else {
      // Use Imagen 4 for text-only generation
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt,
        config: { numberOfImages: 1 },
      });
      imageBase64 = response?.generatedImages?.[0]?.image?.imageBytes;
    }

    if (!imageBase64) {
      return res.status(500).json({ error: 'Image generation failed — no image returned. The model may have blocked the content.' });
    }

    res.json({ imageBase64, mimeType: 'image/png' });
  } catch (err) {
    console.error('[generate-image]', err.message);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

app.post('/api/youtube/channel', async (req, res) => {
  try {
    const { url, maxVideos = 10 } = req.body;
    if (!url) return res.status(400).json({ error: 'Channel URL required' });
    const max = Math.min(Math.max(parseInt(maxVideos, 10) || 10, 1), 100);
    const videos = await fetchChannelVideos(url, max);
    // Do NOT write to public/ — the committed veritasium-channel-data.json is the canonical credible sample.
    // Users download JSON via the UI button instead.
    res.json({ videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : null,
      lastName: lastName ? String(lastName).trim() : null,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent, title, jsonData } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const doc = {
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    };
    if (Array.isArray(jsonData) && jsonData.length > 0) {
      doc.jsonData = jsonData;
    }
    const result = await db.collection('sessions').insertOne(doc);
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id/json', async (req, res) => {
  try {
    const doc = await db.collection('sessions').findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { jsonData: 1 } }
    );
    const data = doc?.jsonData;
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sessions/:id/json', async (req, res) => {
  try {
    const { jsonData } = req.body;
    if (!Array.isArray(jsonData)) return res.status(400).json({ error: 'jsonData must be an array' });
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { jsonData } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
