/**
 * Open job boards with public JSON feeds, and Hacker News "Who is hiring?".
 * Their employers are unlabelled, so the company band is inferred from the
 * posting's own words (see `bandFromText`).
 */
import { asArray, asRecord, getJson, str, toText } from '../http';
import { isEngineeringTitle } from '../titles';
import type { CompanyBand, Employment, Posting, Source } from '../types';

const STARTUP_CUES =
  /\b(pre-?seed|seed[- ](stage|funded|round)|series [abc]\b|yc [swfx]\d\d|y combinator|founding (engineer|team)|early[- ]stage|small team|\d{1,2}[- ]person team|bootstrapped|startup)\b/i;
const CONSULTANCY_CUES =
  /\b(for our clients?|client engagements?|consultancy|consulting firm|staffing (firm|agency)|talent network|digital agency)\b/i;

export const bandFromText = (text: string): CompanyBand => {
  if (CONSULTANCY_CUES.test(text)) return 'consultancy';
  return STARTUP_CUES.test(text) ? 'startup' : 'unknown';
};

const CONTRACT_CUES =
  /\b(contract(or)?\b(?! (law|negotiat|management))|freelance|1099|c2c|corp[- ]to[- ]corp|contract[- ]to[- ]hire|hourly rate|\$\d{2,3} ?(\/|per) ?h(ou)?r)\b/i;

export const employmentFromText = (label: string): Employment => {
  if (CONTRACT_CUES.test(label)) return 'contract';
  return /full[-_ ]?time/i.test(label) ? 'full-time' : 'unknown';
};

const remoteOk = async (): Promise<Posting[]> =>
  asArray(await getJson('https://remoteok.com/api'))
    .filter((job) => isEngineeringTitle(str(job['position'])))
    .map((job) => {
      const text = toText(str(job['description']));
      const tags = (job['tags'] as unknown[] | undefined)?.join(' ') ?? '';
      return {
        id: `remoteok:${str(job['id'])}`,
        source: 'remoteok',
        company: str(job['company']),
        band: bandFromText(text),
        title: str(job['position']),
        location: `Remote ${str(job['location'])}`,
        url: str(job['url']),
        employment: employmentFromText(`${tags} ${str(job['position'])}`),
        text: `${text} ${tags}`,
      };
    });

const remotive = async (): Promise<Posting[]> => {
  const data = await getJson(
    'https://remotive.com/api/remote-jobs?category=software-dev'
  );
  return asArray(asRecord(data)['jobs'])
    .filter((job) => isEngineeringTitle(str(job['title'])))
    .map((job) => {
      const text = toText(str(job['description']));
      return {
        id: `remotive:${String(job['id'])}`,
        source: 'remotive',
        company: str(job['company_name']),
        band: bandFromText(text),
        title: str(job['title']),
        location: `Remote ${str(job['candidate_required_location'])}`,
        url: str(job['url']),
        employment: employmentFromText(str(job['job_type'])),
        text,
      };
    });
};

const jobicy = async (): Promise<Posting[]> => {
  const data = await getJson(
    'https://jobicy.com/api/v2/remote-jobs?count=50&industry=dev'
  );
  return asArray(asRecord(data)['jobs'])
    .filter((job) => isEngineeringTitle(str(job['jobTitle'])))
    .map((job) => {
      const text = toText(str(job['jobDescription']));
      const type = (job['jobType'] as unknown[] | undefined)?.join(' ') ?? '';
      return {
        id: `jobicy:${String(job['id'])}`,
        source: 'jobicy',
        company: str(job['companyName']),
        band: bandFromText(text),
        title: str(job['jobTitle']),
        location: `Remote ${str(job['jobGeo'])}`,
        url: str(job['url']),
        employment: employmentFromText(type),
        text,
      };
    });
};

/** Months of "Who is hiring?" to read: the current thread and the one before. */
const HN_THREADS = 2;
const HN_API = 'https://hn.algolia.com/api/v1';

type HnComment = { id: string; text: string };

const hnComments = async (storyId: string): Promise<HnComment[]> => {
  const data = await getJson(
    `${HN_API}/search?tags=comment,story_${storyId}&hitsPerPage=1000`
  );
  return asArray(asRecord(data)['hits'])
    .filter((hit) => String(hit['parent_id']) === storyId)
    .map((hit) => ({
      id: str(hit['objectID']),
      text: str(hit['comment_text']),
    }));
};

/** "Acme | Senior Engineer | Remote (US) | …": company, then the role part. */
const hnPosting = ({ id, text }: HnComment): Posting | null => {
  const [headHtml = ''] = text.split(/<p>/i);
  const head = toText(headHtml);
  const parts = head.split('|').map((part) => part.trim());
  const title = parts.find((part) => isEngineeringTitle(part));
  const body = toText(text);
  if (title === undefined || parts.length < 2) return null;
  return {
    id: `hn:${id}`,
    source: 'hn-who-is-hiring',
    company: parts[0] ?? '',
    // The thread is overwhelmingly small companies hiring directly.
    band: bandFromText(body) === 'unknown' ? 'startup' : bandFromText(body),
    title,
    location: head,
    url: `https://news.ycombinator.com/item?id=${id}`,
    employment: employmentFromText(head),
    text: body,
  };
};

const hackerNews = async (): Promise<Posting[]> => {
  const stories = asArray(
    asRecord(
      await getJson(
        `${HN_API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=12`
      )
    )['hits']
  )
    .filter((hit) => /who is hiring/i.test(str(hit['title'])))
    .slice(0, HN_THREADS);
  const threads = await Promise.all(
    stories.map((story) => hnComments(str(story['objectID'])))
  );
  return threads
    .flat()
    .map(hnPosting)
    .filter((posting): posting is Posting => posting !== null);
};

export const BOARD_SOURCES: readonly Source[] = [
  { id: 'hn-who-is-hiring', fetch: hackerNews },
  { id: 'remoteok', fetch: remoteOk },
  { id: 'remotive', fetch: remotive },
  { id: 'jobicy', fetch: jobicy },
];
