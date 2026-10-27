// Review-only by default. Exports a template for legacy stops that have no
// usable coordinates. Updates happen only with explicit --apply and a filled
// JSON input file; never point this at production without reviewing the data.
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const Stop = require('../src/models/Stop');

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const applying = args.includes('--apply');
const inputPath = valueAfter('--input');
const exportPath = valueAfter('--export');
const missingFilter = { $or: [
  { latitude: { $exists: false } }, { latitude: null }, { longitude: { $exists: false } }, { longitude: null },
] };

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Set MONGO_URI to a reviewed, non-production database first.');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  if (!applying) {
    const stops = await Stop.find(missingFilter).select('_id route stopName stopOrder latitude longitude').lean();
    const template = stops.map((stop) => ({ _id: String(stop._id), route: String(stop.route), stopName: stop.stopName, stopOrder: stop.stopOrder, latitude: '', longitude: '' }));
    const output = JSON.stringify(template, null, 2);
    if (exportPath) {
      const absolute = path.resolve(exportPath);
      await fs.writeFile(absolute, output + '\n', { flag: 'wx' });
      console.log(`Exported ${template.length} missing-stop template rows to ${absolute}`);
    } else {
      console.log(output);
    }
    return;
  }
  if (!inputPath) throw new Error('Apply mode requires --input <reviewed-json-file>.');
  const input = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
  if (!Array.isArray(input) || input.some((item) => !item?._id || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude) || item.latitude < 30.9 || item.latitude > 32 || item.longitude < 72.6 || item.longitude > 73.7)) {
    throw new Error('Input must be an array with reviewed coordinates inside Faisalabad: latitude 30.9–32, longitude 72.6–73.7.');
  }
  for (const item of input) {
    const updated = await Stop.updateOne({ _id: item._id, ...missingFilter }, { $set: { latitude: item.latitude, longitude: item.longitude } }, { runValidators: true });
    if (updated.matchedCount !== 1) throw new Error(`Stop ${item._id} was not missing coordinates or no longer exists; no further rows were changed.`);
  }
  console.log(`Updated ${input.length} reviewed stop coordinates.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
