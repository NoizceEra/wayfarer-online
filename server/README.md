# Wayfarer relay

Thin Colyseus relay — no game rules. Host client is authoritative.

```powershell
npm install
npm start   # PORT=2567 by default
```

Railway: point at `server/` (root railway.json already does). Client connects via
`VITE_SERVER_URL` (e.g. `wss://your-relay.up.railway.app`).
