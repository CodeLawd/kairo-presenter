# App screenshots

> **These are pre-rename captures.** They show the app before it became Kairo,
> so the chrome and accent colour do not match the current build. Recapture at
> the same 2200x1365 geometry described below, or the crop values need re-tuning.

Real captures of the running Kairo app, referenced from the landing page components in
`src/components/landing/`.

Four files carry nine sections. Several sections zoom into a region of one of
these via `src/components/landing/Detail.tsx`, which crops with CSS
`background-size` / `background-position` rather than slicing separate files.

| File | Used for |
|------|----------|
| `operator.png` | Hero (full), plus three crops: the transcript rail (02), the detected-slides grid (03), and the live output and queue rail (04). |
| `scripture.png` | The playlist rail crop (05) and the full view (06). |
| `theme.png` | The full editor (07) and a crop of the NDI status panel (09). |
| `lyrics.png` | The full lyrics view (08). |

## Replacing one

Capture with **Cmd+Shift+4 then Space**, click the window, and let it save to the
Desktop — do not drag the floating thumbnail anywhere, since that copy is
deleted almost immediately. Then move it here under the same filename.

Captures come in at 3328x2066 on a Retina display. Trim the sliver of other
windows that bleeds in at the very top and scale to 2200px wide:

```sh
sips --cropOffset 12 0 -c 2054 3328 operator.png
sips -Z 2200 operator.png
```

Crop coordinates in `src/components/landing/sections.tsx` are tuned to that 2200x1365 geometry, so a
replacement at a different size will need the `zoom`/`x`/`y` values re-checked.
