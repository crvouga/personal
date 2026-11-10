import { ROLE_ARG_TYPES, variant } from './variants';
import GalleryDemo from './GalleryDemo.astro';

export default {
  title: 'Components/Gallery dialog (open)',
  component: GalleryDemo,
  args: { projectId: 'mockingbird' },
  // The screenshot script opens the dialog from the card's Images button.
  tags: ['opens-gallery'],
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
