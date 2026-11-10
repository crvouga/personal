/**
 * Market research: the shapes shared by the fetchers, the extractor and the
 * aggregator. A `Posting` is one job advertisement, normalised so the source
 * it came from no longer matters.
 */

/** What kind of employer posted it; labelled per board, inferred otherwise. */
export type CompanyBand =
  'startup' | 'scaleup' | 'bigtech' | 'enterprise' | 'consultancy' | 'unknown';

export type Employment = 'full-time' | 'contract' | 'unknown';

export type Posting = {
  readonly id: string;
  readonly source: string;
  readonly company: string;
  readonly band: CompanyBand;
  readonly title: string;
  readonly location: string;
  readonly url: string;
  readonly employment: Employment;
  /** Plain text: tags stripped, entities decoded. */
  readonly text: string;
};

export type Source = {
  readonly id: string;
  readonly fetch: () => Promise<Posting[]>;
};
