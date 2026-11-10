/**
 * The phrases a posting uses: two- and three-word runs, lower-cased, with no
 * stopword at either end and nothing from the legal and benefits boilerplate
 * every posting carries. Counted per segment, they are the market's own
 * vocabulary; the ones distinctive to a segment are the words a presentation
 * for it should speak in.
 */
import { eng } from 'stopword';

const STOP: ReadonlySet<string> = new Set([
  ...eng,
  'will',
  'etc',
  'eg',
  'ie',
  'including',
  'within',
  'across',
  'using',
  'must',
  'able',
  'strong',
  'new',
  'well',
  'also',
  'work',
  'working',
  'role',
  'team',
  'teams',
  'company',
  'years',
  'year',
  'experience',
  'ability',
  'looking',
  'help',
  'join',
  'like',
  'can',
  'us',
  'we',
  'you',
  'our',
  'your',
  'not',
  'may',
  'does',
  'please',
  'cannot',
  'per',
  'one',
  'two',
  'three',
  'least',
  'every',
  'want',
  'get',
  'gets',
]);

/** Words that mark legal, benefits and application boilerplate. */
const BOILERPLATE =
  /^(equal|opportunity|employer|disabilit\w*|veteran\w*|gender|race|religion|sexual|orientation|origin|national|benefits?|insurance|401k|pto|salary|salaries|compensation|pay|bonus\w*|equity|dental|vision|medical|holidays?|leave|parental|visa|sponsorship|accommodations?|applicants?|eeo|privacy|policy|cookies?|protected|status|marital|ancestry|genetic|age|citizenship|background|check|drug|base|range|offer|perks?|stipend|wellness|paid|vacation|retirement|health|hiring|apply|application|candidates?|interview\w*|resume|cover|letter|location|hybrid|onsite|office|relocation|travel|hours|week|days?|time|full|part|law|laws|legal|discriminat\w*|regard|conviction\w*|arrest\w*|ordinance|chance|fair|expression|identity|applicable|reasonable|providing|committed|employment|employees?|qualified|consider\w*|contact|note|read|listed|below|above|include\w*|limited|modified|description|responsibilities|qualifications?|preferred|required|requirements?|degree|field|bachelor\w*|master\w*|related|equivalent|francisco|san|bay|york|seattle|austin|states|united|america|headquartered|based|located|mission|values|culture|family|planning|personal|information|data protection|gdpr|ccpa|e-verify|everify|assistance|disclaimer|notice|statement|careers|page|website|email|phone|criminal|histories|recruiting|sales|state|local|physical|mental|factors|los|angeles|mention|hn|intro|call|love|hear|world|certain|annual|u|series|million|allowance|spend)$/;

const WORD = /^[a-z][a-z0-9+#.-]*[a-z0-9+#]$|^[a-z]$/;
const MIN_N = 2;
const MAX_N = 3;

/** The distinct phrases in one posting's text. */
export const phrasesOf = (text: string): string[] => {
  const found = new Set<string>();
  for (const clause of text
    .toLowerCase()
    .split(/[.,;:!?()[\]{}"|•·\n\r\t/]+/)) {
    const words = clause.split(/\s+/).filter((word) => word !== '');
    for (let n = MIN_N; n <= MAX_N; n += 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        const run = words.slice(i, i + n);
        const first = run[0] ?? '';
        const last = run[n - 1] ?? '';
        if (STOP.has(first) || STOP.has(last)) continue;
        if (!run.every((word) => WORD.test(word))) continue;
        if (run.some((word) => BOILERPLATE.test(word))) continue;
        found.add(run.join(' '));
      }
    }
  }
  return [...found];
};
