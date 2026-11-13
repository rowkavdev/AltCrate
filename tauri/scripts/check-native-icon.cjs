const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const iconPath = process.argv[2] ?? resolve(__dirname, '../casepilot/src-tauri/icons/icon.png');
const png = readFileSync(iconPath);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// The PNG header contains the bit depth and color type of the image data.
const isRgbaPng = png.length >= 33 &&
  png.subarray(0, 8).equals(signature) &&
  png.readUInt32BE(8) === 13 &&
  png.toString('ascii', 12, 16) === 'IHDR' &&
  png[24] === 8 &&
  png[25] === 6;

if (!isRgbaPng) {
  console.error(`${iconPath}: Tauri requires an 8-bit RGBA PNG.`);
  process.exitCode = 1;
}
