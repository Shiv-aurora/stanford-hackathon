import { useSyncExternalStore } from 'react';
import { createMissionSource } from './api';
import type { MissionActions, MissionView } from './types';

// One mission source for the whole app (mock or api, see lib/api.ts).
const source = createMissionSource();

export function useMission(): { view: MissionView; actions: MissionActions } {
  const view = useSyncExternalStore(source.subscribe, source.getView);
  return { view, actions: source };
}
