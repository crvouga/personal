/**
 * The technologies job postings name, and which of the knowledge base's
 * topics is evidence of each. A skill with no topic is one the market asks
 * for that nothing in the knowledge base can back yet: it is reported as a
 * gap and never shown as a skill.
 */
import type { Topic } from '../content/topic';

export type Skill = {
  readonly id: string;
  readonly label: string;
  readonly pattern: RegExp;
  readonly topics: readonly Topic[];
};

/**
 * Skills evidenced by something other than a project's stack are claimed in
 * the knowledge base (`src/knowledge/capabilities.ts`), with the fact that
 * backs each one.
 */

const skill = (
  id: string,
  label: string,
  pattern: RegExp,
  topics: readonly Topic[] = []
): Skill => ({ id, label, pattern, topics });

export const SKILLS: readonly Skill[] = [
  skill('typescript', 'TypeScript', /\btypescript\b/i, ['typescript']),
  skill('javascript', 'JavaScript', /\b(javascript|es6)\b/i, ['javascript']),
  skill('python', 'Python', /\bpython\b/i, ['python']),
  skill('go', 'Go', /\b(golang|Go(?=[,/)]| (and|or|programming|services)\b))/, [
    'go',
  ]),
  skill('rust', 'Rust', /\brust\b/i, ['rust']),
  skill('java', 'Java', /\bjava\b(?!script)/i),
  skill('kotlin', 'Kotlin', /\bkotlin\b/i),
  skill('swift', 'Swift', /\b(swift|swiftui)\b/i),
  skill('csharp', 'C#/.NET', /(c#|\.net\b|dotnet|asp\.net)/i),
  skill('cpp', 'C++', /c\+\+/i),
  skill('ruby', 'Ruby/Rails', /\b(ruby|rails)\b/i),
  skill('php', 'PHP', /\b(php|laravel|drupal)\b/i, ['php']),
  skill('scala', 'Scala', /\bscala\b/i),
  skill('elixir', 'Elixir', /\b(elixir|phoenix)\b/i),
  skill('sql', 'SQL', /\bsql\b/i, ['postgres', 'mysql', 'sqlite']),
  skill('react', 'React', /\breact(\.?js)?\b(?! native)/i, ['react']),
  skill('nextjs', 'Next.js', /\bnext\.?js\b/i, ['nextjs']),
  skill('vue', 'Vue', /\b(vue(\.?js)?|nuxt)\b/i, ['vue', 'nuxt']),
  skill('angular', 'Angular', /\bangular\b/i),
  skill('svelte', 'Svelte', /\bsvelte(kit)?\b/i),
  skill('react-native', 'React Native', /\breact[- ]native\b/i, [
    'react-native',
  ]),
  skill('tailwind', 'Tailwind', /\btailwind\b/i, ['tailwind']),
  skill('html-css', 'HTML/CSS', /\b(html5?|css3?|sass|scss)\b/i, [
    'html',
    'css',
  ]),
  skill('redux', 'Redux', /\bredux\b/i, ['redux']),
  skill('graphql', 'GraphQL', /\bgraphql\b/i, ['graphql']),
  skill('rest', 'REST APIs', /\b(REST(ful)?|rest(ful)? apis?)\b/, [
    'express',
    'flask',
  ]),
  skill('nodejs', 'Node.js', /\bnode(\.?js)?\b/i, ['nodejs']),
  skill('express', 'Express', /\b(express(\.?js)?|nestjs|fastify)\b/i, [
    'express',
  ]),
  skill('django', 'Django/Flask', /\b(django|flask|fastapi)\b/i, ['flask']),
  skill('spring', 'Spring', /\bspring( boot)?\b/i),
  skill('postgres', 'PostgreSQL', /\bpostgres(ql)?\b/i, ['postgres']),
  skill('mysql', 'MySQL', /\bmysql\b/i, ['mysql']),
  skill('mongodb', 'MongoDB', /\bmongo(db)?\b/i, ['mongodb']),
  skill('dynamodb', 'DynamoDB', /\bdynamodb\b/i, ['dynamodb']),
  skill('redis', 'Redis', /\bredis\b/i),
  skill('nosql', 'NoSQL', /\bnosql\b/i, ['mongodb', 'dynamodb']),
  skill('oracle', 'Oracle', /\boracle\b/i),
  skill('snowflake', 'Snowflake', /\bsnowflake\b/i),
  skill('kafka', 'Kafka', /\b(kafka|kinesis|rabbitmq|pub\/?sub)\b/i),
  skill('elasticsearch', 'Elasticsearch', /\b(elasticsearch|opensearch)\b/i),
  skill('aws', 'AWS', /\b(aws|amazon web services)\b/i, ['aws']),
  skill('azure', 'Azure', /\bazure\b/i),
  skill('gcp', 'GCP', /\b(gcp|google cloud)\b/i),
  skill('cloudflare', 'Cloudflare', /\bcloudflare\b/i, ['cloudflare']),
  skill('docker', 'Docker', /\b(docker|containers?|containeriz\w+)\b/i, [
    'docker',
  ]),
  skill('kubernetes', 'Kubernetes', /\b(kubernetes|k8s|eks|gke|openshift)\b/i),
  skill(
    'terraform',
    'Terraform/OpenTofu',
    /\b(terraform|opentofu|infrastructure[- ]as[- ]code|iac)\b/i,
    ['opentofu']
  ),
  skill(
    'ci-cd',
    'CI/CD',
    /\b(ci\/cd|continuous (integration|delivery|deployment))\b/i,
    ['github-actions']
  ),
  skill('github-actions', 'GitHub Actions', /\bgithub actions\b/i, [
    'github-actions',
  ]),
  skill('jenkins', 'Jenkins', /\bjenkins\b/i),
  skill('git', 'Git', /\b(git|github|gitlab)\b/i),
  skill('linux', 'Linux', /\b(linux|unix)\b/i, ['nixos', 'docker']),
  skill('microservices', 'Microservices', /\bmicro[- ]?services?\b/i),
  skill('serverless', 'Serverless', /\b(serverless|lambda)\b/i),
  skill('websockets', 'WebSockets', /\bweb[- ]?sockets?\b/i, ['websocket']),
  skill(
    'playwright',
    'Playwright/Cypress',
    /\b(playwright|cypress|selenium)\b/i,
    ['playwright']
  ),
  skill('jest', 'Jest', /\b(jest|vitest|mocha)\b/i, ['jest']),
  skill(
    'llm-apis',
    'LLM APIs',
    /\b(llms?|openai|anthropic|claude|gpt-?\d?|rag|prompt engineering|langchain)\b/i
  ),
  skill(
    'ai-tools',
    'AI coding tools',
    /\b(copilot|cursor|claude code|ai[- ](assisted|coding|pair)|codex)\b/i
  ),
  skill('salesforce', 'Salesforce', /\bsalesforce\b/i, ['salesforce']),
  skill(
    'observability',
    'Observability',
    /\b(datadog|grafana|prometheus|observability|opentelemetry|new relic|splunk)\b/i
  ),
  skill('agile', 'Agile/Scrum', /\b(agile|scrum|kanban)\b/i),
  skill('figma', 'Figma', /\bfigma\b/i),
  skill('stripe', 'Stripe', /\bstripe\b(?! is| was|'s)/i),
  skill('oauth', 'OAuth/SSO', /\b(oauth2?|oidc|saml|sso|single sign[- ]on)\b/i),
  skill('accessibility', 'Accessibility', /\b(accessibility|a11y|wcag)\b/i),
];
