import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {releaseVersion,displayVersion} from '../release-version.js';
import {PDF_REVISION,pdfDisposition} from '../report-pdf.js';
import {currentVersion,getVersion} from '../version-registry.js';
import {calculateReport} from '../scoring.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
test('V2.13 product release is independent of original V2.11 answer and scoring versions',()=>{
 assert.equal(releaseVersion,'2.13');assert.equal(displayVersion,'2.13');assert.equal(PDF_REVISION,'2.13');
 assert.equal(read('../package.json').version,'2.13.0');const lock=read('../package-lock.json');assert.equal(lock.version,'2.13.0');assert.equal(lock.packages[''].version,'2.13.0');
 assert.equal(currentVersion,'2.11');assert.equal(getVersion('2.13'),null,'a display release does not invent a new questionnaire/scoring bank');
 const f=read('./fixtures/synthetic-assumed-v2.11-40.json').rows[0],r=calculateReport(f.answers,f.seconds);
 assert.equal(r.releaseVersion,'2.13');assert.equal(r.displayVersion,'2.13');assert.equal(r.reportRevision,'2.13');assert.equal(r.answerVersion,'2.11');assert.equal(r.scoringVersion,'2.11');assert.equal(r.version,'2.11');
 assert.match(decodeURIComponent(pdfDisposition({owner:{name:'样例'},createdAt:'2026-10-14'})),/职业与心理健康测评_样例_2026-10-14_V2\.13\.pdf/);
});
