import { ROLE_ARG_TYPES, variant } from '../stories/variants';
import Chrome from '../layouts/Chrome.astro';
import NotFoundScreen from './NotFoundScreen.astro';

export default {
  title: 'Screens/404',
  component: NotFoundScreen,
  decorators: [
    (_story: unknown, context: { args: Record<string, unknown> }) => ({
      component: Chrome,
      props: { role: context.args['role'] },
    }),
  ],
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
