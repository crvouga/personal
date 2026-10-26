/** The address itself is rendered from `CONTENT.EMAIL_ADDRESS`, never retyped. */
export const CONTACT_COPY = {
  headline: 'Get in touch.',
  sub: 'Email is the fastest way to reach me.',
  /** Prefilled subject, so a message from the site is easy to find. */
  mailSubject: 'Hello from chrisvouga.dev',
  /**
   * Team, stage and domain wanted next. Unset until Chris supplies it
   * (CONTENT_QUESTIONS.md); the line is omitted rather than guessed.
   */
  lookingFor: undefined as string | undefined,
  ctaPrimary: {
    label: 'Email',
  },
};
