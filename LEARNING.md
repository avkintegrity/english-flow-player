# Learning format and storage

Version 2.1 adds a separate IndexedDB `learning` store (database version 4). Existing audio, folders, notes, queue and listening history are retained. Updates never clear IndexedDB. EFP backup manifest v3 includes learning data; v1/v2 backups remain readable.

Open a recording → Text → Import text. Structured `.eftext` JSON v1 requires `format: "english-flow-transcript"`, `audio: {sha256, size, duration, name}`, `segments: [{id, start, end, en, ru}]`, and optional `phrases: [{id, segmentId, expression, meaning, pronunciation, saved, known}]`. Times are seconds. Segments must be ordered and non-overlapping. SHA-256 and byte length must match the selected audio exactly; duration is checked against the browser decoder. The import changes learning data only. Replacing existing text requires confirmation. SRT/VTT requires explicit manual association and has no automatic translation.

Text supports EN, EN+RU, RU, search, source seeking, editing, follow scrolling, sentence replay, sentence loop and pause after sentence. Timing is segment-level, not word alignment. Sentence drills leave the queue intact; normal playback resumes after cancelling the drill. Precise timers in background are subject to browser/iOS limits.

## Verified stage 1

- Node: 38 tests; syntax checks pass.
- Safari storage: 14/14, including v3→v4 preserving original audio/metadata and EFP learning roundtrip.
- Safari native audio: 8 assertions, including last-sentence boundary, loop, pause, source seek/highlight, edited RU and normal queue end after cancelling a drill.
- Manual Safari: import of generated spoken WAV and matching transcript, exact SHA-256 confirmation, and persistence across explicit service-worker update.
- Physical iPhone: NOT TESTED.

Run `npm test`, `npm run check`; serve locally and open `browser-tests.html`, `learning-tests.html` and `media-tests.html`. Test pages generate their own data and use isolated test databases. No personal audio is needed.
