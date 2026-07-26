# Canonical WhatsApp Integration

**Canonical Repository:** `whatsapp-bot/` (top-level project root)  
**Status:** Standalone Express + Twilio / Meta WhatsApp service

---

## Architectural Role

The Sivan ecosystem utilizes a single, canonical WhatsApp Bot implementation located at the top-level `/whatsapp-bot` repository.

### Key Points:
1. **Single Canonical Bot:** All WhatsApp webhooks (`/webhooks/twilio` and `/webhooks/meta`), session states (`ConversationSessionStore`), and deal cards (`dealCards.ts`) are implemented and maintained in `/whatsapp-bot`.
2. **Escrow Agent Integration:** `sivan-escrow-agent` communicates with the canonical `whatsapp-bot` service via HTTP POST requests to `${NOTIFICATION_URL}/api/notify`.
3. **Legacy Directory Removal:** The legacy directory `sivan-escrow-agent/whatsapp-bot/` (which previously only contained a draft `.env.example`) has been removed to prevent developer confusion.
