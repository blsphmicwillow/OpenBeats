import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { useApp } from './store';
import { engine } from './audio/engine';

useApp.getState().initPersistence();

// A small handle for debugging in the console and for automated smoke tests.
if (import.meta.env.DEV) {
  (window as unknown as { openbeats?: unknown; openbeatsEngine?: unknown }).openbeats = useApp;
  (window as unknown as { openbeats?: unknown; openbeatsEngine?: unknown }).openbeatsEngine = engine;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
