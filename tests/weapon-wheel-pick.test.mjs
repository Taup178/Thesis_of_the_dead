import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/Game.js';
import { PAD } from '../src/core/Gamepad.js';
import { WEAPONS } from '../src/player/WeaponInventory.js';

const COUNT = WEAPONS.length;

/** Bare object carrying just the wheel state Game.prototype methods touch. */
function wheelGame(pressed = [], { gamepadInUse = false } = {}) {
  const presses = new Set(pressed);
  return {
    presses,
    game: {
      weaponWheelOpen: true,
      weaponWheelIndex: 0,
      wheelX: 0,
      wheelY: 0,
      wheelClickHeld: false,
      player: { weapon: WEAPONS[0].id, ammo: 30 },
      currentLevel: null,
      weaponWheelItems: [],
      weaponWheelEl: { classList: { add() {}, remove() {} }, setAttribute() {} },
      weaponWheelRing: { style: { setProperty() {} }, setAttribute() {} },
      weaponWheelName: { textContent: '' },
      weaponWheelPreview: { src: '', alt: '' },
      weaponWheelType: { textContent: '' },
      weaponWheelDetails: { textContent: '' },
      weaponWheelStatus: { textContent: '' },
      input: {
        gamepadInUse,
        mouseDeltaX: 0,
        mouseDeltaY: 0,
        consumeGamepadPress: button => presses.delete(button),
        releasePadButton: button => presses.delete(button),
        isMouseButtonDown: () => false,
        flushMouseDelta() {},
      },
      _showWheelSelection: Game.prototype._showWheelSelection,
      _setWheelIndex: Game.prototype._setWheelIndex,
      _updateWeaponWheel: Game.prototype._updateWeaponWheel,
      _closeWeaponWheel: Game.prototype._closeWeaponWheel,
      _finishFirstLevelInventoryPause: Game.prototype._finishFirstLevelInventoryPause,
    },
  };
}

/** Angle of wheel slot `index` on the ring, matching the layout in Game. */
const slotAngle = index => -Math.PI / 2 + index * Math.PI * 2 / COUNT;

test('d-pad down and right step the weapon picker forward', () => {
  for (const button of [PAD.DOWN, PAD.NEXT_WEAPON]) {
    const { game, presses } = wheelGame([button]);
    game._updateWeaponWheel();
    assert.equal(game.weaponWheelIndex, 1, `button ${button} moves to slot 1`);
    assert.ok(Math.abs(game.wheelX - Math.cos(slotAngle(1)) * 95) < 1e-9);
    assert.ok(Math.abs(game.wheelY - Math.sin(slotAngle(1)) * 95) < 1e-9);
    assert.equal(presses.has(button), false, 'press is consumed once');
  }
});

test('d-pad up and left step the weapon picker back and wrap around', () => {
  for (const button of [PAD.UP, PAD.PREV_WEAPON]) {
    const { game } = wheelGame([button]);
    game._updateWeaponWheel();
    assert.equal(game.weaponWheelIndex, COUNT - 1, `button ${button} wraps to the last slot`);
  }
});

test('the wheel picker follows the ring past the last slot', () => {
  const { game } = wheelGame([PAD.DOWN]);
  game.weaponWheelIndex = COUNT - 1;
  game._updateWeaponWheel();
  assert.equal(game.weaponWheelIndex, 0);
});

test('each d-pad press moves exactly one slot', () => {
  const { game } = wheelGame([PAD.DOWN]);
  game._updateWeaponWheel();
  game._updateWeaponWheel(); // the press was consumed; holding does not repeat per frame
  assert.equal(game.weaponWheelIndex, 1);
  game.input.consumeGamepadPress = button => button === PAD.DOWN; // a fresh press
  game._updateWeaponWheel();
  assert.equal(game.weaponWheelIndex, 2);
});

test('A equips the weapon the d-pad has highlighted', () => {
  const equipped = [];
  const { game, presses } = wheelGame([PAD.DOWN]);
  game._equipWeapon = id => equipped.push(id);
  game._updateWeaponWheel();
  assert.equal(game.weaponWheelIndex, 1);
  presses.add(PAD.JUMP);
  game._updateWeaponWheel();
  assert.deepEqual(equipped, [WEAPONS[1].id]);
  assert.equal(presses.has(PAD.JUMP), false, 'the press is released so it cannot leak into gameplay');
  assert.equal(game.player.jumpHeld, true, 'closing the wheel with A held does not also jump');
});

test('A equips whatever slot is already highlighted', () => {
  const equipped = [];
  const { game, presses } = wheelGame([PAD.JUMP]);
  game.weaponWheelIndex = COUNT - 1;
  game._equipWeapon = id => equipped.push(id);
  game._updateWeaponWheel();
  assert.deepEqual(equipped, [WEAPONS[COUNT - 1].id]);
  assert.equal(presses.size, 0);
});

test('B closes the wheel without equipping', () => {
  const equipped = [];
  const { game, presses } = wheelGame([PAD.ROLL], { gamepadInUse: true });
  game._equipWeapon = id => equipped.push(id);
  game._updateWeaponWheel();
  assert.equal(game.weaponWheelOpen, false, 'B backs out');
  assert.deepEqual(equipped, [], 'nothing is equipped by backing out');
  assert.equal(game.player.dodgeHeld, true, 'backing out with B held does not roll');
  assert.equal(presses.has(PAD.ROLL), false, 'the press is consumed once');
});

test('LB never equips from the wheel', () => {
  const equipped = [];
  const { game } = wheelGame([], { gamepadInUse: true });
  game._equipWeapon = id => equipped.push(id);
  game.input.isMouseButtonDown = () => true; // LB rides the mouse path
  game._updateWeaponWheel();
  assert.deepEqual(equipped, [], 'held LB does not act like a click');
  assert.equal(game.weaponWheelOpen, true, 'the wheel stays open');
});

test('a mouse click still equips for players without a pad', () => {
  const equipped = [];
  const { game } = wheelGame();
  game._equipWeapon = id => equipped.push(id);
  game.input.isMouseButtonDown = () => true;
  game._updateWeaponWheel();
  assert.deepEqual(equipped, [WEAPONS[0].id]);
});
