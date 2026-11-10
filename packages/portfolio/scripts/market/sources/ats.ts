/**
 * Company career sites, through the public job-board APIs of the applicant
 * tracking systems they use (Greenhouse, Lever, Ashby). No key, no scraping.
 */
import { ASHBY, GREENHOUSE, LEVER, type Board } from '../companies';
import { asArray, asRecord, getJson, mapLimit, str, toText } from '../http';
import { isEngineeringTitle } from '../titles';
import type { Employment, Posting, Source } from '../types';

/** Enough per board to see its mix without one large employer dominating. */
const PER_BOARD = 40;
const CONCURRENCY = 8;

const employmentOf = (label: string): Employment => {
  if (/contract|temporary|freelance/i.test(label)) return 'contract';
  return /full/i.test(label) ? 'full-time' : 'unknown';
};

const greenhouse = async (board: Board): Promise<Posting[]> => {
  const data = await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`
  );
  return asArray(asRecord(data)['jobs'])
    .filter((job) => isEngineeringTitle(str(job['title'])))
    .slice(0, PER_BOARD)
    .map((job) => ({
      id: `greenhouse:${board.token}:${String(job['id'])}`,
      source: 'greenhouse',
      company: str(job['company_name']) || board.token,
      band: board.band,
      title: str(job['title']),
      location: str(asRecord(job['location'])['name']),
      url: str(job['absolute_url']),
      employment: 'unknown',
      text: toText(str(job['content'])),
    }));
};

const lever = async (board: Board): Promise<Posting[]> => {
  const data = await getJson(
    `https://api.lever.co/v0/postings/${board.token}?mode=json`
  );
  return asArray(data)
    .filter((job) => isEngineeringTitle(str(job['text'])))
    .slice(0, PER_BOARD)
    .map((job) => {
      const categories = asRecord(job['categories']);
      const lists = asArray(job['lists'])
        .map((list) => `${str(list['text'])} ${str(list['content'])}`)
        .join(' ');
      return {
        id: `lever:${board.token}:${str(job['id'])}`,
        source: 'lever',
        company: board.token,
        band: board.band,
        title: str(job['text']),
        location: str(categories['location']),
        url: str(job['hostedUrl']),
        employment: employmentOf(str(categories['commitment'])),
        text: toText(`${str(job['descriptionPlain'])} ${lists}`),
      };
    });
};

const ashby = async (board: Board): Promise<Posting[]> => {
  const data = await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${board.token}`
  );
  return asArray(asRecord(data)['jobs'])
    .filter((job) => isEngineeringTitle(str(job['title'])))
    .slice(0, PER_BOARD)
    .map((job) => ({
      id: `ashby:${board.token}:${str(job['id'])}`,
      source: 'ashby',
      company: board.token,
      band: board.band,
      title: str(job['title']),
      location: `${str(job['location'])}${job['isRemote'] === true ? ' (Remote)' : ''}`,
      url: str(job['jobUrl']),
      employment: employmentOf(str(job['employmentType'])),
      text: toText(str(job['descriptionPlain'])),
    }));
};

const boards = (
  id: string,
  list: readonly Board[],
  one: (board: Board) => Promise<Posting[]>
): Source => ({
  id,
  fetch: async () => (await mapLimit(list, CONCURRENCY, one)).flat(),
});

export const ATS_SOURCES: readonly Source[] = [
  boards('greenhouse', GREENHOUSE, greenhouse),
  boards('lever', LEVER, lever),
  boards('ashby', ASHBY, ashby),
];
