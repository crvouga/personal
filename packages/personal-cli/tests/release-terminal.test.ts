import { expect, test } from 'bun:test';
import {
  terminalOutput,
  terminalPublisherConfigurations,
} from '../scripts/release-terminal';
import { hasCiPublisher } from '../scripts/release-trust';

const config =
  'type: github\nrepository: crvouga/personal\nfile: ci.yml\npermissions: publish\n';

test.skipIf(process.platform === 'win32')(
  'verification subprocess has terminal descriptors and captures publisher fields',
  async () => {
    const output = await terminalOutput(
      [
        process.execPath,
        '-e',
        `if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(1); console.log(${JSON.stringify(config)})`,
      ],
      process.cwd(),
      {},
      () => {}
    );
    expect(hasCiPublisher(terminalPublisherConfigurations(output))).toBe(true);
  }
);

test('publisher fields exclude approval dialogue and preserve configurations and restrictions', () => {
  const output =
    `Authenticate your account at:\nhttps://www.npmjs.com/auth/fixture\n${config}\ntype: github\nrepository: other/project\nfile: release.yml\nenvironment: production\npermissions: stage publish\n`.replaceAll(
      '\n',
      '\r\r\n'
    );
  expect(terminalPublisherConfigurations(output)).toEqual([
    {
      type: 'github',
      repository: 'crvouga/personal',
      file: 'ci.yml',
      permissions: ['createPackage'],
    },
    {
      type: 'github',
      repository: 'other/project',
      file: 'release.yml',
      environment: 'production',
      permissions: ['stage publish'],
    },
  ]);
  expect(
    terminalPublisherConfigurations(
      'No trust configurations found for package (@crvouga/personal)'
    )
  ).toEqual([]);
  expect(() => terminalPublisherConfigurations('unexpected response')).toThrow(
    'unconfirmed'
  );
  expect(
    hasCiPublisher(
      terminalPublisherConfigurations(
        config.replace('publish', 'stage publish')
      )
    )
  ).toBe(false);
});

test.skipIf(process.platform === 'win32')(
  'failed terminal verification cannot return a successful configuration',
  async () => {
    await expect(
      terminalOutput(
        [process.execPath, '-e', 'process.exit(1)'],
        process.cwd(),
        {},
        () => {}
      )
    ).rejects.toThrow('did not complete');
  }
);
