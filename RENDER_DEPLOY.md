# Render Deployment Checklist

Use this checklist if your deployed app isn't working.

## 1. Deploy Backend First

1. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**
2. Connect your GitHub repo: `Ben-W-Yal/Chatapp_webcode`
3. Settings:
   - **Name:** `chatapp-backend`
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server/index.js`

4. **Environment Variables** (required):
   | Key | Value |
   |-----|-------|
   | `MONGODB_URI` | Your full MongoDB Atlas connection string, e.g. `mongodb+srv://user:password@cluster.mongodb.net/` |
| `YOUTUBE_API_KEY` | (Optional) For YouTube Channel Download. Get at [Google Cloud Console](https://console.cloud.google.com/) → enable YouTube Data API v3 |

5. Deploy and wait for it to succeed. Copy the backend URL (e.g. `https://chatapp-backend.onrender.com`).

## 2. MongoDB Atlas: Allow Render

In [MongoDB Atlas](https://cloud.mongodb.com) → **Network Access** → **Add IP Address**:
- Add `0.0.0.0/0` (allow from anywhere) — Render uses dynamic IPs.

## 3. Deploy Frontend

1. **New** → **Static Site** → same repo
2. Settings:
   - **Name:** `chatapp-frontend`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `build`

3. **Environment Variables** (required):
   | Key | Value |
   |-----|-------|
   | `REACT_APP_GEMINI_API_KEY` | Your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) |
   | `REACT_APP_API_URL` | Your backend URL **with no trailing slash**, e.g. `https://chatapp-backend.onrender.com` |

4. Deploy. After changing env vars, trigger **Manual Deploy** (env vars are baked in at build time).

## 4. Common Issues

| Problem | Fix |
|---------|-----|
| Blank page / "Cannot GET /" | Frontend build failed or wrong Publish Directory. Check build logs. |
| Login/signup doesn't work | `REACT_APP_API_URL` is wrong or missing. Must be exact backend URL. |
| "Failed to fetch" / network errors | Backend might be sleeping (free tier). Wait 30–60 seconds and retry. |
| Backend crashes on start | `MONGODB_URI` missing or invalid. Check MongoDB Atlas Network Access. |
| CORS errors | Backend uses `cors()` with no restrictions — should work. Verify backend URL. |

## 5. Free Tier Cold Starts

Render free tier spins down after ~15 min of inactivity. The first request can take **30–60 seconds**. This is normal.

## 6. Verify Backend

Visit `https://YOUR-BACKEND-URL.onrender.com` — you should see "Chat API Server" and a link to check DB status.
