import { ARCHETYPE_ARG_TYPES, VARIANTS } from '../stories/variants';
import Chrome from '../layouts/Chrome.astro';
import ArchetypeDetailScreen from './ArchetypeDetailScreen.astro';

export default {
  title: 'Screens/Archetype details/corporate-large-company-senior-developer',
  component: ArchetypeDetailScreen,
  args: { subject: 'corporate-large-company-senior-developer' },
  decorators: [
    (_story: unknown, context: { args: Record<string, unknown> }) => ({
      component: Chrome,
      props: { archetype: context.args['archetype'] },
    }),
  ],
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
