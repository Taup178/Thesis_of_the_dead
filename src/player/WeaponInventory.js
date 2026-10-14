export const WEAPONS = Object.freeze([
  { id: 'smg', name: 'SMG', slot: '2', type: 'gun', damage: 15, cooldown: 0.22, ammo: 1 },
  { id: 'pistol', name: 'Pistol', slot: '3', type: 'gun', damage: 22, cooldown: 0.34, ammo: 1 },
  { id: 'dual', name: 'Dual Pistols', slot: '4', type: 'gun', damage: 14, cooldown: 0.3, ammo: 2 },
  { id: 'sword', name: 'Sword', slot: '5', type: 'melee', damage: 45, cooldown: 0.68, reach: 3.1, arc: 0.25 },
  { id: 'dagger', name: 'Dagger', slot: '6', type: 'melee', damage: 30, cooldown: 0.42, reach: 1.9, arc: 0.55 },
]);

export const weaponById = id => WEAPONS.find(weapon => weapon.id === id);
export const weaponBySlot = slot => WEAPONS.find(weapon => weapon.slot === slot);

export const weaponImage = id => `./assets/ui/weapons/${id}.svg`;
