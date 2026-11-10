import { ROLE_ARG_TYPES, variant } from '../stories/variants';
import StickyCta from './StickyCta.astro';

export default {
  title: 'Sections/Sticky CTA (phone)',
  component: StickyCta,
  // Shown below 900px only; the screenshot script renders `phone` stories at phone width.
  tags: ['phone'],
  argTypes: ROLE_ARG_TYPES,
};

// role-variants:start (bun run roles:sync)
export const AIDark = variant('AIDark');
export const AILight = variant('AILight');
export const Contractor = variant('Contractor');
export const Corporate = variant('Corporate');
export const StartupDark = variant('StartupDark');
export const StartupLight = variant('StartupLight');
export const SeniorDark = variant('SeniorDark');
export const SeniorLight = variant('SeniorLight');
export const Staff = variant('Staff');
// role-variants:end
