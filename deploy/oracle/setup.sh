#!/usr/bin/env bash
# 🟠 First Forward Dashboard → Oracle Cloud (Always Free ARM, Ubuntu 22.04/24.04)
# Ek hi command:  curl -fsSL https://raw.githubusercontent.com/apstarun345-jpg/First-Forward-Dashboard/main/deploy/oracle/setup.sh | bash
#
# Kya karta hai: Node 20 + git + Caddy (free HTTPS) install · ports 80/443 khole ·
# app clone · /etc/ffdash.env (Render ke env vars yahan) · systemd service (auto-restart) ·
# har 2 min GitHub check → naya commit aaye to auto-deploy (Render jaisa).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/apstarun345-jpg/First-Forward-Dashboard.git}"
BRANCH="${BRANCH:-main}"
APP_USER=ffdash
APP_DIR=/opt/ffdash/app
DATA_DIR=/var/lib/ffdash
ENV_FILE=/etc/ffdash.env

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] && SUDO="" || SUDO="sudo"

say "1/8 System packages"
$SUDO apt-get update -y
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

say "2/8 Node.js 20"
if ! command -v node >/dev/null || ! node -v | grep -q '^v2[0-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
node -v

say "3/8 Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $SUDO apt-get update -y && $SUDO apt-get install -y caddy
fi

say "4/8 Firewall: ports 80 + 443 (Oracle Ubuntu image iptables me band hote hain)"
for p in 80 443; do
  $SUDO iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT 6 -p tcp --dport $p -m state --state NEW -j ACCEPT
done
$SUDO netfilter-persistent save

say "5/8 App user"
id -u $APP_USER >/dev/null 2>&1 || $SUDO useradd --system --create-home --home-dir /opt/ffdash --shell /bin/bash $APP_USER
$SUDO mkdir -p "$DATA_DIR" && $SUDO chown -R $APP_USER:$APP_USER "$DATA_DIR" /opt/ffdash

say "6/8 Clone app"
if [ ! -d "$APP_DIR/.git" ]; then
  $SUDO -u $APP_USER git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  $SUDO -u $APP_USER git -C "$APP_DIR" pull --ff-only
fi
( cd "$APP_DIR" && $SUDO -u $APP_USER npm install --omit=dev --no-audit --no-fund )

say "7/8 Environment file ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  $SUDO cp "$APP_DIR/deploy/oracle/ffdash.env.example" "$ENV_FILE"
  $SUDO chmod 600 "$ENV_FILE"
  echo "⚠️  $ENV_FILE me Render ke env vars bharo:  sudo nano $ENV_FILE"
  read -r -p "Bhar diya? Enter dabao… " _ < /dev/tty
fi

say "8/8 Services (app + auto-update + HTTPS)"
PUBIP=$(curl -fsS https://api.ipify.org || true)
DOMAIN_DEFAULT="${PUBIP//./-}.sslip.io"
DOMAIN="${DOMAIN:-$(grep -E '^SITE_DOMAIN=' "$ENV_FILE" | cut -d= -f2- || true)}"
DOMAIN="${DOMAIN:-$DOMAIN_DEFAULT}"
$SUDO cp "$APP_DIR/deploy/oracle/ffdash.service" /etc/systemd/system/ffdash.service
$SUDO cp "$APP_DIR/deploy/oracle/ffdash-update.service" /etc/systemd/system/ffdash-update.service
$SUDO cp "$APP_DIR/deploy/oracle/ffdash-update.timer" /etc/systemd/system/ffdash-update.timer
$SUDO install -m 755 "$APP_DIR/deploy/oracle/update.sh" /usr/local/bin/ffdash-update
sed "s/{{DOMAIN}}/$DOMAIN/g" "$APP_DIR/deploy/oracle/Caddyfile" | $SUDO tee /etc/caddy/Caddyfile >/dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now ffdash.service ffdash-update.timer
$SUDO systemctl restart caddy
sleep 5
curl -fsS http://127.0.0.1:10000/api/health >/dev/null && echo "✅ App chal raha hai" || echo "⚠️ App abhi start nahi hua — logs: sudo journalctl -u ffdash -n 80"
echo
echo "🌐 Site: https://$DOMAIN   (HTTPS certificate 1-2 min me banta hai)"
echo "📜 Logs: sudo journalctl -u ffdash -f      🔁 Restart: sudo systemctl restart ffdash"
