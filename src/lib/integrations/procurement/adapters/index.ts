/**
 * Procurement Adapters — Auto-Registration
 *
 * Import this module to register all procurement adapters.
 * Each adapter self-registers with the central registry on import.
 */

import { registerAdapter } from '../registry';
import { amazonBusinessAdapter } from './amazon-business';

// Auto-register all adapters
registerAdapter(amazonBusinessAdapter);

export { amazonBusinessAdapter };
