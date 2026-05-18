export type ComplaintStatusGroup = 'pending' | 'disposed' | 'unknown';

/**
 * Classifies a CCTNS complaint's status into one of three groups.
 *
 * Rules:
 *  1. 'disposed' → statusRaw explicitly contains "disposed"
 *  2. 'pending'  → statusRaw explicitly contains "pending"
 *  3. 'unknown'  → statusRaw is blank/null or any unrecognized value
 *                  We do NOT assume status from the presence of a disposalDate.
 *
 * isDisposedMissingDate = true when API says "disposed" but provided no valid disposalDate.
 */
export const classifyComplaintStatus = (
  statusRaw: string | null | undefined,
  disposalDate: Date | null | undefined
): { statusGroup: ComplaintStatusGroup; isDisposedMissingDate: boolean } => {
  const normalized = String(statusRaw || '').toLowerCase().trim();
  const mentionsDisposed = normalized.includes('disposed');
  const mentionsPending  = normalized.includes('pending');

  let statusGroup: ComplaintStatusGroup;

  if (mentionsDisposed) {
    // Only classify as disposed if the API explicitly says so
    statusGroup = 'disposed';
  } else if (mentionsPending) {
    statusGroup = 'pending';
  } else {
    // blank, null, or any other value from API — status not known
    statusGroup = 'unknown';
  }

  return {
    statusGroup,
    // Missing date: API declared disposed but gave no real disposal date
    isDisposedMissingDate: mentionsDisposed && !disposalDate,
  };
};
