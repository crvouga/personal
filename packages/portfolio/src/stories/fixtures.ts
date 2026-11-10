/** Real content for stories: stories show what the site shows. */
import { ARCHIVE_PROJECTS, PROJECTS, type Project } from '../content/project';

const find = (list: readonly Project[], id: string): Project => {
  const found = list.find((project) => project.id === id);
  if (found === undefined) throw new Error(`Unknown project: ${id}`);
  return found;
};

export const projectById = (id: string): Project => find(PROJECTS, id);
export const archiveById = (id: string): Project => find(ARCHIVE_PROJECTS, id);
