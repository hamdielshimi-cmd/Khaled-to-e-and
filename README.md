
# Zoho QnA App (Web) - GitHub + Railway Ready

This repository contains the Zoho QnA application (Arabic RTL) with:
- Simple login authentication (single admin user via env)
- Local KB ingestion and local RAG-style search
- Optional Gemini integration (via env variable)
- CI/CD workflow template and Railway deploy instructions

## Files included
- `server.js` - Node.js Express server (auth, ingest, search, ask)
- `package.json`
- `public/` - Frontend (login + UI)
- `README.md` - this file
- `.github/workflows/railway-deploy.yml` - CI/CD template (create Railway token secret)

## Deploy on Railway (one-click)
Click **Deploy on Railway** to create a new Railway project from this repo.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/your-org/zoho-qna-app)

> After deployment, set the following environment variables in Railway:
> - `ADMIN_USER` (e.g., admin)
> - `ADMIN_PASS` (e.g., a strong password) OR `ADMIN_PASS_HASH` (bcrypt hash)
> - `SESSION_SECRET` (random string)
> - `GEMINI_API_KEY` (optional; do NOT commit to GitHub)

## GitHub Actions (CI/CD)
A GitHub Actions workflow is included under `.github/workflows/railway-deploy.yml`.
It runs on push and can be configured to trigger Railway deployments using the Railway GitHub Action.
You must add the following secrets to your GitHub repository:
- `RAILWAY_API_KEY` (or `RAILWAY_TOKEN`) - for automatic deployment (optional)

## Custom domain (ai.eand-group.com)
To use a custom domain with Railway:
1. In Railway project settings -> Domains -> Add Domain `ai.eand-group.com`.
2. Railway will provide DNS records (CNAME / A). Add those to your DNS provider.
3. Railway provisions SSL automatically.
4. If you don't control DNS yet, ask your DNS admin to add the records Railway shows.

## Local development (run locally)
1. Clone the repo or upload files
2. Ensure KB files exist in `/mnt/data/`:
   - `/mnt/data/s.txt`
   - `/mnt/data/Zoho tutrial.txt`
   - `/mnt/data/how to use zoho.txt`
   - Optional: `/mnt/data/key.txt` (Gemini key)
3. Install:
   ```bash
   npm install
   ```
4. Run:
   ```bash
   # set admin credentials for local testing
   ADMIN_USER=admin ADMIN_PASS=password node server.js
   ```
5. Open: http://localhost:3000
6. Login (default: admin / password) then click "تحميل وفهرسة المصادر".

## Security notes
- NEVER commit your `GEMINI_API_KEY` or admin password to GitHub.
- Use Railway/GitHub secrets for production keys.
