# LUXI Local Execution Server

Run this on your Mac or DigitalOcean droplet to give the AI agent real terminal access.

## Setup

```bash
cd runner
node server.js
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LUXI_RUNNER_SECRET` | (none) | Shared signing secret — set this and put the same value in Admin > Runner |
| `PORT` | `3210` | Port to listen on |
| `WORK_DIR` | `/tmp/luxi-runner` | Where project sandboxes are created |

## Production (DigitalOcean Droplet)

```bash
# Install PM2
npm install -g pm2

# Start with PM2
LUXI_RUNNER_SECRET=yourtoken PORT=3210 pm2 start server.js --name luxi-runner

# Auto-start on reboot
pm2 startup
pm2 save
```

## Exposing on DigitalOcean

Make sure port 3210 is open in your firewall:
```bash
ufw allow 3210/tcp
```

Then in Admin > Runner, set the URL to: `http://YOUR_DROPLET_IP:3210`

## Running on Mac (local dev)

Just run the server and use `http://localhost:3210` in Admin > Runner.
For the Supabase edge function to reach it, expose it with ngrok:
```bash
ngrok http 3210
```
Then use the ngrok URL in Admin > Runner.

## Security

- Set `LUXI_RUNNER_SECRET` — the backend signs each runner request with this shared secret
- The runner sandboxes each project in its own directory
- Commands run as the user running the server (use a dedicated low-privilege user in production)
