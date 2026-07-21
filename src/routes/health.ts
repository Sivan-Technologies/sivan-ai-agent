import { Router } from "express";
import * as Sentry from "@sentry/node";
import { config } from "../config";
import { buildDatabaseStatus } from "../services/escrowService";
import { buildOperationalVisibility } from "../services/monitoring";

const router = Router();

const healthHandler = (req: any, res: any) => {
  res.status(200).json({ status: "ok", uptime: process.uptime(), databaseMode: config.databaseMode });
};

router.get("/health", healthHandler);
router.get("/api/health", healthHandler);

router.get("/health/readiness", async (req, res) => {
  try {
    if (!config.app.databaseUrl) {
      return res.status(500).json({ status: "unready", reason: "database not configured" });
    }
    const database = await buildDatabaseStatus();
    const operations = buildOperationalVisibility();
    res.status(200).json({ status: "ready", database, operations: { status: operations.status } });
  } catch (err: any) {
    res.status(500).json({ status: "unready", error: err.message || err });
  }
});

if (process.env.SENTRY_DEBUG_ENDPOINT_ENABLED === "true") {
  router.get("/debug-sentry", (_req, _res) => {
    Sentry.logger.info("Sivan escrow Sentry debug endpoint triggered", {
      action: "debug_sentry",
      service: "sivan-escrow-agent",
    });
    Sentry.metrics.count("sivan_escrow_debug_sentry", 1);
    throw new Error("Sivan escrow Sentry debug error");
  });
}

router.get("/payment/success", (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful — Sivan</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #0a0e17;
          --panel: rgba(255, 255, 255, 0.03);
          --border: rgba(255, 255, 255, 0.08);
          --text: #f3f4f6;
          --text-muted: #9ca3af;
          --success: #10b981;
          --success-glow: rgba(16, 185, 129, 0.15);
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        body {
          background-color: var(--bg);
          color: var(--text);
          font-family: 'Outfit', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          overflow: hidden;
          padding: 20px;
        }
        .container {
          background: var(--panel);
          border: 1px solid var(--border);
          backdrop-filter: blur(16px);
          border-radius: 24px;
          padding: 40px 32px;
          max-width: 440px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          position: relative;
        }
        .container::before {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          background: linear-gradient(135deg, var(--success), transparent 60%);
          border-radius: 24px;
          z-index: -1;
          opacity: 0.5;
        }
        .icon-wrapper {
          width: 80px;
          height: 80px;
          background: var(--success-glow);
          border: 2px solid var(--success);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 24px;
          box-shadow: 0 0 20px var(--success-glow);
          animation: pulse 2s infinite alternate;
        }
        .icon-wrapper svg {
          width: 40px;
          height: 40px;
          color: var(--success);
        }
        h1 {
          font-size: 28px;
          font-weight: 800;
          margin-bottom: 12px;
          letter-spacing: -0.5px;
        }
        p {
          color: var(--text-muted);
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 32px;
        }
        .badge {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border);
          padding: 8px 16px;
          border-radius: 99px;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--text);
          margin-bottom: 24px;
        }
        .badge-dot {
          width: 8px;
          height: 8px;
          background: var(--success);
          border-radius: 50%;
        }
        .btn {
          display: block;
          width: 100%;
          background: var(--success);
          color: #05070a;
          text-decoration: none;
          padding: 16px;
          border-radius: 16px;
          font-weight: 600;
          font-size: 16px;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px var(--success-glow);
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px var(--success-glow);
          opacity: 0.95;
        }
        @keyframes pulse {
          0% { box-shadow: 0 0 10px var(--success-glow); }
          100% { box-shadow: 0 0 25px var(--success-glow); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon-wrapper">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h1>Payment Received!</h1>
        <div class="badge">
          <span class="badge-dot"></span>
          Deal Status: Funded
        </div>
        <p>Your payment has been securely verified.<br><br>You can safely close this window now and return to your WhatsApp chat to track the delivery.</p>
        <a href="https://wa.me/14155238886" class="btn">Return to WhatsApp</a>
      </div>
    </body>
    </html>
  `);
});

export default router;
