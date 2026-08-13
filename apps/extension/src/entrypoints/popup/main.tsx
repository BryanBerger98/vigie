import React from 'react';
import ReactDOM from 'react-dom/client';

import { I18nProvider } from '@/i18n/I18nProvider';

import '@/ui/globals.css';

import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('popup root element is missing');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
