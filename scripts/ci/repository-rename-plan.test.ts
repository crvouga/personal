import { expect, test } from 'bun:test';
import { checkRepositoryRename } from './repository-rename-plan';
const repository = {
  address: 'github_repository.workspace',
  type: 'github_repository',
  change: {
    actions: ['update'],
    before: { name: 'workspace', repo_id: 123 },
    after: { name: 'personal', repo_id: 123 },
  },
};

test('repository adoption permits in-place updates, explicit forgets and imported no-ops', () => {
  expect(
    checkRepositoryRename({
      resource_changes: [
        repository,
        {
          address: 'github_issue_labels.workspace',
          type: 'github_issue_labels',
          change: { actions: ['forget'] },
        },
        {
          address: 'github_issue_labels.personal',
          type: 'github_issue_labels',
          change: { actions: ['no-op'], after: { repository: 'personal' } },
        },
      ],
    })
  ).toEqual({ migration: true, checked: 3 });
});

test('repository adoption never deletes labels, replaces secrets or creates repository objects', () => {
  for (const actions of [['delete'], ['delete', 'create'], ['create']]) {
    expect(() =>
      checkRepositoryRename({
        resource_changes: [
          repository,
          {
            address: 'github_issue_labels.workspace',
            type: 'github_issue_labels',
            change: { actions },
          },
        ],
      })
    ).toThrow('refuses');
  }
});

test('repository adoption refuses identity changes and unrelated cloud mutations', () => {
  expect(() =>
    checkRepositoryRename({
      resource_changes: [
        {
          ...repository,
          change: {
            ...repository.change,
            after: { name: 'personal', repo_id: 456 },
          },
        },
      ],
    })
  ).toThrow('identity changed');
  expect(() =>
    checkRepositoryRename({
      resource_changes: [
        repository,
        {
          address: 'railway_project.workspace',
          type: 'railway_project',
          change: { actions: ['update'] },
        },
      ],
    })
  ).toThrow('refuses');
});

test('once adopted, the one-time gate does not constrain ordinary plans', () => {
  expect(
    checkRepositoryRename({
      resource_changes: [
        {
          address: 'github_repository.workspace',
          type: 'github_repository',
          change: {
            actions: ['no-op'],
            before: { name: 'personal' },
            after: { name: 'personal' },
          },
        },
      ],
    })
  ).toEqual({ migration: false, checked: 0 });
});

test('an update cannot delete labels or toggle security while importing the renamed repository', () => {
  expect(() =>
    checkRepositoryRename({
      resource_changes: [
        repository,
        {
          address: 'github_issue_labels.personal',
          type: 'github_issue_labels',
          change: {
            actions: ['update'],
            before: { repository: 'personal' },
            after: { repository: 'personal' },
          },
        },
      ],
    })
  ).toThrow('label/security changes');
});
