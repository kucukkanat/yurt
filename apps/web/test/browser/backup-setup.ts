import { inject } from 'vitest';
import { backupConfig } from '../../src/lib/backup';

// The identity backup goes to the local relay, never a public one, and syncs without the production delay.
backupConfig.relays = [inject('relayUrl')];
backupConfig.delayMs = 50;
