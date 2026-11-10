/**
 * The employers whose public career-site APIs are sampled, each labelled with
 * the kind of company it is. The label is the ground truth behind the
 * "corporate / tech / startup / contract" split: a board that answers is
 * sampled, one that stops answering is skipped and reported.
 *
 * Bands: `enterprise` is a large company whose product is not software
 * (banks, insurers, health systems, retail); `consultancy` staffs engineers
 * onto client or government work; `bigtech` and `scaleup` sell software;
 * `startup` is roughly under a few hundred people.
 */
import type { CompanyBand } from './types';

export type Board = { readonly token: string; readonly band: CompanyBand };

export type WorkdayBoard = Board & {
  readonly host: string;
  readonly site: string;
};

const band = (b: CompanyBand, tokens: string): Board[] =>
  tokens.split(' ').map((token) => ({ token, band: b }));

export const GREENHOUSE: readonly Board[] = [
  ...band(
    'bigtech',
    'stripe airbnb databricks cloudflare datadog okta pinterest lyft dropbox reddit instacart mongodb elastic block roblox coinbase twilio zscaler'
  ),
  ...band(
    'scaleup',
    'gitlab robinhood figma discord brex affirm chime gusto asana anthropic samsara toast flexport duolingo vercel carta oscar zocdoc coursera squarespace'
  ),
  ...band('startup', 'flatironhealth garnerhealth komodohealth newsela'),
  ...band(
    'consultancy',
    'navapbc oddball skylighthq thoughtworks dept nearform turing civicactions pluribusdigital'
  ),
];

export const LEVER: readonly Board[] = [
  ...band('bigtech', 'palantir spotify'),
  ...band('scaleup', 'veeva outreach wealthfront matchgroup zoox'),
  ...band('startup', 'aledade finix levelai'),
  ...band('consultancy', 'toptal'),
];

export const ASHBY: readonly Board[] = [
  ...band('scaleup', 'ramp notion openai vanta harvey sierra'),
  ...band(
    'startup',
    'linear cursor supabase posthog replit perplexity elevenlabs cohere modal clerk resend railway render abridge ambiencehealthcare superpower'
  ),
  ...band('consultancy', 'andela braintrust'),
];

const workday = (b: CompanyBand, rows: readonly string[]): WorkdayBoard[] =>
  rows.map((row) => {
    const [token = '', host = '', site = ''] = row.split(' ');
    return { token, host, site, band: b };
  });

export const WORKDAY: readonly WorkdayBoard[] = [
  ...workday('enterprise', [
    'capitalone wd12 Capital_One',
    'mastercard wd1 CorporateCareers',
    'travelers wd5 External',
    'allstate wd5 allstate_careers',
    'geico wd1 External',
    'pnc wd5 External',
    'usbank wd1 US_Bank_Careers',
    'fmr wd1 FidelityCareers',
    'blackrock wd1 BlackRock_Professional',
    'cvshealth wd1 CVS_Health_Careers',
    'cigna wd5 cignacareers',
    'humana wd5 Humana_External_Career_Site',
    'elevancehealth wd1 ANT',
    'athenahealth wd1 External',
    'target wd5 targetcareers',
    'homedepot wd5 CareerDepot',
    'disney wd5 disneycareer',
    '3m wd1 Search',
    'motorolasolutions wd5 Careers',
    'hp wd5 ExternalCareerSite',
    'paypal wd1 jobs',
  ]),
  ...workday('bigtech', [
    'salesforce wd12 External_Career_Site',
    'adobe wd5 external_experienced',
    'workday wd5 Workday',
  ]),
  ...workday('consultancy', [
    'accenture wd103 AccentureCareers',
    'bah wd1 BAH_Jobs',
    'leidos wd5 External',
    'gdit wd5 External_Career_Site',
    'caci wd1 External',
    'guidehouse wd1 External',
    'icf wd5 ICFExternal_Career_Site',
    'pwc wd3 Global_Experienced_Careers',
    'unisys wd5 External',
  ]),
];
