# Embedded PowerPoint video

Import a `.pptx`, navigate normally, push the video slide, then use its Play,
Pause, Restart, and Seek controls. The document monitor is muted; sound follows
Settings → program audio and the configured audio output/NDI feeds. Leaving a
slide or clearing the presentation stops its videos. Slideshow mode waits for all
videos on the slide to finish; playback starts manually.

Reimport presentations imported before this feature to extract their media.
Existing PDF and static PowerPoint imports remain readable. Reimport older decks
to regenerate cached slides with inherited master/layout styles and correct text scaling.

Without a screen or NDI output, page navigation uses preview mode and video
controls play locally with sound. Connecting an output and pushing switches back
to the muted monitor and program audio routing.

## Supported first version

- Embedded MP4, M4V, WebM, MOV, and OGV files whose codecs Electron can decode.
- Multiple videos on a slide, each with its own transport.
- Original slide order, aspect ratio, rectangular position, and media trim bounds.
- Presentations up to 500 MB; each embedded clip up to 200 MB; extracted media up
  to 500 MB. PDF/legacy PPT imports keep their 100 MB limit.
- Ordinary slides continue using the existing static PDF/image conversion.

Linked/online clips, legacy `.ppt` media, and grouped/rotated/flipped videos show
import notes. The compositor draws videos above the static slide: overlapping
foreground text/shapes are flagged, but their PowerPoint stacking is not reproduced.
PowerPoint animations, transitions, click sequences, and autoplay timing are not
reproduced. Native converters that change slide count cause import to fail rather
than risk matching videos to the wrong slide.

## Implementation

The main process reads media relationships from the original PPTX package and
caches media under the document's `media` directory. `document.json` stores video
filenames, relative geometry, trim times, and original slide dimensions alongside
existing page paths. The renderer never extracts archives or bypasses the preload
bridge. Document playback/status/control use typed IPC and operate on the live
program surfaces. Those surfaces reuse existing program speaker selection and NDI
audio routing. The static fallback extracts only bounded XML and image assets and
follows presentation relationships rather than numeric slide filenames.

## Verification

- `node --import tsx --test tests/document-videos.test.ts tests/document-converters.test.ts tests/documents-slideshow.test.ts`
- `npm run test:documents` checks existing PDF import and renderer navigation.
- `npm run test:document-videos` creates a real WebM with audio, tests two program
  shells, speaker routing, nonzero NDI audio samples, playback transports, cleanup,
  PPTX import, Documents UI, compiled preload, and the muted monitor.
- `npm run typecheck`, `npm run lint`, and `npm run build`.

NDI receiver hardware and actual PowerPoint/WPS/Keynote/LibreOffice video-bearing
decks are not exercised by the isolated integration fixtures.
