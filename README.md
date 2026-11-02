# Gibson Hero — WIP

Standalone hero-section project. Stack matches the main portfolio
(Vite + vanilla JS + Three.js + GSAP) so it can eventually be folded
into sherifrateb.com as a linked case study — kept separate for now.

## Setup

```bash
npm install
npm run dev
```

## Status

- [x] Project scaffold, punk/raw design system (colors, grain
      overlay, typography tokens in `src/style.css`)
- [x] Three.js scene: lighting rig, placeholder geometry,
      drag-to-orbit with rough inertia
- [x] GSAP entrance animation on load
- [ ] Real Gibson `.glb` model (drop into `public/models/`, see its
      README, then uncomment the loader call in `src/main.js`)
- [ ] String-pluck / chord simulator — samples + Tone.js, stubbed in
      `src/main.js` (see `public/audio/README.md` for the plan)
- [ ] Swap placeholder fonts (`--font-display`, `--font-body` in
      `src/style.css`) for real distressed/mono faces

## Deploy

Not yet connected to Vercel/GitHub — set up as its own repo first,
point Vercel at it same way the portfolio is (auto-deploy on push to
`main`). Link it into the portfolio's project list once it's ready.
