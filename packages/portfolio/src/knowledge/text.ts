/**
 * The knowledge base's only markup: `[label](url)` and `**strong**`.
 *
 * Facts are stored once, free of any presentation's syntax. Each presentation
 * renders them its own way: the site as HTML links, the résumé and the
 * machine-readable feeds as plain text.
 */
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const STRONG = /\*\*([^*]+)\*\*/g;

/** A fact with its links and emphasis removed. */
export const toPlain = (text: string): string =>
  text.replace(LINK, '$1').replace(STRONG, '$1');

/** A fact as HTML; `link` decides what an anchor looks like. */
export const toHtml = (
  text: string,
  link: (href: string, label: string) => string
): string =>
  text
    .replace(LINK, (_, label: string, href: string) => link(href, label))
    .replace(STRONG, '<strong>$1</strong>');
