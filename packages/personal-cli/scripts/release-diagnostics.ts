/** Only fixed diagnostics leave the subprocess boundary; never echo npm output. */
export function npmFailureHint(stderr: string): string {
  const hints: Record<string, string> = {
    ENEEDAUTH:
      'npm authentication was unavailable. For OIDC, check id-token: write and the trusted publisher repository, workflow filename and direct-publish permission.',
    E401: 'npm rejected authentication. Verify the selected publishing method and its authorization.',
    E403: 'npm denied publication. Check trusted-publisher permissions, package access and 2FA policy.',
    E404: 'npm could not authorize or locate the package. Check the exact trusted-publisher identity and package name.',
    EOTP: 'npm requested interactive 2FA. CI needs an authorized trusted publisher or an appropriate publishing token.',
    E422: 'npm rejected publication metadata or provenance. Check package repository metadata and workflow identity.',
    EPROVENANCE:
      'npm could not validate provenance. Check package repository metadata and workflow identity.',
    EPRIVATE:
      'npm refused a private package. Verify the distribution tarball selected for publication.',
    EUSAGE:
      'npm rejected the command or configuration. Check the publishing CLI version and arguments.',
  };
  const code = /^npm (?:error|ERR!) code ([A-Z0-9]+)\s*$/m.exec(stderr)?.[1];
  return code && Object.hasOwn(hints, code) ? ` ${code}: ${hints[code]}` : '';
}
