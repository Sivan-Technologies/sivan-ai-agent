# 💎 Admin Fee Management System - Production Hardening Guide

This document covers how to safely operate, secure, and troubleshoot the Sivan Escrow Agent's dynamic fee management system in production.

---

## Table of Contents
1. [Overview](#overview)
2. [Security Setup](#security-setup)
3. [API Endpoints](#api-endpoints)
4. [Admin Operations](#admin-operations)
5. [Monitoring & Alerts](#monitoring--alerts)
6. [Emergency Procedures](#emergency-procedures)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### What is the Fee Management System?

The fee management system allows authorized admins to **dynamically adjust platform fees** without code changes or server restarts. All changes are:
- ✅ **Persisted** to database with audit trails
- ✅ **Versioned** to prevent concurrent update conflicts
- ✅ **Logged** with who changed what and when
- ✅ **Applied immediately** to new transactions

### Supported Fee Types

| Currency | Components |
|----------|------------|
| **NGN (Naira)** | Fee % (0-50%) + Fixed Amount (₦) |
| **USDC (Crypto)** | Fee % (0-50%) + Fixed Amount ($) |

**Default Fees:**
- Naira: 2.5% + ₦50
- USDC: 1.5% + $0.50

---

## Security Setup

### 1. HTTPS/TLS Configuration

**Requirement:** All admin endpoints MUST use HTTPS in production to prevent API key interception.

**Steps:**

1. **Obtain SSL Certificate**
   ```bash
   # Option A: Let's Encrypt (Recommended)
   certbot certonly --standalone -d your-domain.com
   
   # Option B: Self-signed (Dev/Staging only)
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365
   ```

2. **Update server.ts to use HTTPS**
   ```typescript
   import https from "https";
   import fs from "fs";
   
   const certPath = process.env.HTTPS_CERT_PATH || "./certs/cert.pem";
   const keyPath = process.env.HTTPS_KEY_PATH || "./certs/key.pem";
   
   if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
     https.createServer(
       {
         cert: fs.readFileSync(certPath),
         key: fs.readFileSync(keyPath),
       },
       app
     ).listen(process.env.PORT || 4000);
   } else {
     console.warn("HTTPS certificates not found; running on HTTP (DEV ONLY)");
     app.listen(process.env.PORT || 4000);
   }
   ```

3. **Update .env**
   ```bash
   HTTPS_CERT_PATH=/etc/letsencrypt/live/your-domain.com/fullchain.pem
   HTTPS_KEY_PATH=/etc/letsencrypt/live/your-domain.com/privkey.pem
   ```

4. **Verify HTTPS works**
   ```bash
   curl -k https://your-domain.com/health
   ```

---

### 2. Admin API Key Management

**Requirement:** Protect the `ADMIN_API_KEY` with the same level of security as database passwords.

**Setup:**

1. **Generate Strong API Key**
   ```bash
   # Use a cryptographically secure method
   openssl rand -base64 32
   # Output: WC2oJX4kR9pLmQvT5xZ3nY8vB7cF0hQ2KsR1aP5dE6g=
   ```

2. **Store in Secure Secrets Manager**
   - ✅ AWS Secrets Manager
   - ✅ HashiCorp Vault
   - ✅ Azure Key Vault
   - ✅ GitHub Secrets (for CI/CD)
   - ❌ Never hardcode in code
   - ❌ Never commit to version control

3. **Environment Variable Setup**
   ```bash
   # .env (production)
   ADMIN_API_KEY=WC2oJX4kR9pLmQvT5xZ3nY8vB7cF0hQ2KsR1aP5dE6g=
   ```

4. **Verify Key is Set**
   ```bash
   # Check key exists (don't echo the value!)
   if [ -z "$ADMIN_API_KEY" ]; then
     echo "ERROR: ADMIN_API_KEY not set"
     exit 1
   fi
   ```

---

### 3. Secret Rotation Procedure

**Frequency:** Rotate every 90 days or immediately if compromised.

**Steps:**

1. **Generate New Key**
   ```bash
   NEW_KEY=$(openssl rand -base64 32)
   echo "New Admin Key: $NEW_KEY"
   ```

2. **Update Secrets Manager**
   ```bash
   # AWS Secrets Manager example
   aws secretsmanager update-secret \
     --secret-id sivan-escrow-admin-key \
     --secret-string $NEW_KEY
   ```

3. **Redeploy Services**
   ```bash
   # Services automatically pick up new ADMIN_API_KEY on restart
   docker restart sivan-escrow-agent
   docker restart sivan-escrow-admin-frontend
   ```

4. **Notify Admin Users**
   ```
   Email to admins:
   Subject: Admin API Key Updated
   
   The admin API key was rotated on [DATE].
   Your API requests may fail for ~5 minutes during the restart.
   No action needed - service will resume automatically.
   ```

5. **Monitor for Errors**
   ```bash
   # Watch logs for 401 Unauthorized errors
   docker logs -f sivan-escrow-agent | grep "401\|Unauthorized"
   ```

**Emergency: Immediate Key Rotation (if leaked)**
```bash
# If key is compromised, rotate immediately without waiting
NEW_KEY=$(openssl rand -base64 32)
aws secretsmanager update-secret --secret-id sivan-escrow-admin-key --secret-string $NEW_KEY
# Restart services immediately
docker restart sivan-escrow-agent
# Alert all admins
```

---

## API Endpoints

### Authentication

All admin endpoints require the `x-admin-key` header:

```bash
curl -H "x-admin-key: YOUR-ADMIN-API-KEY" \
     https://your-domain.com/admin/settings
```

### GET /admin/settings

**Fetch current fee configuration**

```bash
curl -H "x-admin-key: $ADMIN_API_KEY" \
     https://your-domain.com/admin/settings
```

**Response:**
```json
{
  "nairaFeePercent": 2.5,
  "nairaFeeFixed": 50,
  "usdcFeePercent": 1.5,
  "usdcFeeFixed": 0.5,
  "version": 5,
  "updatedAt": "2026-05-24T14:30:00Z",
  "updatedBy": "admin@sivan.com"
}
```

---

### POST /admin/settings

**Update fee configuration**

```bash
curl -X POST -H "x-admin-key: $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "nairaFeePercent": 3.5,
       "nairaFeeFixed": 100,
       "usdcFeePercent": 2.0,
       "usdcFeeFixed": 0.75,
       "expectedVersion": 5
     }' \
     https://your-domain.com/admin/settings
```

**Response on success:**
```json
{
  "nairaFeePercent": 3.5,
  "nairaFeeFixed": 100,
  "usdcFeePercent": 2.0,
  "usdcFeeFixed": 0.75,
  "version": 6,
  "updatedAt": "2026-05-24T15:00:00Z",
  "updatedBy": "admin-api-call"
}
```

**Response on version conflict (409):**
```json
{
  "error": "Version mismatch: settings have been updated by another user. Current version: 6"
}
```

**Validation Rules:**
- Fee percent must be 0-50%
- Fixed fees must be non-negative
- Version must match current (prevents lost updates)

---

### GET /admin/audit-history

**View audit trail of all fee changes**

```bash
curl -H "x-admin-key: $ADMIN_API_KEY" \
     "https://your-domain.com/admin/audit-history?limit=50"
```

**Response:**
```json
[
  {
    "id": "audit-001",
    "settingName": "nairaFeePercent",
    "oldValue": "2.5",
    "newValue": "3.5",
    "changedBy": "admin@sivan.com",
    "changedAt": "2026-05-24T15:00:00Z"
  },
  {
    "id": "audit-002",
    "settingName": "nairaFeeFixed",
    "oldValue": "50",
    "newValue": "100",
    "changedBy": "admin@sivan.com",
    "changedAt": "2026-05-24T15:00:00Z"
  }
]
```

---

## Admin Operations

### Typical Workflow: Adjusting Fees

**Scenario:** You want to increase Naira fees from 2.5% to 3.5%

**Step 1: Check Current Settings**
```bash
ADMIN_KEY="your-admin-api-key"
CURRENT=$(curl -H "x-admin-key: $ADMIN_KEY" \
          https://your-domain.com/admin/settings)
echo $CURRENT | jq .
# Output: version: 5
```

**Step 2: Review in Admin Dashboard**
- Navigate to fee management tab
- View current fees and preview calculator
- See what users will pay with new fees

Fee policy:

```text
Escrow amount: amount agreed for the seller
Platform fee: calculated on top of the escrow amount
Buyer total: escrow amount + platform fee
Seller payout: escrow amount
```

Example: if the user creates a ₦10,000 escrow and the platform fee is ₦300, the buyer pays ₦10,300 and the seller payout remains ₦10,000.

**Step 3: Make Change in Admin UI**
- Update Naira Fee %: 3.5%
- Review changes in preview calculator
- Click "Review & Save Changes"
- Confirm in modal dialog

**Step 4: Monitor Audit Trail**
```bash
curl -H "x-admin-key: $ADMIN_KEY" \
     "https://your-domain.com/admin/audit-history?limit=5" | jq .
```

**Step 5: Verify Impact**
- Monitor transaction logs to see new fees applied
- Check revenue reports in the next day

---

### Handling Version Conflicts

**Scenario:** Two admins try to change fees simultaneously.

**What happens:**
- Admin A changes fees first ✅ (version 5 → 6)
- Admin B tries to change with old version 5 ❌ (409 Conflict error)

**Resolution:**
1. Admin B refreshes fee settings (fetches version 6)
2. Admin B re-makes their changes with version 6
3. Submit again ✅

**In code:**
```typescript
try {
  const response = await fetch("/admin/settings", {
    method: "POST",
    body: JSON.stringify({
      ...newFees,
      expectedVersion: currentVersion
    })
  });
  
  if (response.status === 409) {
    // Handle conflict
    const current = await fetch("/admin/settings");
    const settings = await current.json();
    // Retry with new version
  }
} catch (err) {
  // Handle error
}
```

---

## Monitoring & Alerts

### 1. Rate Limiting (Prevent Brute Force)

**Setup express-rate-limit:**

```typescript
import rateLimit from "express-rate-limit";

const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: "Too many admin requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/admin/", adminLimiter);
```

**Test rate limit:**
```bash
for i in {1..15}; do
  curl -H "x-admin-key: $ADMIN_KEY" \
       https://your-domain.com/admin/settings
  echo "Request $i"
done
# Requests 11-15 should return 429 (Too Many Requests)
```

---

### 2. Audit Log Monitoring

**Monitor for suspicious activity:**

```bash
# Alert if fees changed more than 3 times in 1 hour
SELECT COUNT(*) as changes
FROM audit_history
WHERE changed_at > NOW() - INTERVAL '1 hour'
GROUP BY changed_by;

# If COUNT > 3: Send alert
```

**Sentry Integration (for error tracking):**

```typescript
import * as Sentry from "@sentry/node";

app.post("/admin/settings", (req, res) => {
  const updated = settingsStore.updateSettings(req.body);
  
  // Log to Sentry
  Sentry.captureMessage(`Fee updated: ${JSON.stringify(updated)}`, "info");
  
  res.json(updated);
});
```

---

### 3. Dashboard Alerts

**Set up alerts in your monitoring system:**

| Alert | Trigger | Action |
|-------|---------|--------|
| Fee Changed | Any POST to /admin/settings | Notify Slack #admin-alerts |
| Invalid Key | 401 returned | Log attempt, check if key leaked |
| Version Conflicts | Multiple 409 errors | Warn admins, check concurrent access |
| Rate Limited | 429 returned | Investigate potential attack |

**Example Slack Alert:**
```
🔔 Fee Change Detected
User: admin@sivan.com
Time: 2026-05-24 15:00:00 UTC
Change: Naira 2.5% → 3.5%
Impact: All new transactions apply 3.5% fee
```

---

## Emergency Procedures

### 1. Rollback Procedure (Undo Fee Changes)

**Scenario:** You set fees incorrectly and need to revert.

**Step 1: Check audit history to find previous values**
```bash
curl -H "x-admin-key: $ADMIN_KEY" \
     "https://your-domain.com/admin/audit-history?limit=20" | jq .
# Find the correct previous values
```

**Step 2: Get current version**
```bash
curl -H "x-admin-key: $ADMIN_KEY" \
     https://your-domain.com/admin/settings | jq '.version'
# Returns: 6
```

**Step 3: Revert to previous fees**
```bash
curl -X POST -H "x-admin-key: $ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "nairaFeePercent": 2.5,
       "nairaFeeFixed": 50,
       "usdcFeePercent": 1.5,
       "usdcFeeFixed": 0.5,
       "expectedVersion": 6
     }' \
     https://your-domain.com/admin/settings
```

**Step 4: Verify rollback in audit history**
```bash
curl -H "x-admin-key: $ADMIN_KEY" \
     "https://your-domain.com/admin/audit-history?limit=3" | jq .
```

---

### 2. Compromised API Key Response

**If you suspect the admin API key was leaked:**

1. **Immediately rotate the key** (see Secret Rotation above)
2. **Audit recent changes**
   ```bash
   curl -H "x-admin-key: $OLD_KEY" \
        "https://your-domain.com/admin/audit-history?limit=100"
   # Look for unexpected changes
   ```
3. **Rollback unauthorized changes**
   - Use procedure above to revert to known-good state
4. **Review access logs**
   - Check who accessed /admin endpoints and from where
5. **Document incident**
   - Record timestamp, actions taken, impact
   - Prepare incident report for stakeholders

---

### 3. Service is Down / Can't Update Fees

**Troubleshooting:**

```bash
# 1. Check if service is running
curl https://your-domain.com/health

# 2. Check logs
docker logs sivan-escrow-agent | grep -i error

# 3. Verify ADMIN_API_KEY is set
echo $ADMIN_API_KEY

# 4. Verify database is accessible
sqlite3 ./data/sivan-escrow-agent.db "SELECT COUNT(*) FROM platform_settings;"

# 5. Check if firewall is blocking requests
curl -v https://your-domain.com/admin/settings

# 6. Restart service
docker restart sivan-escrow-agent

# 7. Monitor startup logs
docker logs -f sivan-escrow-agent
```

---

## Troubleshooting

### Q: I get "401 Unauthorized" error

**A:** Your admin API key is wrong or missing.

```bash
# Verify the key is correct
echo $ADMIN_API_KEY

# Test with correct key
curl -H "x-admin-key: your-actual-key" \
     https://your-domain.com/admin/settings
```

---

### Q: "Version mismatch" error when updating fees

**A:** Another admin changed fees while you were working. Get the current version and retry.

```bash
# Get latest version
SETTINGS=$(curl -H "x-admin-key: $ADMIN_KEY" \
                https://your-domain.com/admin/settings)
VERSION=$(echo $SETTINGS | jq '.version')

# Retry with current version
curl -X POST -H "x-admin-key: $ADMIN_KEY" \
     -d "{..., \"expectedVersion\": $VERSION}"
```

---

### Q: Changes aren't being applied to transactions

**A:** Check that:
1. The fees were saved successfully (check audit history)
2. The server restarted (fees are cached in memory)
3. New transactions are being created (old ones may be processed with old fees)

```bash
# Verify fees are saved
curl -H "x-admin-key: $ADMIN_KEY" \
     https://your-domain.com/admin/settings | jq '.nairaFeePercent'

# Check audit trail
curl -H "x-admin-key: $ADMIN_KEY" \
     https://your-domain.com/admin/audit-history | jq '.[0]'
```

---

### Q: I made a mistake setting fees - how do I fix it?

**A:** Use the rollback procedure (see Emergency Procedures above).

---

## Summary Checklist

### Before Going to Production
- [ ] HTTPS/TLS certificates installed
- [ ] ADMIN_API_KEY generated and stored in secrets manager
- [ ] Rate limiting configured
- [ ] Audit logging enabled
- [ ] Monitoring alerts set up
- [ ] Team trained on fee management
- [ ] Emergency contact list prepared

### Regular Maintenance
- [ ] Rotate ADMIN_API_KEY every 90 days
- [ ] Review audit logs weekly
- [ ] Test rollback procedure monthly
- [ ] Monitor rate limit alerts
- [ ] Backup database containing fee history

### During Incident
- [ ] Follow rollback procedure if fees wrong
- [ ] Rotate key if compromised
- [ ] Document changes in incident report
- [ ] Notify relevant teams

---

## Support & Questions

For issues or questions about fee management:
1. Check audit history to understand past changes
2. Consult this guide for procedures
3. Contact your DevOps team for infrastructure issues
4. File a bug report if you find a bug

**Critical:** Always have at least one backup admin available during fee changes.
