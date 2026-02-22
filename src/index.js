const { analyzeText } = require('./hebrewUtils');

const samples = [
  'שלום עולם',
  'Hello שלום World',
  'שגיאה 404',
  'Pure ASCII text',
  'מחשב',
];

console.log('=== Broken Hebrew Dashboard ===\n');

samples.forEach((sample, i) => {
  const report = analyzeText(sample);
  console.log(`Sample ${i + 1}: "${sample}"`);
  console.log(`  Hebrew chars : ${report.hebrewCharacters}/${report.totalCharacters} (${(report.hebrewRatio * 100).toFixed(0)}%)`);
  console.log(`  Status       : ${report.isBroken ? 'BROKEN' : 'OK'}`);
  if (report.issues.length > 0) {
    report.issues.forEach(issue => console.log(`  Issue        : ${issue}`));
  }
  console.log();
});
