/**
 * Resume HTML document.
 *
 * `renderHtml` turns a `ResumeContent` into the single-page HTML document the
 * generator measures for fit and then prints to PDF. The content model lives
 * here too because it is exactly the document's input contract; the generator
 * imports it back for content assembly and the drop-strategy fit loop.
 */

// ---------------------------------------------------------------------------
// Content shape
// ---------------------------------------------------------------------------

export type Identity = {
  readonly name: string;
  readonly title: string;
  readonly location: string;
  readonly email: string;
  /** Null on the public build; see RESUME_INCLUDE_PHONE in content.ts. */
  readonly phone: string | null;
  readonly website: string;
  readonly websiteUrl: string;
  readonly githubDisplay: string;
  readonly githubUrl: string;
  readonly linkedinDisplay: string;
  readonly linkedinUrl: string;
};

export type Experience = {
  readonly company: string;
  readonly jobTitle: string;
  readonly dateRange: string;
  /** Inline HTML: only `<strong>`, `<em>` and `<code>` survive assembly. */
  readonly bullets: readonly string[];
  readonly awards: readonly string[];
  readonly url: string | null;
};

export type Project = {
  readonly title: string;
  readonly description: string | null;
  readonly url: string | null;
  /** Printed beside the title: a paper copy has no clickable link. */
  readonly urlDisplay: string | null;
  readonly topics: readonly string[];
};

export type SkillRow = {
  readonly category: string;
  readonly items: readonly string[];
};

export type Education = {
  readonly degree: string;
  readonly institution: string;
  readonly dateRange: string;
};

export type ResumeContent = {
  readonly identity: Identity;
  /** Complete sentences, joined with a space. */
  summary: string[];
  /** Every role is always shown; the fit loop only trims bullets. */
  experience: Experience[];
  /** Drop from the end (least important last). */
  projects: Project[];
  /** Drop categories from the end if needed. */
  skills: SkillRow[];
  education: Education[];
};

/** One reduction of the content, applied in order until a single page fits. */
export type DropStrategy = {
  readonly name: string;
  readonly apply: (c: ResumeContent) => ResumeContent;
};

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const ACCENT = '#0b6bcb'; // matches THEME.colors.primary500 but as a plain hex for portability
const RULE_COLOR = '#d4d8dc';
const TEXT_PRIMARY = '#0f1419';
const TEXT_SECONDARY = '#4a5159';
const TEXT_MUTED = '#6c727a';

// ---------------------------------------------------------------------------
// Document CSS
// ---------------------------------------------------------------------------

const RESUME_CSS = `  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --accent: ${ACCENT};
      --rule: ${RULE_COLOR};
      --text: ${TEXT_PRIMARY};
      --text-secondary: ${TEXT_SECONDARY};
      --text-muted: ${TEXT_MUTED};
    }

    html, body {
      background: #fff;
      color: var(--text);
      font-family: "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 9.3pt;
      line-height: 1.38;
      font-feature-settings: "kern" 1, "liga" 1, "calt" 1, "tnum" 1;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      /* A long unbroken token (a repo URL, an email) would otherwise run past
         the printable width and be clipped by the PDF page box. */
      overflow-wrap: break-word;
    }

    body {
      width: 100%;
      min-height: 100vh;
    }

    a { color: var(--text); text-decoration: none; }
    a:hover { color: var(--accent); }

    /* ---------- Header ---------- */
    header.identity {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-bottom: 8px;
      border-bottom: 1.5px solid var(--accent);
      margin-bottom: 11px;
    }
    .name {
      font-size: 22pt;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text);
      line-height: 1.05;
    }
    .role-line {
      margin-top: 3px;
      font-size: 10pt;
      font-weight: 500;
      color: var(--text-secondary);
      letter-spacing: 0.005em;
    }
    .role-line .role-sep {
      margin: 0 6px;
      color: var(--text-muted);
    }
    .contact {
      overflow-wrap: anywhere;
      text-align: right;
      font-size: 8.6pt;
      color: var(--text-secondary);
      line-height: 1.6;
      max-width: 4in;
    }
    .contact .item:not(:last-child)::after {
      content: " · ";
      color: var(--text-muted);
      margin: 0 1px;
    }

    /* ---------- Summary ---------- */
    .summary {
      font-size: 9.3pt;
      line-height: 1.42;
      color: var(--text-secondary);
      margin-bottom: 11px;
    }

    /* ---------- Sections ---------- */
    section {
      margin-bottom: 10px;
    }
    section:last-of-type { margin-bottom: 0; }

    .section-title {
      font-size: 8.2pt;
      font-weight: 700;
      letter-spacing: 0.13em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 6px;
      padding-bottom: 3px;
      border-bottom: 0.6px solid var(--rule);
    }

    /* ---------- Entry rows ---------- */
    .entry {
      margin-bottom: 6px;
    }
    .entry:last-child { margin-bottom: 0; }

    .entry-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
    }
    .entry-headline {
      flex: 1 1 auto;
      min-width: 0;
    }
    .entry-title {
      font-weight: 600;
      color: var(--text);
    }
    .entry-company {
      font-weight: 500;
      color: var(--text);
    }
    .entry-headline .dot {
      margin: 0 5px;
      color: var(--text-muted);
    }
    .entry-date {
      font-variant-numeric: tabular-nums;
      font-size: 8.8pt;
      color: var(--text-muted);
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .entry-desc {
      margin-top: 2px;
      color: var(--text-secondary);
      line-height: 1.42;
    }

    .bullets {
      margin-top: 2px;
      padding-left: 12px;
      color: var(--text-secondary);
      line-height: 1.36;
    }
    .bullets li { margin-top: 1px; }
    .bullets li::marker { color: var(--text-muted); }
    .bullets strong { color: var(--text); font-weight: 600; }
    .award {
      margin-top: 2px;
      font-size: 9pt;
      color: var(--text-secondary);
    }
    .award strong { color: var(--text); font-weight: 600; }

    /* ---------- Projects ---------- */
    .project-url {
      overflow-wrap: anywhere;
      margin-left: 6px;
      font-size: 8.5pt;
      color: var(--accent);
    }
    .tech {
      display: inline-block;
      margin-left: 6px;
      font-size: 8.5pt;
      color: var(--text-muted);
    }

    /* ---------- Skills ---------- */
    .skills-grid {
      display: flex;
      flex-direction: column;
      row-gap: 3px;
    }
    .skill-row {
      display: flex;
      align-items: baseline;
      gap: 14px;
    }
    .skill-category {
      /* Wide enough that "AI-assisted engineering" stays one extracted line. */
      flex: 0 0 1.55in;
      white-space: nowrap;
      font-weight: 600;
      color: var(--text);
      font-size: 8.8pt;
      letter-spacing: 0.01em;
    }
    .skill-items {
      flex: 1 1 auto;
      color: var(--text-secondary);
      font-size: 9pt;
    }

    @media print {
      body { width: 100%; }
    }
  </style>`;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const linkOrText = (
  text: string,
  url: string | null,
  className?: string
): string => {
  const cls = className !== undefined ? ` class="${className}"` : '';
  return url
    ? `<a${cls} href="${escapeHtml(url)}">${escapeHtml(text)}</a>`
    : `<span${cls}>${escapeHtml(text)}</span>`;
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function resumeContactHtml(content: ResumeContent): string {
  const { identity } = content;

  const contactItems = [
    `<a href="mailto:${escapeHtml(identity.email)}">${escapeHtml(identity.email)}</a>`,
    ...(identity.phone === null
      ? []
      : [`<span>${escapeHtml(identity.phone)}</span>`]),
    `<a href="${escapeHtml(identity.websiteUrl)}">${escapeHtml(identity.website)}</a>`,
    `<a href="${escapeHtml(identity.githubUrl)}">${escapeHtml(identity.githubDisplay)}</a>`,
    `<a href="${escapeHtml(identity.linkedinUrl)}">${escapeHtml(identity.linkedinDisplay)}</a>`,
  ];

  return contactItems.map((c) => `<span class="item">${c}</span>`).join('');
}

function resumeSummaryHtml(content: ResumeContent): string {
  const { summary } = content;

  return summary.length > 0
    ? `<section class="summary">${escapeHtml(summary.join(' '))}</section>`
    : '';
}

function resumeExperienceHtml(content: ResumeContent): string {
  const { experience } = content;

  return `
    <section>
      <h2 class="section-title">Experience</h2>
      ${experience
        .map(
          (e) => `
        <div class="entry">
          <div class="entry-row">
            <div class="entry-headline">
              <span class="entry-title">${escapeHtml(e.jobTitle)}</span>
              <span class="dot">·</span>
              ${linkOrText(e.company, e.url, 'entry-company')}
            </div>
            <span class="entry-date">${escapeHtml(e.dateRange)}</span>
          </div>
          ${e.bullets.length > 0 ? `<ul class="bullets">${e.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : ''}
          ${e.awards.map((a) => `<p class="award"><strong>Recognition:</strong> ${escapeHtml(a)}</p>`).join('')}
        </div>`
        )
        .join('')}
    </section>`;
}

function resumeProjectsHtml(content: ResumeContent): string {
  const { projects } = content;

  return projects.length > 0
    ? `
    <section>
      <h2 class="section-title">Projects</h2>
      ${projects
        .map(
          (p) => `
        <div class="entry">
          <div class="entry-row">
            <div class="entry-headline">
              ${linkOrText(p.title, p.url, 'entry-title')}
              ${p.url !== null && p.urlDisplay !== null && p.urlDisplay !== p.title ? `<a class="project-url" href="${escapeHtml(p.url)}">${escapeHtml(p.urlDisplay)}</a>` : ''}
              ${p.topics.length > 0 ? `<span class="tech">${p.topics.map(escapeHtml).join(' · ')}</span>` : ''}
            </div>
          </div>
          ${p.description !== null ? `<p class="entry-desc">${escapeHtml(p.description)}</p>` : ''}
        </div>`
        )
        .join('')}
    </section>`
    : '';
}

function resumeSkillsHtml(content: ResumeContent): string {
  const { skills } = content;

  return skills.length > 0
    ? `
    <section>
      <h2 class="section-title">Skills</h2>
      <div class="skills-grid">
        ${skills
          .map(
            (s) => `
          <div class="skill-row">
            <div class="skill-category">${escapeHtml(s.category)}</div>
            <div class="skill-items">${s.items.map(escapeHtml).join(' · ')}</div>
          </div>`
          )
          .join('')}
      </div>
    </section>`
    : '';
}

function resumeEducationHtml(content: ResumeContent): string {
  const { education } = content;

  return `
    <section>
      <h2 class="section-title">Education</h2>
      ${education
        .map(
          (e) => `
        <div class="entry">
          <div class="entry-row">
            <div class="entry-headline">
              <span class="entry-title">${escapeHtml(e.degree)}</span>
              <span class="dot">·</span>
              <span class="entry-company">${escapeHtml(e.institution)}</span>
            </div>
            <span class="entry-date">${escapeHtml(e.dateRange)}</span>
          </div>
        </div>`
        )
        .join('')}
    </section>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * `fontFaceCss` is inlined rather than linked: the page is loaded with
 * `setContent`, so a Google Fonts request would make every build depend on the
 * network and could silently fall back to a different face mid-measure.
 */
function renderHtml(content: ResumeContent, fontFaceCss = ''): string {
  const { identity } = content;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(identity.name)} — Résumé</title>
  <style>${fontFaceCss}</style>
${RESUME_CSS}
</head>
<body>
  <header class="identity">
    <div>
      <div class="name">${escapeHtml(identity.name)}</div>
      <div class="role-line">
        <span>${escapeHtml(identity.title)}</span>
        <span class="role-sep">·</span>
        <span>${escapeHtml(identity.location)}</span>
      </div>
    </div>
    <div class="contact">
      ${resumeContactHtml(content)}
    </div>
  </header>

  ${resumeSummaryHtml(content)}
  ${resumeExperienceHtml(content)}
  ${resumeProjectsHtml(content)}
  ${resumeSkillsHtml(content)}
  ${resumeEducationHtml(content)}
</body>
</html>`;
}

export { renderHtml };
