import React from 'react';
import ReactDOM from 'react-dom/client';
import './ui/theme.css';
import { LegalPage } from './ui/LegalPage';

/* Second Vite entry (see build.rollupOptions.input in vite.config.ts). It
 * ships as dist/legal.html, which GitHub Pages serves at /legal, and the dev
 * server resolves /legal to legal.html the same way. Kept separate from the
 * app bundle on purpose: the notice needs none of the generator, the store,
 * or the gesture code, and the app should not pay for the notice either. */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LegalPage />
  </React.StrictMode>,
);
