/**
 * Large-enterprise and government-contractor career sites. They run Workday,
 * whose public search endpoint lists postings and serves each description
 * from a second request, so every board is capped.
 */
import { WORKDAY, type WorkdayBoard } from '../companies';
import {
  asArray,
  asRecord,
  getJson,
  mapLimit,
  postJson,
  str,
  toText,
} from '../http';
import { isEngineeringTitle } from '../titles';
import type { Posting, Source } from '../types';

const PAGE_SIZE = 20;
const PAGES = 3;
const PER_BOARD = 25;
const SEARCHES = ['software engineer', 'software developer'] as const;

const base = (board: WorkdayBoard): string =>
  `https://${board.token}.${board.host}.myworkdayjobs.com/wday/cxs/${board.token}/${board.site}`;

const listPage = async (
  board: WorkdayBoard,
  searchText: string,
  page: number
): Promise<string[]> => {
  const data = await postJson(`${base(board)}/jobs`, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    searchText,
    appliedFacets: {},
  });
  return asArray(asRecord(data)['jobPostings'])
    .filter((job) => isEngineeringTitle(str(job['title'])))
    .map((job) => str(job['externalPath']));
};

const detail = async (board: WorkdayBoard, path: string): Promise<Posting> => {
  const info = asRecord(
    asRecord(await getJson(`${base(board)}${path}`))['jobPostingInfo']
  );
  return {
    id: `workday:${board.token}:${str(info['jobReqId']) || path}`,
    source: 'workday',
    company: board.token,
    band: board.band,
    title: str(info['title']),
    location: str(info['location']),
    url: str(info['externalUrl']),
    employment: /contract|temporary/i.test(str(info['timeType']))
      ? 'contract'
      : 'full-time',
    text: toText(str(info['jobDescription'])),
  };
};

const fetchBoard = async (board: WorkdayBoard): Promise<Posting[]> => {
  const requests = SEARCHES.flatMap((search) =>
    Array.from({ length: PAGES }, (_, page) => ({ search, page }))
  );
  const pages = await mapLimit(requests, 2, ({ search, page }) =>
    listPage(board, search, page)
  );
  const paths = [...new Set(pages.flat())].slice(0, PER_BOARD);
  return mapLimit(paths, 4, (path) => detail(board, path));
};

export const WORKDAY_SOURCE: Source = {
  id: 'workday',
  fetch: async () => (await mapLimit(WORKDAY, 6, fetchBoard)).flat(),
};
