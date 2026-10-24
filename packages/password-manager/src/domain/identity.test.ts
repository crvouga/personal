import { expect, test } from 'bun:test';
import {
  accountFromEvidence,
  matchEvidence,
  originOf,
  stableId,
  suggestedDomain,
} from './identity.ts';
import { mailEvidence, parseHeaders } from '../adapters/mail-evidence.ts';
import { parseConfig } from './config.ts';
test('mail clues, vendors, forwards and guest receipts never confirm credential origins', () => {
  for (const subject of [
    'Welcome!',
    'Fwd: verify account',
    'Your receipt',
    'Password reset',
  ]) {
    const evidence = mailEvidence(
      'mail',
      {
        id: subject,
        from: ['notify@vendor.test'],
        recipients: ['a@example.test', 'b@example.test'],
        subject,
        date: '',
      },
      '2026-01-01'
    );
    expect(evidence?.confirmed).toBe(false);
    expect(accountFromEvidence(evidence!)).toBeNull();
    expect(evidence?.origin).toBeNull();
    expect(JSON.stringify(evidence)).not.toContain(subject);
  }
});
test('exact usernames and private-suffix tenants remain distinct', () => {
  expect(stableId('https://service.test', 'Alice')).not.toBe(
    stableId('https://service.test', 'alice')
  );
  expect(stableId('https://a.service.test', 'alice')).not.toBe(
    stableId('https://b.service.test', 'alice')
  );
  expect(suggestedDomain('a.github.io')).toBe('a.github.io');
  expect(
    originOf('https://user:password@example.test/reset?token=x')
  ).toBeNull();
  expect(originOf('http://example.test')).toBeNull();
  expect(originOf('https://a.service.test/settings')).toBe(
    'https://a.service.test'
  );
});
test('MIME encoded headers parsed without persisting subject canaries', async () => {
  const mail = await parseHeaders(
    'From: Alert <security@example.test>\r\nTo: user@example.test\r\nSubject: =?UTF-8?B?UGFzc3dvcmQgcmVzZXQgU0VDUkVU?=\r\n',
    '1'
  );
  expect(mail.subject).toBe('Password reset SECRET');
  const evidence = mailEvidence('mail', mail, '2026-01-01');
  expect(evidence?.category).toBe('reset');
  expect(JSON.stringify(evidence)).not.toContain('SECRET');
  expect(matchEvidence(evidence!, []).status).toBe('unmatched');
});
test('configuration refuses unknown policy keys and duplicate sources', () => {
  expect(() => parseConfig({ version: 1, unrestricted: true })).toThrow();
  expect(() =>
    parseConfig({
      version: 1,
      sources: [
        { id: 'a', kind: 'eml' },
        { id: 'a', kind: 'eml' },
      ],
    })
  ).toThrow();
  expect(parseConfig({ version: 1 }).execution.autoApply).toBe(false);
});
