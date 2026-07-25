# StoryVerse story-image browser acceptance checklist

This is a framework-free in-app-browser checklist. It verifies the visual layer
without an image-provider key and records the end-to-end requirements that are
not practical to assert with a DOM-less unit test.

## Setup

1. Start `npm run dev` with `OPENAI_API_KEY` unset.
2. Open the Vite URL at desktop width, then repeat the mobile checks at 390px.
3. Keep the browser dev tools network panel open only to confirm that no provider
   credential is present in a request or response.

## Golden path

1. Load **The Last Ember** and verify the opening scene reserves a stable image
   region containing either its bundled fallback or a generated image. Its
   accessible image description must identify the Eastern Bridge without exposing
   provider IDs or technical errors.
2. Enter the story, then activate **Trust Kael** with the keyboard. Verify the
   committed event, relationship/memory changes, and **Elevated** state appear
   immediately—before the image loading state resolves.
3. Confirm the Trust scene displays an amber, secretive bridge image (or its
   labelled fallback). It must not use the Expose/Timeline B image.
4. Inspect Ravi and select **Continue as Ravi**. Verify a Ravi point-of-view image
   appears for the active branch. Its visible description must not state that Kael
   removed the fragment to stop a larger reaction.
5. Open **Time Machine**, create the **Expose Kael** alternate future, and verify
   Timeline B has a distinct violet image/thumbnail, **Critical** alert, and
   detained Kael. The original Timeline A thumbnail stays amber.
6. Switch A → B → A. Verify each timeline immediately reuses its own cached image
   and switching B never changes A's story state or artwork.
7. Reset the demo. Verify the opening fallback returns, no stale Timeline B image
   remains in the active reader, and the app remains usable without an API key.

## Failure and resilience checks

1. With no image key, verify each requested moment remains readable with the
   bundled fallback and an understandable non-blocking status; decisions must
   still commit exactly once.
2. Use the mock/failure configuration to force a provider error. Verify one
   automatic retry at most, then a non-disruptive fallback. The **Retry image**
   control (if visible) must be keyboard reachable and must not duplicate the
   image record on rapid activation.
3. Use the mock timeout configuration. Verify the image region keeps its size,
   shows fallback after timeout, and does not undo a committed story decision.
4. Reload after a successful mocked image request. Reopen the same scene and
   confirm it is served from cache rather than creating another provider request.

## Accessibility and responsive checks

1. Tab through both decision cards, image retry (when present), character cards,
   timeline toggles, and reset. Every focused control has a visible focus state.
2. At 390px width, verify no horizontal scroll occurs, image aspect ratio is stable,
   decision controls remain reachable, and alternate-timeline labels are legible.
3. Turn off images or simulate a broken image URL. Ensure fallback alt text and
   scene narration still convey the moment; the UI must not collapse or trap focus.

Record local/deployed URL, viewport, API-key state, mock mode, and pass/fail notes
in the final release report. Do not mark a provider-backed result as passed unless
the exact mocked or deployed scenario was observed.
