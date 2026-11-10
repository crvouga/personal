import { ARCHETYPE_ARG_TYPES, VARIANTS } from './variants';
import ContributionDemo from './ContributionDemo.astro';

export default {
  title: 'Components/Contribution heatmap',
  component: ContributionDemo,
  args: { kind: 'heatmap' },
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
