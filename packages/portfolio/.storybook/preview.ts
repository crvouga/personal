/**
 * Every story renders inside a ThemeProvider: the theme of the story's
 * `archetype` arg, in the colour scheme its `scheme` parameter names. That is
 * the design system's injection point; components themselves never pick a
 * theme.
 */
import '../src/styles/global.css';

import {
  isArchetypeId,
  DEFAULT_ARCHETYPE_ID,
} from '../src/archetypes/definitions';
import { THEMES } from '../src/archetypes/theme';
import ThemeProvider from '../src/design-system/ThemeProvider.astro';

type Context = {
  args: Record<string, unknown>;
  parameters: { scheme?: 'dark' | 'light'; layout?: string };
};

const themed = (_story: unknown, context: Context) => {
  const value = context.args['archetype'];
  const id =
    typeof value === 'string' && isArchetypeId(value)
      ? value
      : DEFAULT_ARCHETYPE_ID;
  return {
    component: ThemeProvider,
    props: {
      theme: THEMES[id],
      scheme: context.parameters.scheme ?? 'dark',
      fullscreen: context.parameters.layout === 'fullscreen',
    },
  };
};

export default {
  decorators: [themed],
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    options: {
      storySort: {
        order: ['Design system', 'Screens', 'Sections', 'Components'],
      },
    },
  },
};
