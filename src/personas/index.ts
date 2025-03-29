import type { PersonaDirectory } from '../types.js';
import { enterpriseTechPersonas } from './enterprise_tech.js';
import { gameDevPersonas } from './game_developers.js';

export * from './enterprise_tech.js';

export function availablePersonas(): { [key: string]: PersonaDirectory } {
  return {
    enterpriseTech: enterpriseTechPersonas,
    gameDevelopers: gameDevPersonas,
  };
}
