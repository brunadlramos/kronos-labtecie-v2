// Prova que escH neutraliza cargas de quebra de atributo. Rodar: node tests/escH.test.mjs
import assert from 'node:assert';
import { escH } from '../public/js/utils.js';
for (const p of ['"><img src=x onerror=alert(1)>', "'", '" onmouseover="alert(1)', '<script>']) {
  const o = escH(p);
  assert.ok(!/["'<>]/.test(o), 'sobrou caractere perigoso: ' + o);
}
assert.strictEqual(escH('#F15A24'), '#F15A24');
console.log('escH ok');
