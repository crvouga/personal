import source from '../definition.json';
import { parseDefinition } from './definition';

/** This fleet's own configuration: its machines, endpoints, accounts and source
 * repository. Fleet code never names any of them; it reads them here, and this
 * is the only module that loads the file.
 */
export const fleet = parseDefinition(source);
