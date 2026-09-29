import { useCallback, useEffect, useState } from 'react';
import { Frame, Sidebar, Sky, type NavKey } from './components/Shell';
import { NewMissionDialog, ResultDialog } from './components/Dialogs';
import { Overview } from './pages/Overview';
import { Compartments } from './pages/Compartments';
import { Federation } from './pages/Federation';
import { useMission } from './lib/useMission';
import { K } from './lib/theme';

// Hash routes: #/  ·  #/compartments[/<workerKey>]  ·  #/federation
interface Route {
  page: NavKey;
  worker: string | null;
}

function parseHash(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'compartments') return { page: 'compartments', worker: parts[1] ? decodeURIComponent(parts[1]) : null };
  if (parts[0] === 'federation') return { page: 'federation', worker: null };
  return { page: 'overview', worker: null };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const go = (hash: string) => {
  window.location.hash = hash;
};

// Each screen in the mockup seeds its own starfield.
const SKY_SEED: Record<NavKey, number> = { overview: 97, compartments: 131, federation: 173 };

export default function App() {
  const { view, actions } = useMission();
  const route = useRoute();
  const [dialog, setDialog] = useState<'result' | 'new' | null>(null);
  const close = useCallback(() => setDialog(null), []);

  const phase = view.incident?.phase ?? 0;
  const missionDot = view.approved ? K.green : phase === 0 || phase === 6 ? K.blue : K.red;

  return (
    <Frame>
      <Sky seed={SKY_SEED[route.page]} />
      <Sidebar active={route.page} missionName={view.name} missionDot={missionDot} onNewMission={() => setDialog('new')} />
      {route.page === 'overview' && (
        <Overview
          view={view}
          actions={actions}
          onOpenWorker={(key) => go('#/compartments/' + encodeURIComponent(key))}
          onReviewResult={() => setDialog('result')}
        />
      )}
      {route.page === 'compartments' && (
        <Compartments view={view} workerKey={route.worker} onSelect={(key) => go('#/compartments/' + encodeURIComponent(key))} />
      )}
      {route.page === 'federation' && <Federation />}

      {dialog === 'result' && <ResultDialog view={view} onApprove={() => actions.approve()} onClose={close} />}
      {dialog === 'new' && (
        <NewMissionDialog
          initialPrompt={view.prompt}
          mode={view.mode}
          onClose={close}
          onLaunch={(p) => {
            actions.createMission(p);
            setDialog(null);
            go('#/');
          }}
        />
      )}
    </Frame>
  );
}
