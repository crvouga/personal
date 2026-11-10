import { ARCHETYPE_ARG_TYPES, VARIANTS } from '../stories/variants';
import { projectById } from '../stories/fixtures';
import ProjectCard from './ProjectCard.astro';

export default {
  title: 'Components/Project card/Featured (homepage, case study)',
  component: ProjectCard,
  args: {
    project: projectById('mockingbird'),
    featured: true,
    galleryIndex: 0,
  },
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
