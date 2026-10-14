// Add safe walking space after each hazard without widening any jump gaps.
const AFTER_BLADES = 8, AFTER_BRIDGE = 8;
const spikeCorridorLength = 40, spikeEntryLength = 8;
const spikeCorridorMinZ = 9.5 + AFTER_BRIDGE;
const spikeCorridorMaxZ = spikeCorridorMinZ + spikeCorridorLength;
const spikeEntryMaxZ = spikeCorridorMaxZ + spikeEntryLength;
const bridgeCount = 6, bridgeSpacing = 5.2;
const extraBridgeLength = (bridgeCount - 3) * bridgeSpacing;
const bridgeOffset = AFTER_BRIDGE + extraBridgeLength + spikeCorridorLength + spikeEntryLength;
const sawOffset = AFTER_BLADES + bridgeOffset;
const firstBladeZ = 50.5 + sawOffset, lastBladeZ = firstBladeZ - 3 * 6;
const bladeDeckMinZ = 29.5 + bridgeOffset;

export const SOPHOMORE_LAYOUT = Object.freeze({
  frontZ: 70.5 + sawOffset,
  entrancePortalZ: 67.5 + sawOffset,
  spawnZ: 57.5 + sawOffset,
  deanStartZ: 54.5 + sawOffset,
  firstBladeZ, bladeSpacing: 6, bladeCount: 4,
  bladeDeckMinZ,
  bladeCompleteZ: lastBladeZ - 2,
  bridgeCheckpointZ: (lastBladeZ - 2 + bladeDeckMinZ) / 2,
  bridgeFirstZ: 25 + bridgeOffset, bridgeSpacing, bridgeCount,
  bridgeMinZ: spikeEntryMaxZ, bridgeMaxZ: bladeDeckMinZ,
  spikeCorridorMinZ, spikeCorridorMaxZ, spikeEntryMaxZ,
  spikeCheckpointZ: (spikeCorridorMaxZ + spikeEntryMaxZ) / 2,
  spikeCheckpointTriggerZ: spikeEntryMaxZ - 1,
  memoryDeckMaxZ: 9.5 + AFTER_BRIDGE,
  memoryTriggerZ: 7,
  deckWidth: 14,
});

// Keep saved memory checkpoints at index 2; the new intervening hazard uses index 3.
export const SPIKE_CORRIDOR_PUZZLE = 3;
