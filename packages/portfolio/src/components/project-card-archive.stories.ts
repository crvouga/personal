import { ROLE_ARG_TYPES, variant } from '../stories/variants';
import { archiveById } from '../stories/fixtures';
import ProjectCard from './ProjectCard.astro';

export default {
  title: 'Components/Project card/Archive (compact)',
  component: ProjectCard,
  args: { project: archiveById('connect-four'), compact: true },
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
