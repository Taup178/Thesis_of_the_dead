// Keep both the objective and the pursuer unnamed.
export const OPENING_VOICE_CUES = [
  { at: 10, id: 'opening_1', identity: 'manipulator', clip: 'opening_manipulator_01', text: 'You have to reach it. Before he does.' },
  { at: 14, id: 'opening_2', identity: 'anxious', clip: 'opening_anxious_01', text: "He's leaving. Shaun, don't let him get away." },
  { at: 18, id: 'opening_3', identity: 'tormentor', clip: 'opening_tormentor_01', text: 'This is your last chance. Do you understand?' },
  { at: 22, id: 'opening_4', identity: 'manipulator', clip: 'opening_manipulator_02', text: 'Stay here, and it all slips away.' },
  { at: 26, id: 'opening_5', identity: 'anxious', clip: 'opening_anxious_02', text: 'Go. Now.' },
  { at: 28, id: 'opening_6', identity: 'protector', clip: 'opening_protector_01', text: 'Shaun. Listen to me. Get up.' },
].map(entry => ({ ...entry, priority: 100, alternatives: false, overlap: 0,
  lines: [{ id: entry.clip, identity: entry.identity, text: entry.text,
    pan: { tormentor: -0.5, anxious: 0.55, manipulator: 0.25, protector: 0.05 }[entry.identity],
    label: { tormentor: 'The Tormentor', anxious: 'The Anxious One', manipulator: 'The Manipulator', protector: 'The Protector' }[entry.identity] }] }));
