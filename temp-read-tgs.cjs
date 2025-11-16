const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const file = path.join(__dirname, 'assets', 'lottie', 'no-groups.tgs');
const buffer = fs.readFileSync(file);
const decoded = zlib.gunzipSync(buffer);
const text = decoded.toString('utf-8').replace(/^\uFEFF/, '');
const json = JSON.parse(text);
const textLayers = json.layers.filter(layer => layer.ty === 5);
console.log('text layer count:', textLayers.length);
console.log(JSON.stringify(textLayers[0]?.t, null, 2));
