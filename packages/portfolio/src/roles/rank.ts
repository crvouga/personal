/**
 * Ranking: which facts to lead with for a role.
 *
 * A fact scores the demand for everything it is evidence of, from both halves
 * of the market knowledge base. Each theme and each technology contributes
 * the share of the role's postings that ask for it, scaled by how
 * distinctive that request is to the role; each theme also contributes
 * how decisive the role's market research rates it. No model is involved:
 * a market refresh, a new research or a new fact re-ranks every presentation on
 * the next build.
 */
import { SKILLS } from './skills';
import type { Theme } from '../knowledge/themes';
import type { Demand } from './demand';

/** Technologies say less about fit than the kind of work, so they weigh less. */
const TOPIC_WEIGHT = 0.5;
/** Caps the reward for a rare-but-distinctive request. */
const MAX_LIFT = 2;
/**
 * How much the market research amplifies the measured demand. Postings say
 * how often a theme is asked for; the research says how decisive it is to the
 * person reading. A theme the research rates most decisive counts this many
 * times over; one it never mentions counts once.
 */
const RESEARCH_WEIGHT = 1.2;

export type Rankable = {
  readonly themes: readonly Theme[];
  readonly topics: readonly string[];
  /** How deep the evidence is; 1 when unset. Scales the whole score. */
  readonly strength?: number;
};

const weight = (share: number | undefined, lift: number | undefined): number =>
  (share ?? 0) * Math.min(lift ?? 1, MAX_LIFT);

/** topic → the strongest demand among the market skills it is evidence of. */
export const topicDemand = (demand: Demand): Map<string, number> => {
  const byTopic = new Map<string, number>();
  for (const skill of SKILLS) {
    const value = weight(
      demand.skills.get(skill.id),
      demand.skillLift.get(skill.id)
    );
    for (const topic of skill.topics) {
      byTopic.set(topic, Math.max(byTopic.get(topic) ?? 0, value));
    }
  }
  return byTopic;
};

export const scoreOf = (fact: Rankable, demand: Demand): number => {
  const topics = topicDemand(demand);
  const themeScore = fact.themes.reduce(
    (sum, theme) =>
      sum +
      weight(demand.themes.get(theme), demand.themeLift.get(theme)) *
        (1 + RESEARCH_WEIGHT * (demand.research.get(theme) ?? 0)),
    0
  );
  const topicScore = [...new Set(fact.topics)].reduce(
    (sum, topic) => sum + (topics.get(topic) ?? 0),
    0
  );
  return (themeScore + TOPIC_WEIGHT * topicScore) * (fact.strength ?? 1);
};

/** Highest score first; ties keep the knowledge base's curated order. */
export const rankBy = <T>(
  items: readonly T[],
  demand: Demand,
  factOf: (item: T) => Rankable
): T[] =>
  items
    .map((item, index) => ({
      item,
      index,
      score: scoreOf(factOf(item), demand),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
