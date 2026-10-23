// Payment-instruction authorisation accepts phone identities, never arbitrary
// identifiers with digits stripped out (for example tag:user12345678).
function phone(value?: string | null): string | null {
  if (!value) return null;
  const text = value.trim().replace(/^whatsapp:/i, "");
  if (!/^\+?[0-9]{8,15}$/.test(text)) return null;
  return text.replace(/^\+/, "");
}

export function isPaymentInstructionBuyer(input: {
  actorWhatsapp: string;
  actorUserId?: string;
  buyerUserId: string;
  profileWhatsapp?: string | null;
  agreementWhatsapp?: string | null;
}): boolean {
  const actor = phone(input.actorWhatsapp);
  if (!actor || (input.actorUserId && input.actorUserId !== input.buyerUserId)) return false;
  const profile = phone(input.profileWhatsapp);
  const agreement = phone(input.agreementWhatsapp);
  // A malformed or conflicting populated profile must not silently fall back
  // to an older agreement phone. Missing profiles may use the stored buyer phone.
  if (input.profileWhatsapp && !profile) return false;
  if (profile && agreement && profile !== agreement) return false;
  return actor === (profile || agreement);
}
