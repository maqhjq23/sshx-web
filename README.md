# SSHx - Web SSH Terminal

A web-based SSH terminal for remotely controlling Termux or any SSH server.
Built with Python (Flask + WebSocket) and xterm.js.

## Features

- **Real-time terminal** via WebSocket + xterm.js
- **SSH password & key auth** support
- **Responsive** dark-themed UI
- **Deploy to Railway** ready
- **Optional web auth** to protect your terminal

## Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select this repository
4. Railway auto-detects the Dockerfile
5. Set environment variables (optional):
   - `AUTH_USER` - Web login username
   - `AUTH_PASS` - Web login password
   - `SECRET_KEY` - Flask secret key (auto-generated if empty)

## Termux Setup

On your Termux device:

```bash
pkg install openssh
sshd
whoami  # find your username
passwd   # set password
ifconfig  # find your IP
```

Default Termux SSH port: **8022**

## Custom Domain (Railway)

1. Railway Dashboard → Your Project → Settings → Domains
2. Add your custom domain
3. Point your DNS CNAME to `up.railway.app`
4. Railway auto-provisions SSL via Let's Encrypt

## Local Development

```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:5000
```

## License
MIT