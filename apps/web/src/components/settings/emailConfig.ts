export type EmailConfigState = {
  fromName: string;
  fromEmail: string;
  signature: string;
};

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
  name: string,
  company?: string,
  email?: string,
) =>
  savedSignature !== undefined
    ? savedSignature
    : buildSignature(name, company, email);

export const hasSameEmailConfig = (
  left: EmailConfigState | null,
  right: EmailConfigState,
) =>
  !!left &&
  left.fromName === right.fromName &&
  left.fromEmail === right.fromEmail &&
  left.signature === right.signature;
