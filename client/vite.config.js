import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Le serveur de développement fait suivre /api vers le back-end, pour que
// l'interface et l'API partagent une origine — ni CORS ni cookie à régler.
//
// VERS QUI : par défaut vers le hub en ligne, parce que l'application EST en
// ligne. `npm run dev` suffit alors à travailler sur l'interface : pas de
// serveur local à lancer, pas de PostgreSQL, pas de base à semer, et les
// comptes sont ceux de l'entreprise.
//
// Pour travailler sur le SERVEUR, lancez-le et pointez ici :
//     VITE_API_TARGET=http://localhost:4000 npm run dev
//
// Le hub est l'adresse par défaut et non localhost : se tromper vers le hub
// donne une application qui marche, se tromper vers localhost donne « mot de
// passe incorrect » sur un serveur qu'on n'a pas démarré.
const TARGET = process.env.VITE_API_TARGET || 'https://swift-cargo-app-pqs1.onrender.com';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: TARGET,
        changeOrigin: true,
        // Render met une instance inactive en veille : le premier appel de la
        // journée peut mettre près d'une minute à revenir.
        timeout: 120_000,
        proxyTimeout: 120_000,
      },
    },
  },
});
