# Third-party assets

## world-dots.svg

- **Source:** [File:World map (blue dots).svg](https://commons.wikimedia.org/wiki/File:World_map_(blue_dots).svg) — Wikimedia Commons
- **Author:** sNowFleikuN
- **Licence:** [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — attribution required
- **Changes made:** every dot in the original was an identical bezier circle wrapped
  in its own `<g transform="translate(…)">` (2 790 groups, 955 KB). The translations
  were extracted and re-emitted as plain `<circle>` elements with a single shared
  radius and fill, the outer `matrix(1.25,0,0,-1.25,…)` flip was baked into the
  coordinates and the empty margin was cropped. **955 KB → 86 KB**, same drawing.
  The blue fill was replaced by the app's gold, but that colour is only a
  fallback: the panel paints the map through a CSS mask, so on screen it takes
  the accent of whichever palette is active.

Used as a decorative background on the exchange-rate panel
(`.rate-hist` in `src/styles.css`).
