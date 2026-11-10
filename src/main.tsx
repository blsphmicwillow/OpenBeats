import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { useApp } from './store';
import { engine } from './audio/engine';
import { exchangeFromProject, projectFromExchange } from './lib/daw/project';
import { parseMidi, writeMidi } from './lib/daw/midi';
import { parseAls } from './lib/daw/als';
import { parseRpp, writeRpp } from './lib/daw/rpp';

useApp.getState().initPersistence();

// A small handle for debugging in the console and for automated smoke tests.
if (import.meta.env.DEV) {
  (window as unknown as { openbeats?: unknown; openbeatsEngine?: unknown }).openbeats = useApp;
  (window as unknown as { openbeats?: unknown; openbeatsEngine?: unknown }).openbeatsEngine = engine;
  (window as unknown as { openbeatsDaw?: unknown }).openbeatsDaw = {
    exchangeFromProject,
    projectFromExchange,
    parseMidi,
    writeMidi,
    parseAls,
    parseRpp,
    writeRpp,
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
