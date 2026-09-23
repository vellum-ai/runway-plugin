# Runway Creative Suite for Vellum

Create, track, cancel, and download Runway Gen-4.5 videos in a Vellum conversation.

## Capabilities

- Generate video from a text prompt.
- Animate a JPEG, PNG, or WebP from an HTTPS URL, Runway URI, data URI, or workspace path.
- Choose duration, orientation, seed, and standard, editorial, grading, or HDR delivery.
- Check asynchronous task progress and credit usage.
- Download successful outputs into durable workspace storage.
- Cancel active tasks without risking deletion of completed generations.

## Tools

| Tool | Description |
| --- | --- |
| `runway_create_video` | Starts a Gen-4.5 text-to-video or image-to-video task. |
| `runway_get_task` | Returns status, progress, and credit information. |
| `runway_download_task` | Downloads successful output and returns file attachments. |
| `runway_cancel_task` | Cancels active tasks and refuses terminal-task deletion. |

## How to use

Try prompts such as:

- “Create a five-second cinematic shot of a cobalt train crossing a snowy mountain bridge at sunrise.”
- “Animate `scratch/product.png` into a slow clockwise product orbit for a landing-page hero.”
- “Make that vertical for Reels, eight seconds, as standard MP4.”
- “Check Runway task `…` and download it when it is ready.”
- “Cancel that Runway generation.”

The assistant confirms material generation settings when needed, starts the asynchronous task, reports its task ID and estimated credit cost, and downloads completed assets instead of exposing Runway's temporary URLs.

## Install

```bash
assistant plugins install https://github.com/vellum-ai/runway-plugin
```

## Requirements

- Vellum Assistant with plugin API `>=0.8.0 <1.0.0`
- A Runway Dev account with API credits
- A Runway Dev API key, collected through Vellum's secure secret UI on first use

## Configuration

| Setting | Default | Notes |
| --- | --- | --- |
| Model | `gen4.5` | V1 intentionally uses one predictable model contract. |
| Duration | 5 seconds | Allowed range is 2–10 seconds. |
| Ratio | `1280:720` | Text generation also supports `720:1280`; image generation supports additional ratios. |
| Output | `mp4` | Editorial and HDR formats carry additional Runway credit charges. |
| Durable output | `scratch/runway/<task-id>/` | Downloaded after task completion. |

## Data and privacy

The Runway API key is requested through Vellum's credential vault and is only authorized for `api.dev.runwayml.com`; it is never stored in plugin source or output files. Prompts and supplied media are sent to Runway Dev to create the requested generation. Local images are read only from inside the workspace and encoded as data URIs, with a 3.3 MB binary limit. Runway output links expire within 24–48 hours, so this plugin downloads successful outputs into the workspace rather than exposing those links directly.

## License

MIT
