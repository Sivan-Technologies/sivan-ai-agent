import crypto from "crypto";
import axios from "axios";

async function main() {
  const secret = "a3f9e2b1d6c8e5fa72109485bcfd30e12a938dfc618be4d20739f826d10c534a";
  const url = (process.env.ESCROW_AGENT_URL || 'http://127.0.0.1:4000') + '/webhooks/nomba';

  // Use the latest escrow's payment reference
  const merchantTxRef = "nomba-SIV-731863-D0B1-1783508795857-16e54841";
  const orderReference = "e987e6be-5ca1-4ef3-b343-1596718e40ab";

  const payload = {
    event_type: "payment_success",
    request_id: crypto.randomUUID(),
    data: {
      transaction: {
        id: orderReference,
        transactionId: orderReference,
        merchantTxRef: merchantTxRef,
        status: "SUCCESS",
        amount: "3066.00",
        currency: "NGN",
        type: "checkout",
        meta: {
          merchantTxRef: merchantTxRef,
        },
      }
    }
  };

  const bodyStr = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const candidate = `${timestamp}.${bodyStr}`;
  const signature = crypto.createHmac("sha256", secret).update(candidate, "utf8").digest("hex");

  console.log("📤 Sending signed payment_success webhook to Render...");
  console.log(`Reference: ${merchantTxRef}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Signature: ${signature}`);

  try {
    const res = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "nomba-signature": signature,
        "nomba-timestamp": timestamp,
      }
    });
    console.log(`✅ Webhook Response Status: ${res.status}`);
    console.log("Response Body:", res.data);
  } catch (err: any) {
    console.error(`❌ Request failed: Status ${err.response?.status}`);
    console.error("Response Body:", err.response?.data);
  }
}

main();
