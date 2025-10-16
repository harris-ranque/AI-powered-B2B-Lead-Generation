export const UPDATED_AT_FIELD = "updatedAt";

const UPDATED_AT_ERROR_SNIPPET =
  "extra field `updatedAt` that is not in the validator";

export const supportsUpdatedAt = (doc: Record<string, unknown> | null) =>
  !!doc && typeof doc[UPDATED_AT_FIELD] === "number";

export const withUpdatedAtIfSupported = <T extends Record<string, unknown>>(
  patch: T,
  doc: Record<string, unknown> | null,
  timestamp: number,
) => {
  if (supportsUpdatedAt(doc)) {
    return { ...patch, [UPDATED_AT_FIELD]: timestamp } as T;
  }

  return patch;
};

export const isUpdatedAtSchemaError = (error: unknown) =>
  error instanceof Error && error.message.includes(UPDATED_AT_ERROR_SNIPPET);
