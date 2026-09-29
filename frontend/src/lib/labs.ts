// The three labs from the Federation view. Each lab has its own missions; in
// api mode the sidebar's profile block switches between them.

import { DEMO_PROMPT } from './mock';

export type LabId = 'ai' | 'defense' | 'biotech';

export interface Lab {
  id: LabId;
  name: string;
  initials: string;
  /** First part of the mission subtitle. */
  kind: string;
  /** Mission started automatically the first time the lab is opened (mirrors backend/services/decomposer.py). */
  demoPrompt: string;
  /** Mission code names, assigned in creation order. */
  codeNames: string[];
}

export const LABS: Lab[] = [
  {
    id: 'ai',
    name: 'AI Lab',
    initials: 'AL',
    kind: 'Confidential AI research',
    demoPrompt: DEMO_PROMPT,
    codeNames: ['Orion', 'Halcyon', 'Meridian', 'Tessera', 'Lyra', 'Cygnus'],
  },
  {
    id: 'defense',
    name: 'Defense Lab',
    initials: 'DL',
    kind: 'Confidential defense analysis',
    demoPrompt:
      'Confidential: Project Bastion is our program to protect a forward operating base from small drone attacks. ' +
      'The threat assessment expects adversary swarms of up to 40 low-cost drones approaching at night. ' +
      'The sensor suite combines two S-band radars, passive RF detection and EO/IR cameras. ' +
      'Effectors include RF jammers, interceptor drones and a 10 kW laser prototype. ' +
      'The base perimeter is 3.2 km with two hills that mask low-altitude approaches from the east. ' +
      'Rules of engagement require human authorization before any kinetic engagement near the civilian airfield. ' +
      'Procurement is capped at 18 million dollars over two years, including maintenance and spares. ' +
      'Field trials last month reached a 91% detection rate but missed drones flying below 30 meters. ' +
      'Intelligence reporting from allied liaison sources suggests the adversary is fielding fiber-optic guided drones.',
    codeNames: ['Bastion', 'Perseus', 'Aquila', 'Scutum', 'Lupus', 'Corvus'],
  },
  {
    id: 'biotech',
    name: 'Biotech Lab',
    initials: 'BL',
    kind: 'Confidential biotech research',
    demoPrompt:
      'Confidential: Project Meridian is our program to develop an oral KRAS G12C inhibitor for lung cancer. ' +
      'The target protein is mutant KRAS and we bind a cryptic pocket near switch II. ' +
      'Our lead series has 14 candidate molecules derived from a covalent acrylamide scaffold. ' +
      'Biochemical assays show an IC50 of 12 nM with 40-fold selectivity over wild-type. ' +
      'In mouse xenograft studies tumours shrank by 60% but two animals showed liver toxicity. ' +
      'Manufacturing currently yields 35% over nine steps and the process has not been scaled. ' +
      'We plan an IND filing with the FDA in Q3 next year. ' +
      "Our patent application covers the scaffold but a competitor's prior art may overlap. " +
      'Relevant published literature includes sotorasib and adagrasib clinical papers.',
    codeNames: ['Meridian', 'Hydra', 'Vela', 'Carina', 'Pavo', 'Crux'],
  },
];

export const labOf = (id: string | undefined | null): Lab => LABS.find((l) => l.id === id) ?? LABS[0];
