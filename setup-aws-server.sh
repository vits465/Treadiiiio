#!/bin/bash

echo "===================================================="
echo "   Forex Bot - AWS EC2 Free Tier Auto-Setup Script  "
echo "===================================================="

# 1. System updates & basic tools
echo "[1/6] Installing core tools & packages..."
sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl python3 python3-venv python3-pip build-essential nginx ufw

# 2. Setup 3GB Swap file (Essential for AWS EC2 t2.micro / t3.micro 1GB RAM)
if [ ! -f /swapfile ]; then
    echo "[2/6] Creating 3GB Swap memory for Python ML XGBoost..."
    sudo fallocate -l 3G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=3072
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap memory active."
else
    echo "[2/6] Swap memory already exists."
fi

# 3. Install Node.js 20 & PM2
if ! command -v node &> /dev/null; then
    echo "[3/6] Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2 process manager..."
    sudo npm install -g pm2
fi

# 4. Install Node dependencies & build TypeScript
echo "[4/6] Installing project dependencies & building TypeScript..."
npm install
npm run build

# 5. Setup Python Virtual Environment in ml-service
echo "[5/6] Setting up Python virtual environment in ml-service..."
cd ml-service
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
cd ..

# 6. Start services via PM2
echo "[6/6] Launching all services with PM2..."
pm2 start ecosystem.config.js
pm2 save

echo "===================================================="
echo "   SUCCESS! All services deployed and running 24/7.  "
echo "===================================================="
echo "Check status: pm2 status"
echo "Check logs:   pm2 logs"
