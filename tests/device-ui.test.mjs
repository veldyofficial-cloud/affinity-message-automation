import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('Only the upper class category selects PC, IPAD, or GALAXY',()=>{
 const select=html.match(/<select id="templateType"[^>]*>([\s\S]*?)<\/select>/);
 assert.ok(select);
 assert.deepEqual([...select[1].matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]),
                  ['','PC','IPAD','GALAXY']);
 assert.doesNotMatch(html,/id="deviceType"|id="deviceBox"|DIGITAL_DRAWING/);
});
test('Curriculum change preserves device and approval uses top selection',()=>{
 const handler=html.match(/\$\("curriculumSelect"\)\.addEventListener\("change",\(\)=>\{([\s\S]*?)\n    \}\);/);
 assert.ok(handler);
 assert.doesNotMatch(handler[1],/templateType"\)\.value\s*=/);
 assert.match(html,/const selected = \$\("templateType"\)\.value;/);
 assert.match(html,/templateType:\$\("templateType"\)\.value/);
 assert.doesNotMatch(html,/deviceType:\$\("deviceType"\)\.value/);
});
