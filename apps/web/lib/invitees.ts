/** MAX_INVITEES in RFQBase.sol. Mirrored so a doomed transaction is never signed. */
export const MAX_INVITEES = 50;

export type ParsedInvitees = {
  /** Valid, de-duplicated, lowercased — the array sent to the contract. */
  addresses: `0x${string}`[];
  /** Tokens that are not addresses, kept verbatim so the message can quote them back. */
  invalid: string[];
  tooMany: boolean;
};

/**
 * Reads a pasted list of supplier addresses.
 *
 * People paste from spreadsheets and email, so the separator is whatever they had: newlines,
 * commas, spaces, or a mixture. Duplicates collapse because the contract stores a set — inviting
 * the same supplier twice is noise, not an error worth stopping on. Case is normalised for the
 * same reason: the same address in two casings is one supplier.
 */
export function parseInvitees(text: string): ParsedInvitees {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const valid = tokens.filter((t) => /^0x[0-9a-fA-F]{40}$/.test(t));
  const addresses = [...new Set(valid.map((a) => a.toLowerCase()))] as `0x${string}`[];
  return {
    addresses,
    invalid: tokens.filter((t) => !/^0x[0-9a-fA-F]{40}$/.test(t)),
    tooMany: addresses.length > MAX_INVITEES,
  };
}
