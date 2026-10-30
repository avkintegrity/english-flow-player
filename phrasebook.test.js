import test from 'node:test';
import assert from 'node:assert/strict';
import {phraseMatch,sourceContains} from './phrasebook.js';
test('Dictionary lookup is scoped to its source segment and ignores casing, not context',()=>{const items=[{segmentId:'a',expression:'pick up',meaning:'Забрать'},{segmentId:'b',expression:'pick up',meaning:'Поднять'}];assert.equal(phraseMatch(items,'b',' PICK UP ').meaning,'Поднять');assert.equal(phraseMatch(items,'c','pick up'),undefined);});
test('Saved words must be complete source words or literal expressions, never fabricated substrings',()=>{assert.ok(sourceContains('Pick up the load.','pick up'));assert.ok(sourceContains('The price is $5.','price'));assert.ok(!sourceContains('The road is clear.','load'));assert.ok(!sourceContains('The load is here.','loa'));assert.ok(!sourceContains('Anything',''));assert.ok(!sourceContains('load','.*'));});
