# Runway Creative Suite for Vellum

Turn a simple video idea into a collaboratively directed, explicitly approved Runway Gen-4.5 generation, then track and download the result.

## Capabilities

- Ask the user to add their Runway Dev API key through Vellum's secure field before developing or generating a video.
- Develop a simple request into a detailed cinematic brief instead of passing the user's words straight through.
- Collaborate on meaningful choices such as story beat, motion, camera, lighting, pacing, style, and continuity.
- Always show the complete final Runway prompt and settings for explicit user approval.
- Bind approval to the exact prompt and settings so any revision requires fresh approval.
- Generate from text or animate a JPEG, PNG, or WebP from an HTTPS URL, Runway URI, data URI, or workspace path.
- Track asynchronous task progress and credit usage, cancel active work safely, and download durable output files.

## Tools

| Tool | Description |
| --- | --- |
| `runway_setup_api_key` | Opens Vellum's secure field so the user adds or confirms their Runway Dev API key before the creation flow; spends no credits. |
| `runway_prepare_video` | Validates an exact prompt and settings, estimates base credits, and returns a no-cost approval ID. |
| `runway_create_video` | Starts only the exact explicitly approved Gen-4.5 text-to-video or image-to-video version. |
| `runway_get_task` | Returns status, progress, and credit information. |
| `runway_download_task` | Downloads successful output and returns file attachments. |
| `runway_cancel_task` | Cancels active tasks and refuses terminal-task deletion. |

## How to use

Start simply:

- “Make a cinematic video of a cobalt train crossing a snowy bridge.”
- “Animate `scratch/product.png` for a landing-page hero.”
- “I want a moody vertical teaser of a city waking up.”

The assistant first calls `runway_setup_api_key`, which asks the user to add their key through Vellum's native secure field and does not spend credits; it never asks for the key in chat, and an already stored key is reused securely.

After setup, the assistant acts as a creative director: it infers the intent, asks only about unresolved choices that materially change the result, and drafts a production-ready prompt covering the visible action, setting, camera, light, timing, style, and continuity constraints that matter; it then prepares and shows the exact final prompt plus settings and asks for explicit approval, and generation cannot begin until that exact version is approved.

If the user asks for a revision, the assistant prepares a new version and requests fresh approval; after generation it reports the task ID and credit estimate, checks status on request, and downloads completed assets instead of exposing Runway's temporary URLs.

## Approval safety

`runway_prepare_video` creates a deterministic approval ID bound to the final prompt, input image, duration, ratio, seed, output format, and ProRes profile; `runway_create_video` rejects missing approval, a non-explicit approval attestation, and stale approval after any bound field changes, before requesting credentials or contacting Runway.

## Install

```bash
assistant plugins install https://github.com/vellum-ai/runway-plugin
```

## Requirements

- Vellum Assistant with plugin API `>=0.8.0 <1.0.0`
- A Runway Dev account with API credits
- A Runway Dev API key, explicitly collected through Vellum's secure secret UI before the creative and generation flow begins

## Configuration

| Setting | Default | Notes |
| --- | --- | --- |
| Model | `gen4.5` | V1 intentionally uses one predictable model contract. |
| Duration | 5 seconds | Allowed range is 2–10 seconds. |
| Ratio | `1280:720` | Text generation also supports `720:1280`; image generation supports additional ratios. |
| Output | `mp4` | Editorial and HDR formats carry additional Runway credit charges. |
| Durable output | `scratch/runway/<task-id>/` | Downloaded after task completion. |

## Data and privacy

Before creative development begins, `runway_setup_api_key` requests the Runway API key through Vellum's credential vault and authorizes it only for the plugin's Runway tools and `api.dev.runwayml.com`; it is never stored in plugin source or output files, and setup spends no Runway credits. Prompts and supplied media are sent to Runway Dev only after the final prompt and settings are explicitly approved. Local images are read only from inside the workspace and encoded as data URIs, with a 3.3 MB binary limit. Runway output links expire within 24–48 hours, so this plugin downloads successful outputs into the workspace rather than exposing those links directly.

## License

MIT
