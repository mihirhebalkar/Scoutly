# Scoutly Configuration

## Projects
- Frontend: Vite/React (`Frontend`)
- Backend: Node/Express (`Backend`)
- FastAPI: on hold (`ai_service`)

## Local Development
- Frontend dev: http://localhost:5173
- Backend dev: http://localhost:5000
- FastAPI dev: http://localhost:8000

### Frontend env (copy from Frontend/.env.local.sample)
- VITE_API_URL=http://localhost:5000
- VITE_FASTAPI_URL=http://localhost:8000

### Backend env (copy from Backend/.env.sample)
- PORT=5000
- MONGO_URI=<your local or cloud URI>
- JWT_SECRET=<dev secret>
- FASTAPI_URL=http://127.0.0.1:8000

## Production on Vercel
Create two Vercel projects:

### Frontend project (scoutly13.vercel.app)
- Root Directory: `Frontend`
- Framework Preset: Vite
- Env vars:
  - VITE_API_URL=https://scoutly13-api.vercel.app
  - VITE_FASTAPI_URL=https://scoutly13-fastapi.vercel.app (placeholder until FastAPI is deployed)

### Backend project (scoutly13-api.vercel.app)
- Root Directory: `Backend`
- Uses `vercel.json` routing to `app.js`
- Env vars:
  - MONGO_URI=<production connection string>
  - JWT_SECRET=<production jwt secret>
  - FASTAPI_URL=http://127.0.0.1:8000 (switch to https://scoutly13-fastapi.vercel.app when live)

## CORS
Backend allows:
- https://scoutly13.vercel.app
- http://localhost:5173
- Any *.vercel.app (preview URLs)
- No-Origin requests (Postman/CLI)

FastAPI CORS will be tightened later when deployed.

## Notes
- Backend `app.js` exports the Express app on Vercel and listens locally.
- Frontend uses Vite envs for API base URLs; no code changes required between environments.
