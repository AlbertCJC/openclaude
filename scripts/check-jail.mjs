// Run: npm test
import assert from 'node:assert';
const { jail } = await import('../lib/tools.ts');
assert.ok(jail('README.md').endsWith('README.md'));
for (const bad of ['../x', '../../Windows/win.ini', 'C:/Windows/win.ini', '/etc/passwd'])
  assert.throws(() => jail(bad), /outside workspace/, bad);
console.log('jail ok');
