# StoryVerse browser golden-path scaffold

The application does not currently include Playwright/Cypress, so this is a
framework-free, executable acceptance checklist for the in-app browser workflow.
It deliberately uses the visible UI and does not depend on an API key.

1. Start `npm run dev` and open the displayed local URL at desktop width.
2. Confirm the **The Last Ember** landing title and select **Enter the story**.
3. Tab to **Trust Kael**, confirm a visible focus ring, then press Enter.
4. Confirm the world state remains **Elevated**, Kael is not arrested, and Mira's new
   memory says she protected Kael.
5. Open **Ravi**. Confirm his panel shows the earlier Ember failure but never says
   that Kael removed a fragment to stop a larger reaction. Select **Continue as Ravi**.
6. Confirm the scene is narrated as Ravi and any fallback indicator is understandable.
7. Open **Time Machine**, create the **Expose Kael** alternate future, and confirm
   Timeline B is violet/visually distinct, alert is **Critical**, and Kael is detained.
8. Switch to Timeline A and verify its **Elevated / not arrested** state is unchanged;
   switch back to Timeline B and verify its state remains **Critical / detained**.
9. Use **Reset Demo** and confirm the landing/opening state returns.
10. Repeat a decision with a double click or two quick keyboard activations; confirm
    only one committed event/memory appears. At a 390px viewport, confirm there is no
    horizontal overflow and both decision cards remain reachable.

Record the observed URL and pass/fail notes in the final delivery. The Vitest suite
under `src/ai` covers provider failure modes deterministically; this checklist covers
the integrated user journey when a browser runner is not installed.
