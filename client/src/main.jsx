import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagFont from './assets/fonts/TwemojiCountryFlags.woff2?url';

// Chrome on Windows draws "DZ" instead of 🇩🇿. This adds the missing glyphs —
// and only there: the check inside the package is a canvas test, so on macOS,
// Android and Linux nothing is loaded at all. The font ships with the app
// rather than from a CDN because the app runs online.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFont);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
