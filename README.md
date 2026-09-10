# Nordholm

<!-- badges -->
[![CI](https://github.com/YuraItDeveloper14/nordholm/actions/workflows/check.yml/badge.svg)](https://github.com/YuraItDeveloper14/nordholm/actions/workflows/check.yml) [![License](https://img.shields.io/github/license/YuraItDeveloper14/nordholm?color=blue)](LICENSE) [![Last commit](https://img.shields.io/github/last-commit/YuraItDeveloper14/nordholm)](https://github.com/YuraItDeveloper14/nordholm/commits)

One-page site for a fictional winter timber-build company. The whole hero is a
scroll-driven time-lapse: scroll position maps onto the video's `currentTime`,
so the house is built by the reader rather than played at them.

## Run it

```
python serve.py
```

Then open http://localhost:5178

The stock `python -m http.server` will **not** work: it does not answer HTTP
Range requests, so the browser reports the video as unseekable and the scrub
silently does nothing. `serve.py` is a small static server that handles ranges.
Any real host (nginx, Vercel, Netlify, GitHub Pages) does this already, so on
deploy you only need the static files.

## Files

| File | What it is |
|---|---|
| `index.html` | markup, including the eight caption blocks and their scroll stops |
| `styles.css` | design system, grade, rail, captions, responsive |
| — | no film grain, no blend modes: both softened the plate |
| `scroll.js` | scroll → `video.currentTime` mapping, caption and rail state |
| `assets/build-timelapse.mp4` | the plate, 10 s, cropped and re-encoded all-intra for scrubbing |
| `assets/build-timelapse-sm.mp4` | 854px variant, used at 900px viewport and under |
| `assets/poster.jpg` | first frame, shown before the video decodes |
| `serve.py` | dev server with Range support |

## How the scrub works

`.build` is 760vh tall with a `position: sticky` viewport inside it. Two things
have to be smooth, and they are separate problems.

**The page.** A mouse wheel delivers scroll in ~100px chunks, so captions and the
rail arrive in visible steps. `scroll.js` intercepts the wheel, keeps a virtual
scroll target, and eases the real scroll position towards it every frame. Touch
is left alone: it already has momentum, and hijacking it makes things worse.

**The video.** Scroll offset becomes a 0-1 progress value, holding the first 10%
on the empty clearing and the last 4% on the finished house, with everything
between mapped onto the clip. Seeks are snapped to frame boundaries (seeking
between frames costs a decode and shows the same picture) and are never issued
while one is still in flight. Gaps larger than 1.2 s cut instead of crawling.

Both easings use `1 - exp(-dt / tau)`, so the feel is identical at 60Hz and
144Hz. To dial it, change the constants at the top of `scroll.js`:

| Constant | Default | Effect |
|---|---|---|
| `SCROLL_TAU` | `0.13` | page glide. Higher is heavier and laggier |
| `VIDEO_TAU` | `0.09` | how hard the video chases the scroll |
| `SNAP_JUMP` | `1.2` | seconds of video above which a jump cuts |

Caption timings live in the markup as `data-at` values in page-progress space.
To retime a caption, change its `data-at`; nothing in the JS needs touching.

## The video

Two encodes; `scroll.js` picks the small one for narrow or low-DPR viewports
and upgrades in place if the window is later widened.

```
ffmpeg -i source.mp4 -an \
  -vf "crop=1136:720:0:0,hqdn3d=1.5:1.0:4:4,unsharp=5:5:0.5:5:5:0.0" \
  -c:v libx264 -preset veryslow -crf 20 -pix_fmt yuv420p \
  -x264-params "keyint=1:min-keyint=1:scenecut=0" \
  -movflags +faststart assets/build-timelapse.mp4
```

**Crop 1136x720, not 1280x574.** The watermark sits 143px in from the right
edge, so cutting the right side removes it while keeping every row of real
pixels. Cutting the bottom instead (the first attempt) left a 2.23:1 plate that
`object-fit: cover` then had to blow up 1.6x and crop 35% of the width on a
typical desktop. At 1136x720 the same viewport upscales it 1.27x and crops
nothing horizontally. That single change is most of the sharpness.

| Viewport | Upscale | Cropped away |
|---|---|---|
| 1440x900 | 1.27x | 1% height |
| 1600x900 | 1.41x | 11% height |
| 1920x1080 | 1.69x | 11% height |
| 2560x1300 | 2.25x | 20% height |

`hqdn3d` before `unsharp` matters: denoising first means the sharpener lifts
real edges rather than compression noise. `keyint=1` makes every frame a
keyframe, so a seek decodes exactly one frame. Measured over 90 sequential
seeks in headless Chromium (software decode, so read these as relative):

| Encode | Median seek | p95 |
|---|---|---|
| GOP-3, crf 20 | 86 ms | 176 ms |
| all-intra, crf 20 | 39 ms | 58 ms |

Audio is stripped since the video never plays.

## Copy and provenance

Nordholm is not a real company. All text, figures and contact details are
placeholder copy; nothing here is a real specification, price or performance
claim.

The time-lapse is AI-generated video, not footage of an actual building site.
Its visible generator mark was cropped out during the re-encode above; the
invisible SynthID watermark is still embedded in the file.

## Tests

`python -m pytest -q tests` serves the page locally, opens it in Chromium and checks
that the headline shows and no script error is thrown — on load and while scrolling.
Needs `pip install pytest playwright` and `python -m playwright install chromium`.
