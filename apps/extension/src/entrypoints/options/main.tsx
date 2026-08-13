import React from 'react';
import ReactDOM from 'react-dom/client';

import '@/ui/globals.css';

import { I18nProvider } from '@/i18n/I18nProvider';

import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('options root element is missing');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
