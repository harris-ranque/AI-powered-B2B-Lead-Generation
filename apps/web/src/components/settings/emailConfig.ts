export type EmailConfigState = {
  fromName: string;
  fromEmail: string;
  signature: string;
  signatureEnabled: boolean;
};

export type EmailSignatureDraft = {
  value: string;
  mode: "dirty" | "saved";
  updatedAt: number;
};

const EMAIL_SIGNATURE_DRAFT_STORAGE_PREFIX =
  "genni:settings:email-signature";

export const buildSignature = (
  name: string,
  company?: string,
  email?: string,
) => {
  const lines = ["Best regards,", name, company, email].filter((line) =>
    !!line?.trim(),
  );

  return lines.join("\n");
};

export const resolveSignature = (
  savedSignature: string | undefined,
) => savedSignature ?? "";

export const getEmailSignatureDraftStorageKey = (userId: string) =>
  `${EMAIL_SIGNATURE_DRAFT_STORAGE_PREFIX}:${userId}`;

export const readEmailSignatureDraft = (
  storage: Storage | null | undefined,
  userId?: string,
): EmailSignatureDraft | null => {
  if (!storage || !userId) return null;

  const rawDraft = storage.getItem(getEmailSignatureDraftStorageKey(userId));
  if (!rawDraft) return null;

  try {
    const parsed = JSON.parse(rawDraft) as Partial<EmailSignatureDraft>;
    if (
      typeof parsed.value !== "string" ||
      (parsed.mode !== "dirty" && parsed.mode !== "saved") ||
      typeof parsed.updatedAt !== "number"
    ) {
      storage.removeItem(getEmailSignatureDraftStorageKey(userId));
      return null;
    }

    return parsed as EmailSignatureDraft;
  } catch {
    storage.removeItem(getEmailSignatureDraftStorageKey(userId));
    return null;
  }
};

export const writeEmailSignatureDraft = (
  storage: Storage | null | undefined,
  userId: string | undefined,
  draft: EmailSignatureDraft,
) => {
  if (!storage || !userId) return;

  storage.setItem(
    getEmailSignatureDraftStorageKey(userId),
    JSON.stringify(draft),
  );
};

export const clearEmailSignatureDraft = (
  storage: Storage | null | undefined,
  userId?: string,
) => {
  if (!storage || !userId) return;
  storage.removeItem(getEmailSignatureDraftStorageKey(userId));
};

export const resolveInitialEmailSignature = ({
  savedSignature,
  draft,
  now,
  reconciliationWindowMs,
}: {
  savedSignature: string | undefined;
  draft: EmailSignatureDraft | null;
  now: number;
  reconciliationWindowMs: number;
}) => {
  const resolvedSignature = resolveSignature(savedSignature);
  const shouldUseDraft =
    !!draft &&
    (draft.mode === "dirty" ||
      (draft.mode === "saved" &&
        draft.updatedAt > now - reconciliationWindowMs &&
        draft.value !== resolvedSignature));

  return {
    signature: shouldUseDraft ? draft.value : resolvedSignature,
    clearStoredDraft:
      !!draft && draft.mode === "saved" && draft.value === resolvedSignature,
  };
};

export const hasSameEmailConfig = (
  left: EmailConfigState | null,
  right: EmailConfigState,
) =>
  !!left &&
  left.fromName === right.fromName &&
  left.fromEmail === right.fromEmail &&
  left.signature === right.signature &&
  left.signatureEnabled === right.signatureEnabled;
