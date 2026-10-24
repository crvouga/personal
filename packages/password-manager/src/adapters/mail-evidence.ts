import { simpleParser } from 'mailparser';
import type { Evidence } from '../domain/model.ts';
import { stableId } from '../domain/identity.ts';
export interface MailMetadata {
  id: string;
  from: string[];
  recipients: string[];
  subject: string;
  date: string;
}
export async function parseHeaders(
  header: string,
  fallbackId: string
): Promise<MailMetadata> {
  const parsed = await simpleParser(header + '\r\n\r\n', {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
  const recipients = [parsed.to, parsed.cc]
    .flat()
    .flatMap((a) => a?.value.map((v) => v.address ?? '') ?? []);
  return {
    id: parsed.messageId ?? fallbackId,
    from: parsed.from?.value.map((a) => a.address ?? '') ?? [],
    recipients,
    subject: parsed.subject ?? '',
    date: parsed.date?.toISOString() ?? '',
  };
}
export function mailEvidence(
  sourceId: string,
  mail: MailMetadata,
  now: string
): Evidence | null {
  const category = classifySubject(mail.subject);
  if (!category) return null;
  const domain =
    mail.from.length === 1
      ? (mail.from[0]?.split('@')[1]?.toLowerCase() ?? null)
      : null;
  return {
    id: stableId(sourceId, mail.id),
    sourceId,
    sourceRef: stableId(mail.id),
    observedAt: now,
    category,
    domain,
    origin: null,
    username: null,
    confirmed: false,
    reasons: [
      'mail-is-an-unverified-clue',
      'sender-is-not-a-trusted-credential-origin',
      ...(mail.recipients.length > 1 ? ['multiple-recipients'] : []),
      ...(/^(fw|fwd):/i.test(mail.subject) ? ['forwarded-message'] : []),
    ],
    vaultId: null,
    candidateRef: null,
    unsupported: [],
    auth: 'unknown',
  };
}
function classifySubject(subject: string): Evidence['category'] | null {
  if (
    /password.{0,25}(reset|recover)|(reset|recover).{0,25}password/i.test(
      subject
    )
  )
    return 'reset';
  if (/password.{0,25}(chang|updat)/i.test(subject)) return 'change';
  if (/verif(y|ication)|confirm.{0,15}(email|account)/i.test(subject))
    return 'verification';
  if (/welcome|registration|account.{0,15}creat/i.test(subject))
    return 'registration';
  if (/sign.?in|log.?in|security|new device/i.test(subject)) return 'security';
  if (/receipt|invoice|subscription|billing/i.test(subject)) return 'billing';
  return null;
}
