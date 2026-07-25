# Story image contract

- Client image moments are limited to `world_cover`, `chapter_scene`, and `perspective_scene`.
- The browser sends a world ID, scene ID, approved moment, and optional character perspective ID; it never sends a raw image prompt.
- The server loads persisted world and chapter context, builds the provider prompt, and caches the resulting image by world, scene, moment, perspective, and prompt version.
- Image generation is asynchronous and non-blocking. The reader remains usable while an image is loading, unavailable, or retried.
- A character-perspective image must use only the selected character’s saved scene context.
