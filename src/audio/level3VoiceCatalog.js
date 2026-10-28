// Original internal dialogue, tied to the actual final encounter rather than a timeline.
export const LEVEL3_VOICE_CUES = [
  { id: "good_ending_final", priority: 100, overlap: 0, lines: [
    { id: "l3_protector_good_ending", identity: "protector", text: "It's done.", label: "The Protector", pan: 0.05 }
  ] },
  {
    "id": "arrival",
    "priority": 55,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_tormentor_arrival",
        "identity": "tormentor",
        "text": "Final year, Shaun. Nothing left to hide behind.",
        "label": "The Tormentor",
        "pan": -0.5
      },
      {
        "id": "l3_protector_arrival",
        "identity": "protector",
        "text": "You're still here. One thing at a time.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "emergence",
    "priority": 70,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_anxious_emergence",
        "identity": "anxious",
        "text": "They're coming out of the houses.",
        "label": "The Anxious One",
        "pan": 0.55
      }
    ]
  },
  {
    "id": "house_destroyed",
    "priority": 35,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_house_destroyed",
        "identity": "protector",
        "text": "One down. Keep going.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "half_time",
    "priority": 40,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_tormentor_half_time",
        "identity": "tormentor",
        "text": "Half the time gone already, Shaun.",
        "label": "The Tormentor",
        "pan": -0.5
      }
    ]
  },
  {
    "id": "time_low",
    "priority": 75,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_anxious_time_low",
        "identity": "anxious",
        "text": "Shaun, there's hardly any time left.",
        "label": "The Anxious One",
        "pan": 0.55
      }
    ]
  },
  {
    "id": "arena_clear",
    "priority": 65,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_arena_clear",
        "identity": "protector",
        "text": "It's quiet. He's waiting in the centre.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "boss_intro",
    "priority": 80,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_tormentor_boss_intro",
        "identity": "tormentor",
        "text": "There he is. Still holding what you came for.",
        "label": "The Tormentor",
        "pan": -0.5
      }
    ]
  },
  {
    "id": "dean_fallen",
    "priority": 75,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_anxious_dean_fallen",
        "identity": "anxious",
        "text": "He's down. Is it over?",
        "label": "The Anxious One",
        "pan": 0.55
      }
    ]
  },
  {
    "id": "transformation",
    "priority": 85,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_tormentor_transformation",
        "identity": "tormentor",
        "text": "You thought it would end so easily.",
        "label": "The Tormentor",
        "pan": -0.5
      }
    ]
  },
  {
    "id": "monster_reveal",
    "priority": 90,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_anxious_monster_reveal",
        "identity": "anxious",
        "text": "Shaun... he's changed.",
        "label": "The Anxious One",
        "pan": 0.55
      }
    ]
  },
  {
    "id": "monster_combat",
    "priority": 60,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_monster_combat",
        "identity": "protector",
        "text": "Stay with me. He can still fall.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "monster_enrage",
    "priority": 75,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_tormentor_monster_enrage",
        "identity": "tormentor",
        "text": "Look what you've made him become.",
        "label": "The Tormentor",
        "pan": -0.5
      }
    ]
  },
  {
    "id": "monster_fallen",
    "priority": 85,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_monster_fallen",
        "identity": "protector",
        "text": "He's down. Go and take what's yours.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "degree_taken",
    "priority": 85,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_anxious_degree_taken",
        "identity": "anxious",
        "text": "It's here. We're actually holding it.",
        "label": "The Anxious One",
        "pan": 0.55
      }
    ]
  },
  {
    "id": "degree_held",
    "priority": 85,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_degree_held",
        "identity": "protector",
        "text": "You earned this, Shaun. It's yours.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "portals",
    "priority": 80,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_manipulator_portals",
        "identity": "manipulator",
        "text": "Red or blue. Which one makes all of this worth it?",
        "label": "The Manipulator",
        "pan": 0.25
      },
      {
        "id": "l3_protector_portals",
        "identity": "protector",
        "text": "You don't owe either one an answer. Choose for yourself.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "red_choice",
    "priority": 95,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_red_choice",
        "identity": "protector",
        "text": "You chose it. Keep going.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "blue_choice",
    "priority": 95,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_blue_choice",
        "identity": "protector",
        "text": "Your next step is yours, Shaun.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "burn_raise",
    "priority": 85,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_tormentor_burn_raise",
        "identity": "tormentor",
        "text": "He'd rather burn it than let you take it.",
        "label": "The Tormentor",
        "pan": -0.5
      }
    ]
  },
  {
    "id": "burn_flames",
    "priority": 95,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_anxious_burn_flames",
        "identity": "anxious",
        "text": "Shaun... it's burning.",
        "label": "The Anxious One",
        "pan": 0.55
      }
    ]
  },
  {
    "id": "low_health",
    "priority": 65,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_protector_low_health",
        "identity": "protector",
        "text": "Breathe, Shaun. You're still in this.",
        "label": "The Protector",
        "pan": 0.05
      }
    ]
  },
  {
    "id": "retry",
    "priority": 50,
    "overlap": 0,
    "lines": [
      {
        "id": "l3_manipulator_retry",
        "identity": "manipulator",
        "text": "Back again. You do know how this ends.",
        "label": "The Manipulator",
        "pan": 0.25
      }
    ]
  }
];
