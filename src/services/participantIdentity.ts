/**
 * Resolves who an actor is and which side of an escrow they sit on.
 *
 * Extracted verbatim from escrowService.ts as step 4 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 */
import { EscrowRecord } from "./escrowStore";
import { escrowStore } from "../context";

/**
 * Thrown when a caller supplies both an actorWhatsapp and an actorUserId that
 * belong to different accounts. Ambiguous authorization input is refused rather
 * than resolved by precedence: silently preferring one would let a caller pass a
 * handle they own alongside an id they do not.
 */
export class ConflictingActorError extends Error {
  constructor() {
    super("actorWhatsapp and actorUserId identify different accounts");
    this.name = "ConflictingActorError";
  }
}

export function whatsappIdentityMatches(left?: string | null, right?: string | null) {
  if (!left || !right) return false;
  const cleanLeft = left.trim().toLowerCase().replace(/^@/, "").replace(/^whatsapp:/i, "");
  const cleanRight = right.trim().toLowerCase().replace(/^@/, "").replace(/^whatsapp:/i, "");
  if (cleanLeft && cleanRight && cleanLeft === cleanRight) return true;
  const leftDigits = left.replace(/\D/g, "");
  const rightDigits = right.replace(/\D/g, "");
  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

/**
 * Which account is acting, given either handle.
 *
 * actorWhatsapp cannot express a Telegram-only actor: the whatsappAddress regex
 * in validation.ts accepts digits only, and that strictness is deliberate - it
 * is what stops a `web:<userId>` placeholder from being replayed as a
 * credential. So a second field is threaded through instead of widening the
 * first, and both are resolved here to the userId the escrow actually keys on.
 *
 * Returns null when nothing was supplied or the handle matches no account, which
 * callers already treat as "not a participant".
 */
export async function resolveActorUserId(
  actorWhatsapp?: string | null,
  actorUserId?: string | null
): Promise<string | null> {
  if (actorUserId) {
    const byId = await escrowStore.getUserById(actorUserId);
    if (!byId) return null;
    if (actorWhatsapp && !whatsappIdentityMatches(byId.whatsappNumber, actorWhatsapp)) {
      throw new ConflictingActorError();
    }
    return byId.userId;
  }

  if (!actorWhatsapp) return null;
  const byPhone = await escrowStore.findUserByWhatsapp(actorWhatsapp);
  return byPhone ? byPhone.userId : null;

}

/**
 * Which side of this escrow the actor is on, or null if neither.
 *
 * Compares userId - the key the escrow is actually built on - rather than
 * phone digits. The phone comparison it replaces returned null for any
 * participant without a phone, locking a Telegram-linked user out of their own
 * escrow: linking succeeded at the payment layer and authorization still
 * refused them here.
 *
 * escrow.sellerWhatsapp is still matched on its own because an invited seller
 * who never registered has no user row yet - a bare number is all we have.
 */
export async function roleForEscrowParticipant(
  escrow: EscrowRecord,
  actorWhatsapp?: string | null,
  actorUserId?: string | null
): Promise<"buyer" | "seller" | null> {
  const resolvedUserId = await resolveActorUserId(actorWhatsapp, actorUserId);

  if (resolvedUserId) {
    if (escrow.buyerUserId === resolvedUserId) return "buyer";
    if (escrow.sellerUserId === resolvedUserId) return "seller";
  }

  // Unregistered / invited participant: no user row yet, match the raw number.
  if (actorWhatsapp) {
    if (escrow.buyerWhatsapp && whatsappIdentityMatches(escrow.buyerWhatsapp, actorWhatsapp)) return "buyer";
    if (escrow.sellerWhatsapp && whatsappIdentityMatches(escrow.sellerWhatsapp, actorWhatsapp)) return "seller";
  }

  return null;
}
