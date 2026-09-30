# Third-party notices

This repository is MIT-licensed (see `LICENSE`). It includes or loads the third-party material
below. npm dependencies are installed from the npm registry under their own licences (MIT, ISC,
BSD-3-Clause, Apache-2.0 and MPL-2.0); none are vendored or modified here.

## Included in this repository

### Lenia Orbium data (Bert Chan)

`projects/doodle-lab/doodles/sim-lenia-orbium.html` uses the Orbium cell array and species
parameters from Bert Chan's Lenia (https://github.com/Chakazul/Lenia).

```
MIT License

Copyright (c) 2018 Bert Chan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### "Hash without Sine" (Dave Hoskins)

The `hash12` function in
`projects/gemini-lab/experiments/022-pointer-theremin-v2/index.html` is Dave Hoskins'
"Hash without Sine" (https://www.shadertoy.com/view/4djSRW), MIT License,
Copyright (c) 2014 David Hoskins. The MIT permission notice above applies to it with that
copyright line.

## npm dependency with a file-level copyleft licence

### mediabunny (MPL-2.0)

The Visual Synth uses `mediabunny` (https://github.com/Vanilagy/mediabunny) for in-browser
video encoding and decoding. It is licensed under the Mozilla Public License 2.0 and is used
unmodified from npm. Its source is available from the npm package and its repository.

## Loaded at runtime from a CDN (not included)

### Google Fonts (SIL Open Font License 1.1)

Pages load web fonts (Caveat, Gochi Hand, Shantell Sans, Instrument Sans, DM Sans, JetBrains Mono
and others) from fonts.googleapis.com. They are not bundled, and pages fall back to system fonts
offline.

### MediaPipe Tasks Vision (Apache-2.0)

`projects/doodle-lab/pack/genart-hand-theremin-v1.html` loads `@mediapipe/tasks-vision` 0.10.14
from cdn.jsdelivr.net and the hand landmarker model from storage.googleapis.com when it starts.
Both are Apache License 2.0 (https://github.com/google-ai-edge/mediapipe).
