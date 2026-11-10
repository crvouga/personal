export type SectionId =
  'work' | 'projects' | 'agentic' | 'proof' | 'about' | 'contact';

export type Section = {
  readonly id: SectionId;
  readonly number: string;
  readonly title: string;
  readonly navLabel: string;
  /** Primary destinations rendered in the site header. */
  readonly nav: boolean;
};

/**
 * Declaration order is the default page order and the header order (an
 * archetype's voice may reorder it; see `sectionsFor`); `number` is derived from it so the two can never drift apart.
 *
 * Education is deliberately not a section: a diploma image in its own numbered
 * slot reads as credential anxiety at this much experience, so the degree is
 * one line inside About.
 */
export const SECTION_DEFS: readonly Omit<Section, 'number'>[] = [
  { id: 'work', title: 'Work', navLabel: 'Work', nav: true },
  {
    id: 'projects',
    title: 'Selected projects',
    navLabel: 'Projects',
    nav: true,
  },
  { id: 'agentic', title: 'How I build', navLabel: 'How I build', nav: true },
  {
    id: 'proof',
    title: 'Verified, not just shipped',
    navLabel: 'Proof',
    nav: false,
  },
  { id: 'about', title: 'About', navLabel: 'About', nav: false },
  { id: 'contact', title: 'Contact', navLabel: 'Contact', nav: true },
];

/**
 * The sections in a presentation's order, numbered by position, with any of
 * its own headings. Every section must appear exactly once.
 */
export const sectionsFor = (
  order: readonly SectionId[],
  titles: Partial<Record<SectionId, string>> = {}
): readonly Section[] => {
  if (
    order.length !== SECTION_DEFS.length ||
    new Set(order).size !== order.length
  ) {
    throw new Error(
      `A section order must list every section once: ${order.join(', ')}`
    );
  }
  return order.map((id, index) => {
    const def = SECTION_DEFS.find((section) => section.id === id);
    if (def === undefined) throw new Error(`Unknown section id: ${id}`);
    return {
      ...def,
      title: titles[id] ?? def.title,
      number: String(index + 1).padStart(2, '0'),
    };
  });
};

export const SECTIONS: readonly Section[] = sectionsFor(
  SECTION_DEFS.map((section) => section.id)
);

export const getSection = (id: SectionId): Section => {
  const found = SECTIONS.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Unknown section id: ${id}`);
  }
  return found;
};
