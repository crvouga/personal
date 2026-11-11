/** dev-fleet modules load the fleet configuration when imported. Import this
 * first in every entry point so they read this checkout's fleet.json unless
 * DEVFLEET_CONFIG already names one.
 */
import { join } from 'node:path';

process.env['DEVFLEET_CONFIG'] ??= join(import.meta.dir, '../../../fleet.json');
