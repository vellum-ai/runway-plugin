---
name: runway-creative-suite
description: >-
  Create and manage cinematic Runway Gen-4.5 videos from text prompts or still images, then download durable output files.
metadata:
  emoji: "🎬"
  vellum:
    display-name: "Runway Creative Suite"
    activation-hints:
      - "User asks to generate a video with Runway"
      - "User wants to animate a photo or still image"
      - "User asks about a Runway generation task"
      - "User wants to download or cancel a Runway video"
---

# Runway Creative Suite

Use these tools to create, track, download, and cancel Runway Gen-4.5 video generations.

## Create a video

1. Determine whether the request is text-to-video or image-to-video.
2. Before calling `runway_create_video`, make sure the user has clearly approved the prompt, duration, ratio, and any premium output format because the call spends Runway credits.
3. Write prompts concretely: subject and action, environment, camera movement, lighting, pacing, and visual style.
4. Use 5 seconds and `1280:720` when the user does not care about duration or orientation; use `720:1280` for vertical social video.
5. Use standard `mp4` unless the user explicitly needs editorial, grading, or HDR delivery because other formats cost additional credits.
6. Present the returned task ID, mode, and estimated credit cost, then offer to check status.

## Animate an image

Pass an HTTPS URL, `runway://` URI, data URI, or workspace-local JPEG, PNG, or WebP path as `image`; describe motion and evolution rather than redescribing every static detail, and mention that Gen-4.5 center-crops inputs when the requested ratio differs.

## Track and retrieve output

- Use `runway_get_task` to report `PENDING`, `THROTTLED`, `RUNNING`, `SUCCEEDED`, `FAILED`, or `CANCELLED` and show progress or credit usage when available.
- Do not expose Runway's raw output URLs because they expire within 24–48 hours.
- When a task succeeds, call `runway_download_task` promptly; it saves durable files under `scratch/runway/<task-id>/` and returns attachments.
- If a task is not ready, report its current state rather than repeatedly polling faster than every five seconds.

## Cancel safely

Use `runway_cancel_task` only when the user explicitly asks to stop an active task; the tool intentionally refuses terminal tasks so Runway's delete behavior cannot erase completed output.

## Tone

Be creative and collaborative, but stay precise about cost, current task state, failures, output format, and file durability.
