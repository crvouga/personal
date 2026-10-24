export const capabilities = [
  {
    provider: 'Bitwarden',
    discovery: 'bw personal login items; shared ownership opt-in',
    mutation: 'create + password edit + readback',
    verification: 'vault readback; credential validity remains independent',
  },
  {
    provider: 'GitHub',
    discovery: 'vault/export identity',
    mutation: 'deterministic Password and authentication form',
    verification: 'fresh username/password authentication; MFA requires user',
  },
  {
    provider: 'Gmail',
    discovery: 'gmail.readonly metadata + server search + history',
    mutation: 'none',
    verification: 'OAuth connection and source coverage',
  },
  {
    provider: 'Microsoft',
    discovery: 'delegated Mail.ReadBasic + full nextLink pagination',
    mutation: 'none',
    verification:
      'OAuth connection and date-window coverage; no folder delta claim',
  },
  {
    provider: 'IMAP',
    discovery: 'TLS INBOX header scan with UIDVALIDITY + UID cursor',
    mutation: 'none',
    verification:
      'mailbox access; app password/OAuth capability depends on provider',
  },
  {
    provider: 'Chrome / Firefox / Apple',
    discovery: 'validated CSV password exports',
    mutation: 'selected import only',
    verification:
      'Bitwarden readback; passkeys and attachments are separate transfers',
  },
  {
    provider: 'MBOX / EML',
    discovery: 'streamed bounded MIME headers',
    mutation: 'none',
    verification: 'unconfirmed clues only',
  },
  {
    provider: 'Google / Apple linked sign-in',
    discovery: 'guided official read-only account review',
    mutation: 'separate selected actions only',
    verification: 'user-attested mapping; no private API scraping',
  },
] as const;
