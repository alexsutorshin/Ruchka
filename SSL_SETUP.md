# SSL/TLS Setup Instructions

## 1. Install Certbot (Let's Encrypt)

### Ubuntu/Debian:
```bash
sudo apt update
sudo apt install certbot
```

### CentOS/RHEL:
```bash
sudo yum install certbot
```

## 2. Generate SSL Certificate

### For domain name:
```bash
sudo certbot certonly --standalone -d yourdomain.com
```

### For IP address (self-signed):
```bash
sudo openssl req -x509 -newkey rsa:4096 -keyout /etc/ssl/private/server.key -out /etc/ssl/certs/server.crt -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=yourdomain.com"
```

## 3. Set Environment Variables

Add to your `.env` file:
```bash
NODE_ENV=production
ENABLE_HTTPS=true
HTTPS_PORT=3443
SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
```

## 4. Update PM2 Configuration

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'rrweb-ingest',
    script: 'app.js',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      ENABLE_HTTPS: 'true',
      HTTPS_PORT: 3443,
      SSL_KEY_PATH: '/etc/letsencrypt/live/yourdomain.com/privkey.pem',
      SSL_CERT_PATH: '/etc/letsencrypt/live/yourdomain.com/fullchain.pem'
    }
  }]
}
```

## 5. Auto-renewal Setup

Add to crontab:
```bash
sudo crontab -e
```

Add line:
```
0 12 * * * /usr/bin/certbot renew --quiet && pm2 restart rrweb-ingest
```

## 6. Firewall Configuration

```bash
sudo ufw allow 3443/tcp
sudo ufw allow 3000/tcp
```

## 7. Modern TLS Features Enabled

- TLS 1.2+ only
- Modern cipher suites (ECDHE, AES-GCM)
- HSTS headers
- Secure cipher ordering
- Weak ciphers disabled

## Security Notes

- Certificates are automatically renewed
- Both HTTP and HTTPS servers run for compatibility
- Modern TLS configuration prevents downgrade attacks
- CSP headers provide additional security layer
