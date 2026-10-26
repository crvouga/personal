/** The address itself is rendered from `CONTENT.EMAIL_ADDRESS`, never retyped. */
export const CONTACT_COPY = {
  headline: 'Email me.',
  sub: 'The address below goes straight to my inbox. There is no contact form and no recruiter screen in between.',
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
