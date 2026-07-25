import type { GeneratedScene, SceneGenerationInput } from "./types";

const TRUST_MIRA: GeneratedScene = {
  title: "The Bell Kept Ringing",
  narration:
    "Mira lowered her hand before the guard rounded the bridge. Kael's shoulders did not relax; they merely stopped shaking. Below them, lanterns swung across Astra's festival streets while the warning bells counted out the city's fear. Mira had chosen a promise over an accusation, and the choice settled in her chest like a live coal. When Ravi reached the archway, his gaze moved from Kael's empty hands to Mira's guarded face. He saw enough to worry, not enough to know. The bridge remained open. So did every question.",
  dialogue: [
    { characterId: "kael", text: "You have bought Astra a little time. I will not waste it." },
    { characterId: "ravi", text: "Mira, tell me why the heir is still standing free." },
  ],
  closingHook: "Far below the palace, the Ember Core answered the bells with one thin, frightened pulse.",
  source: "fallback",
};

const EXPOSE_MIRA: GeneratedScene = {
  title: "A Crown in Custody",
  narration:
    "Mira's accusation crossed the eastern bridge before the wind could carry it away. Ravi moved first, placing himself between her and Kael as the city guard closed around the prince. Kael did not resist. His silence made the gathered lantern-bearers lean closer, and their whispers turned the festival into a trial. The alert lamps along the palace wall changed from gold to a hard emergency red. Mira had done what the city could see was right, yet the prince's warning stayed lodged beneath her ribs. As Kael was led toward the gate, he looked once at the dark palace vault—not at Mira.",
  dialogue: [
    { characterId: "ravi", text: "You did the right thing by bringing this to me." },
    { characterId: "kael", text: "Detain me if you must. The Core will not wait for your certainty." },
  ],
  closingHook: "Behind the palace doors, a new crack of light appeared where no light should have been.",
  source: "fallback",
};

const RAVI_TRUST: GeneratedScene = {
  title: "What Ravi Could Not Prove",
  narration:
    "Ravi had guarded enough royal corridors to recognize a lie that had been dressed for ceremony. On the bridge, Mira's silence was not proof; it was a shield she had decided to carry. He watched Kael disappear into the lantern haze, free but watched, and measured the distance between protecting a young courier and trusting her judgment. The palace had hidden an Ember failure once before. That memory made every polite answer sound rehearsed. Ravi did not know what Kael had taken, only that the prince and Mira now shared a dangerous secret-shaped absence.",
  dialogue: [
    { characterId: "ravi", text: "Keep your eyes open, Mira. A secret has weight, even when no one names it." },
  ],
  closingHook: "Ravi turned toward the palace, following the sound of a bell that no guard had rung.",
  source: "fallback",
};

const RAVI_EXPOSE: GeneratedScene = {
  title: "The Guard's Oath",
  narration:
    "Ravi kept pace beside Mira as the guard escorted Kael through the eastern gate. She had trusted him with the truth she could name, and that trust sharpened his resolve. The city had become louder, not safer: shutters slammed, alarm lamps burned red, and every face in the crowd demanded an answer. Ravi knew the palace had concealed an earlier Ember failure, which meant detention could be the beginning of clarity—or another curtain drawn across the same old wound. He would keep Mira close, ask careful questions, and refuse the comfort of an easy villain.",
  dialogue: [
    { characterId: "ravi", text: "Stay beside me. We will learn what the palace has been hiding." },
  ],
  closingHook: "At the vault stair, Ravi found fresh ash where the stone should have been cold.",
  source: "fallback",
};

export function selectFallbackScene(input: SceneGenerationInput): GeneratedScene {
  if (input.protagonistId === "ravi") {
    return { ...(input.decision === "EXPOSE_KAEL" ? RAVI_EXPOSE : RAVI_TRUST) };
  }
  return { ...(input.decision === "EXPOSE_KAEL" ? EXPOSE_MIRA : TRUST_MIRA) };
}
