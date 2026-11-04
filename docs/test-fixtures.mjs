// SPDX-License-Identifier: GPL-2.0-or-later
// Give existing battle tests their two-warrior fixture through the editor UI.
export async function loadTestWarriors(page) {
 const sources = [";redcode-94\n;name Imp\n;author A. K. Dewdney\n;assert 1\nmov.i 0, 1\nend\n", ";redcode-94\n;name Dwarf\n;author A. K. Dewdney\n;assert 1\nadd.ab #4, bomb\nmov.i bomb, @bomb\njmp -2\nbomb dat.f #0, #0\nend\n"];
 for (const [i,source] of sources.entries()) {
  await page.locator('#newWarrior').click();
  await page.locator(i===0?'#first':'#second').fill(source);
 }
 await page.locator('#toggleEditors').click();
}
// Only one warrior editor is open at a time: open warrior #first, #second or #warrior-N (from the roster), replace its
// source and, unless keepOpen is set, close the editor again so the battle controls are back in view.
export async function editWarrior(page, id, source, {keepOpen=false}={}) {
 const index = id==='#first' ? 0 : id==='#second' ? 1 : Number(id.replace('#warrior-',''));
 if (!await page.locator(id).isVisible()) await page.locator('#editors .warrior').nth(index).click();
 await page.locator(id).fill(source);
 if (!keepOpen) await showCore(page);
}
// Close the open editor, if any, to get back to the battle view with its controls.
export async function showCore(page) {
 if (await page.locator('#toggleEditors').isVisible()) await page.locator('#toggleEditors').click();
}
// Cell size, arena layout and the color theme live in the View menu; open it when the control is not on screen.
export async function viewOptions(page, control='#cellSize') {
 if (!await page.locator(control).isVisible()) await page.locator('#viewBtn').click();
}
