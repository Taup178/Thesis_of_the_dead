/**
 * Compiles GPU programs for objects that stay hidden while the loading screen is up,
 * so their first mid-game reveal does not stall on shader compilation.
 * Hidden objects are made visible only for the compile pass and restored afterwards.
 */
export async function compileHiddenObjects(renderer, scene, camera, objects) {
  const hidden = objects.filter(object => object && !object.visible);
  if (hidden.length === 0) return;
  for (const object of hidden) object.visible = true;
  try {
    await renderer?.compileAsync?.(scene, camera);
  } finally {
    for (const object of hidden) object.visible = false;
  }
}
