/**
 * How each theme reads in a job posting. Patterns are deliberately broad:
 * what matters is how a theme's frequency differs between kinds of employer,
 * not whether any single posting is classified perfectly.
 */
import type { Theme } from '../../src/knowledge/themes';

export const THEME_PATTERNS: Readonly<Record<Theme, RegExp>> = {
  'ai-assisted':
    /\b(ai[- ](assisted|native|first|coding|tools?|tooling|pair)|copilot|cursor|claude code|codex|coding agents?|agentic (coding|development|workflows?|engineering))\b/i,
  'ai-products':
    /\b(llms?|rag|gen(erative)?[- ]?ai|ai agents?|ai[- ]powered|prompt engineering|foundation models?|ai (features|products?|applications?))\b/i,
  'testing-quality':
    /\b(unit tests?|integration tests?|test automation|tdd|test[- ]driven|automated test\w*|code quality|code reviews?|testing)\b/i,
  'ci-cd':
    /\b(ci\/cd|continuous (integration|delivery|deployment)|github actions|jenkins|deployment pipelines?|release (process|automation))\b/i,
  architecture:
    /\b(system design|architect\w*|distributed systems|scalab\w+|microservices|design patterns|technical (design|strategy|roadmap|vision))\b/i,
  leadership:
    /\b(mentor\w*|tech(nical)? lead(s|ership)?|lead(ing)? (a|the|small) (team|project)s?|coach\w*|guide (other|junior)|technical direction|raise the bar)\b/i,
  ownership:
    /\b(ownership|end[- ]to[- ]end|own (the|projects?|features?)|autonom\w+|self[- ]starter|zero to one|0 ?(to|→|->) ?1|many hats|ambigu\w+)\b/i,
  'product-sense':
    /\b(product[- ]minded|product sense|customer[- ](facing|obsess\w+|focus\w*)|user experience|cross[- ]functional|with (product|design)\b|product managers?)\b/i,
  integrations:
    /\b(integrat\w+|third[- ]party|sso|oauth|saml|webhooks?|rest(ful)? apis?|graphql|sdk)\b/i,
  'cloud-infra':
    /\b(aws|azure|gcp|kubernetes|terraform|infrastructure[- ]as[- ]code|docker|cloud[- ]native|devops)\b/i,
  data: /\b(sql|data model\w*|etl|data pipelines?|relational databases?|postgres\w*|schema design)\b/i,
  regulated:
    /\b(hipaa|soc ?2|fedramp|pci|gdpr|ferpa|fda|healthcare|health ?tech|clinical|patients?|financial services|banking|insurance|regulated|regulatory|higher education|ed-?tech)\b/i,
  process: /\b(agile|scrum|sprints?|kanban|jira|sdlc)\b/i,
  stakeholders:
    /\b(stakeholders?|client[- ]facing|consult(ing|ants?)|requirements gathering|business (partners|requirements|analysts?)|directly with (customers|clients))\b/i,
  documentation:
    /\b(documentation|technical writing|written communication|design docs?|rfcs?|specifications?)\b/i,
  'performance-scale':
    /\b(high[- ](traffic|scale|volume|availability|throughput)|performance (optimi\w+|tuning|bottlenecks?)|low[- ]latency|latency|at scale|millions of|reliability|resilien\w+|uptime|on-?call)\b/i,
  mobile: /\b(react native|ios|android|mobile)\b/i,
  'frontend-craft':
    /\b(accessib\w+|a11y|design systems?|responsive|ui\/ux|pixel|component librar\w+)\b/i,
  payments: /\b(payments?|billing|fintech|ledger|subscriptions?)\b/i,
  realtime:
    /\b(real[- ]time|web[- ]?sockets?|offline|collaborat\w+ editing|event[- ]driven|streaming)\b/i,
  modernization:
    /\b(legacy|moderniz\w+|migrat\w+|refactor\w*|re-?architect\w*|re-?platform\w*)\b/i,
  speed:
    /\b(fast[- ]paced|ship (fast|quickly)|move fast|iterate quickly|rapid\w*|velocity)\b/i,
  'open-source': /\bopen[- ]source\b/i,
};
