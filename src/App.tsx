import { useEffect } from 'react';
import { Board } from './ui/Board';
import { Controls } from './ui/Controls';
import { ParentLockup } from './ui/ParentLockup';
import { useAppStore } from './state/store';
import './ui/app.css';

export function App() {
  const generate = useAppStore(s => s.generate);
  const loadFromUrl = useAppStore(s => s.loadFromUrl);
  const map = useAppStore(s => s.map);
  const seed = map?.seed;

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#m=')) {
      const ok = loadFromUrl(hash.slice(3));
      if (ok) return;
    }
    generate();
  }, [generate, loadFromUrl]);

  return (
    <div className="app">
      <header className="app__header">
        <ParentLockup
          productName="CATAN LAB"
          color="var(--catan-gold)"
          className="app__title"
        />
        {seed !== undefined && <span className="app__seed">seed: {seed.toString(36)}</span>}
      </header>
      <Board />
      <Controls />
    </div>
  );
}
