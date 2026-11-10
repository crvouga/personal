import { ARCHETYPE_ARG_TYPES, VARIANTS } from '../stories/variants';
import StickyCta from './StickyCta.astro';

export default {
  title: 'Sections/Sticky CTA (phone)',
  component: StickyCta,
  // Shown below 900px only; the screenshot script renders `phone` stories at phone width.
  tags: ['phone'],
  argTypes: ARCHETYPE_ARG_TYPES,
};

export const SeniorDark = VARIANTS.SeniorDark;
export const SeniorLight = VARIANTS.SeniorLight;
export const StaffDark = VARIANTS.StaffDark;
export const StaffLight = VARIANTS.StaffLight;
export const StartupDark = VARIANTS.StartupDark;
export const StartupLight = VARIANTS.StartupLight;
export const Corporate = VARIANTS.Corporate;
export const Contractor = VARIANTS.Contractor;
