# /public/audio

For the future string-pluck simulator.

Plan: one clean sample per open string (E A D G B E — 6 files),
then use Tone.js playback-rate / pitch-shift to fake frets and
chords from that same set rather than sampling every fret
individually. Keeps the asset list small and is realistic to build.

Suggested naming: `string-E2.mp3`, `string-A2.mp3`, `string-D3.mp3`,
`string-G3.mp3`, `string-B3.mp3`, `string-E4.mp3`.

Not wired up yet — see the stub in `src/main.js` for where the
raycaster + trigger logic will go once this is ready.
