import { Router } from "express";
import { config } from "../config";
import { escrowStore } from "../context";
import { reconcileEscrowPayment, expectedFundingAmount, notifyEscrowFundedParticipants } from "../services/escrowService";

const router = Router();

router.get("/sandbox-pay", async (req, res) => {
  if (config.databaseMode !== "test" || process.env.PAYOUT_VERIFICATION_TEST_MODE !== "true") {
    return res.status(403).send("Sandbox payment simulation is only available in test database mode.");
  }

  const reference = String(req.query.reference || "").trim();
  if (!reference) {
    return res.status(400).send("Payment reference is required");
  }

  const escrow = await escrowStore.findEscrowByPaymentReference(reference);
  if (!escrow) {
    return res.status(404).send("Escrow not found for the given payment reference");
  }

  const expectedAmount = await expectedFundingAmount(escrow);
  const formattedAmount = new Intl.NumberFormat("en-NG").format(expectedAmount);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sivan - Sandbox Payment Simulation</title>
  <style>
    :root {
      --primary: #10b981;
      --primary-hover: #059669;
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      text-align: center;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 24px;
      letter-spacing: 0.5px;
    }
    h2 {
      font-size: 20px;
      margin: 0 0 12px 0;
    }
    .amount {
      font-size: 32px;
      font-weight: 800;
      color: var(--text);
      margin: 20px 0;
    }
    .details {
      text-align: left;
      background-color: rgba(15, 23, 42, 0.4);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      border: 1px solid var(--border);
      font-size: 14px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .detail-row:last-child {
      margin-bottom: 0;
    }
    .detail-label {
      color: var(--text-muted);
    }
    .detail-value {
      font-weight: 600;
      max-width: 200px;
      word-break: break-all;
    }
    .btn {
      display: block;
      width: 100%;
      background-color: var(--primary);
      color: #ffffff;
      border: none;
      padding: 14px 20px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.1s ease;
    }
    .btn:hover {
      background-color: var(--primary-hover);
    }
    .btn:active {
      transform: scale(0.98);
    }
    .status-msg {
      margin-top: 16px;
      font-weight: 500;
      font-size: 14px;
    }
    .success {
      color: var(--primary);
    }
    .error {
      color: #ef4444;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">SIVAN</div>
    <h2>Sandbox Payment</h2>
    <p style="color: var(--text-muted); font-size: 14px; margin-top: 0;">Test environment simulation</p>
    
    <div class="amount">NGN ${formattedAmount}</div>
    
    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Deal:</span>
        <span class="detail-value">${escrow.purpose || "Service Agreement"}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Escrow ID:</span>
        <span class="detail-value">${escrow.escrowId}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Reference:</span>
        <span class="detail-value">${reference}</span>
      </div>
    </div>
    
    <button class="btn" id="payBtn" onclick="confirmPayment()">Simulate Successful Payment</button>
    <div id="status" class="status-msg"></div>
  </div>

  <script>
    async function confirmPayment() {
      const btn = document.getElementById('payBtn');
      const statusDiv = document.getElementById('status');
      
      btn.disabled = true;
      btn.textContent = 'Processing Simulation...';
      statusDiv.className = 'status-msg';
      statusDiv.textContent = '';

      try {
        const res = await fetch('/sandbox-pay/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: '${reference}' })
        });
        
        const data = await res.json();
        if (res.ok && data.success) {
          statusDiv.className = 'status-msg success';
          statusDiv.textContent = '✅ Payment simulated successfully! Check your WhatsApp.';
          btn.textContent = 'Payment Completed';
          btn.style.backgroundColor = 'var(--border)';
          btn.style.cursor = 'default';
        } else {
          throw new Error(data.error || 'Simulation failed');
        }
      } catch (err) {
        statusDiv.className = 'status-msg error';
        statusDiv.textContent = '❌ Error: ' + err.message;
        btn.disabled = false;
        btn.textContent = 'Simulate Successful Payment';
      }
    }
  </script>
</body>
</html>
  `;

  res.send(html);
});

router.post("/sandbox-pay/confirm", async (req, res) => {
  if (config.databaseMode !== "test" || process.env.PAYOUT_VERIFICATION_TEST_MODE !== "true") {
    return res.status(403).json({ error: "Forbidden: Sandbox payment simulation is disabled." });
  }

  const { reference } = req.body || {};
  if (!reference) {
    return res.status(400).json({ error: "Reference is required" });
  }

  try {
    const escrow = await escrowStore.findEscrowByPaymentReference(reference);
    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }

    const expectedAmount = await expectedFundingAmount(escrow);

    const transaction = {
      paymentReference: reference,
      transactionReference: "sandbox-tx-" + Date.now(),
      status: "success",
      amount: expectedAmount,
      currency: "NAIRA",
      provider: escrow.paymentProvider,
      raw: { sandboxSimulated: true },
    };

    const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
    if (funded.status === "IN_PROGRESS") {
      await notifyEscrowFundedParticipants(funded);
    }

    return res.status(200).json({ success: true, status: funded.status });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to reconcile simulation" });
  }
});

export default router;
