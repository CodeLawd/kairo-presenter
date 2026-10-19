# ProPresenter retirement — release notes and rollout

Kairo now presents directly to connected screens, video devices, and independent
NDI feeds. The ProPresenter connection, library match, messages layer, stage
message, playlist discovery, and video-input switching integration have been
retired. Existing songs, service plans, and media remain available.

## Upgrading

Startup removes saved ProPresenter destinations and connection credentials.
Existing Kairo screen, video-device, and NDI outputs keep their configuration.
No physical screen is selected or enabled automatically. If ProPresenter was the only destination, configure a
Kairo screen, video device, or NDI feed before the next service.

ProPresenter can still receive an NDI signal as a third-party receiver, but Kairo
no longer controls it or selects its video input. NDI sender names remain stable.

## Release coordination

- Check recent installation setup flags in the admin church pages for affected
  churches. Current desktop builds report `propresenter: true` when enabled;
  historical coverage is incomplete, and absence of a flag is not proof of no use.
- Publish these release notes with the new
  installer. Keep release notes visible before users choose to update.
- Deploy the revised website copy with that release, including the landing page,
  metadata, dashboard prompts, and download instructions.
- Retain historical admin telemetry and old-client ingestion so affected churches
  remain identifiable during the transition.

Live church usage has not been inspected in this implementation session. No
installer has been published and no website deployment has been made.
