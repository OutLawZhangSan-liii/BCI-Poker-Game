import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PRESENTATION_VERSION, CARD_SET_VERSION, challengePresentation, challengeRasterQuality, challengeCardSet, cardFacePath, cardBackPath, canResumePresentation } from "./presentation.ts";
import { CHALLENGE_RULE_VERSION, createChallenge, groupKey, validateChallenge } from "../../../desktop/main/challengeModel.ts";

const stimulus = { timing: "sine", geometry: { cardWidth: 136 }, amplitude: .45 };
const old = { ruleVersion: CHALLENGE_RULE_VERSION, classifier: "same-fbcca", stimulus: JSON.stringify(stimulus) };
const current = { ...old, stimulus: JSON.stringify({ presentationVersion: PRESENTATION_VERSION, cardSetVersion: CARD_SET_VERSION, rasterQuality: "sharp-v1", ...stimulus }) };

test("unversioned saved challenges retain green presentation and known versions resolve explicitly", () => {
  assert.equal(challengePresentation(old.stimulus), "legacy-green-v1");
  assert.equal(challengePresentation(current.stimulus), PRESENTATION_VERSION);
  assert.equal(challengeRasterQuality(old.stimulus), "balanced-v1");
  assert.equal(challengeRasterQuality(current.stimulus), "sharp-v1");
  assert.equal(challengePresentation(JSON.stringify({ presentationVersion: "legacy-green-v1" })), "legacy-green-v1");
  assert.throws(() => challengePresentation(JSON.stringify({ presentationVersion: "unknown" })));
});
test("resuming permits only a supported presentation difference, never classifier, geometry or rules changes", () => {
  assert.equal(canResumePresentation(old, current), true);
  assert.equal(canResumePresentation(current, current), true);
  const warmBeforeHd = { ...old, stimulus: JSON.stringify({ presentationVersion: "warm-paper-v1", ...stimulus }) };
  assert.equal(canResumePresentation(warmBeforeHd, current), true);
  assert.equal(challengeRasterQuality(warmBeforeHd.stimulus), "balanced-v1");
  assert.equal(canResumePresentation({ ...old, classifier: "different" }, current), false);
  assert.equal(canResumePresentation({ ...old, ruleVersion: "different" }, current), false);
  for (const changed of [{ ...stimulus, amplitude: .9 }, { ...stimulus, geometry: { cardWidth: 140 } }, { ...stimulus, timing: "square" }, { ...stimulus, presentationVersion: "unknown" }, { ...stimulus, rasterQuality: "unknown" }]) {
    assert.equal(canResumePresentation({ ...old, stimulus: JSON.stringify(changed) }, current), false);
  }
  assert.equal(canResumePresentation({ ...old, stimulus: "invalid-json" }, current), false);
  assert.equal(canResumePresentation({ ...current, stimulus: JSON.stringify({ presentationVersion:PRESENTATION_VERSION, cardSetVersion:"unknown", ...stimulus }) }, current), false);
});
test("old records remain readable, keep their original fingerprint and belong to a separate ranking group", () => {
  const legacy = createChallenge(randomUUID(), "001", "模拟测试", old);
  const warm = createChallenge(randomUUID(), "001", "模拟测试", current);
  const before = JSON.stringify(legacy);
  validateChallenge(legacy); validateChallenge(warm);
  assert.notEqual(groupKey(legacy), groupKey(warm));
  assert.equal(canResumePresentation(legacy.configuration, warm.configuration), true);
  assert.equal(JSON.stringify(legacy), before);
});
test("card sets follow the saved presentation, and mismatched sets cannot be resumed", () => {
  assert.equal(challengeCardSet(old.stimulus), "classic-deck-v1");
  assert.equal(challengeCardSet(current.stimulus), CARD_SET_VERSION);
  assert.equal(challengeCardSet(JSON.stringify({ presentationVersion:"warm-paper-v1" })), "classic-deck-v1");
  assert.throws(() => challengeCardSet(JSON.stringify({ presentationVersion:"warm-paper-v1", cardSetVersion:CARD_SET_VERSION })));
  assert.equal(cardFacePath("Q♥",PRESENTATION_VERSION),"cards/uniform-v4/Q-3.png");
  assert.equal(cardFacePath("7♣",PRESENTATION_VERSION),"cards/uniform-v4/7-2.png");
  assert.equal(cardFacePath("A♠",PRESENTATION_VERSION),"cards/uniform-v4/A-4.png");
  assert.equal(cardFacePath("10♦",PRESENTATION_VERSION),"cards/uniform-v4/10-1.png");
  assert.equal(cardFacePath("7♣",PRESENTATION_VERSION,"crayon-deck-v1"),"cards/crayon-v1/7-2.png");
  assert.equal(cardFacePath("Q♥","warm-paper-v1"),"cards/Q-3.png");
  assert.equal(cardBackPath("legacy-green-v1"),"cards/card-back.svg");
  assert.equal(cardBackPath("warm-paper-v1"),"cards/card-back-warm.svg");
  assert.equal(cardBackPath(PRESENTATION_VERSION),"cards/uniform-v4/card-back.png");
  assert.throws(() => cardFacePath("../../Q♥",PRESENTATION_VERSION));
});
test("the pip revision preserves saved crayon challenges and creates a separate ranking group", () => {
  const saved = { ...old, stimulus:JSON.stringify({presentationVersion:PRESENTATION_VERSION,cardSetVersion:"crayon-deck-v1",rasterQuality:"sharp-v1",...stimulus}) };
  assert.equal(challengeCardSet(saved.stimulus),"crayon-deck-v1");
  assert.equal(challengeCardSet(JSON.stringify({presentationVersion:PRESENTATION_VERSION})),"crayon-deck-v1");
  assert.equal(canResumePresentation(saved,current),true);
  const oldRecord=createChallenge(randomUUID(),"001","模拟测试",saved);
  const newRecord=createChallenge(randomUUID(),"001","模拟测试",current);
  const original=JSON.stringify(oldRecord);
  validateChallenge(oldRecord);validateChallenge(newRecord);
  assert.notEqual(groupKey(oldRecord),groupKey(newRecord));
  assert.equal(JSON.stringify(oldRecord),original);
  for(const rank of ["J","Q","K"])for(const suit of ["♦","♣","♥","♠"]){
    assert.equal(cardFacePath(rank+suit,PRESENTATION_VERSION,"crayon-deck-v1"),cardFacePath(rank+suit,PRESENTATION_VERSION,"crayon-deck-v2"));
  }
  assert.throws(()=>cardFacePath("A♠","warm-paper-v1",CARD_SET_VERSION));
});

test("size profiles preserve saved challenge geometry and separate new rankings", async () => {
 const {challengeTargetSize,GAME_SIZE_PROFILE}=await import("./presentation.ts");
 const enlarged={...current,stimulus:JSON.stringify({...JSON.parse(current.stimulus),gameSizeProfile:GAME_SIZE_PROFILE})};
 assert.equal(challengeTargetSize(current.stimulus),"standard");
 assert.equal(challengeTargetSize(enlarged.stimulus),GAME_SIZE_PROFILE);
 const previous={...enlarged,stimulus:JSON.stringify({...JSON.parse(enlarged.stimulus),gameSizeProfile:'game-open-v3'})};
 assert.equal(challengeTargetSize(previous.stimulus),'game-open-v3');
 assert.equal(canResumePresentation(previous,enlarged),true);
 assert.notEqual(groupKey(createChallenge(randomUUID(),'001','test',previous)),groupKey(createChallenge(randomUUID(),'001','test',enlarged)));
 assert.equal(canResumePresentation(current,enlarged),true);
 assert.notEqual(groupKey(createChallenge(randomUUID(),"001","test",current)),groupKey(createChallenge(randomUUID(),"001","test",enlarged)));
 assert.equal(canResumePresentation({...current,stimulus:JSON.stringify({gameSizeProfile:"unknown"})},enlarged),false);
});

test('v2 saved faces and deck stay addressable and separate from borderless challenges',()=>{
 const saved={...current,stimulus:JSON.stringify({...JSON.parse(current.stimulus),cardSetVersion:'crayon-deck-v2'})};
 assert.equal(canResumePresentation(saved,current),true);
 assert.equal(challengeCardSet(saved.stimulus),'crayon-deck-v2');
 assert.equal(cardFacePath('7♣',PRESENTATION_VERSION,'crayon-deck-v2'),'cards/web-pips-v2/7-2.png');
 assert.equal(cardFacePath('Q♥',PRESENTATION_VERSION,'crayon-deck-v2'),'cards/crayon-v1/Q-3.png');
 for(const set of ['crayon-deck-v1','crayon-deck-v2'])assert.equal(cardBackPath(PRESENTATION_VERSION,set),'cards/crayon-v1/card-back.png');
 assert.notEqual(groupKey(createChallenge(randomUUID(),'001','test',saved)),groupKey(createChallenge(randomUUID(),'001','test',current)));
});

test('v3 saved challenges keep old paper and markers while v4 has a separate group',()=>{
 const saved={...current,stimulus:JSON.stringify({...JSON.parse(current.stimulus),cardSetVersion:'crayon-deck-v3'})};
 assert.equal(challengeCardSet(saved.stimulus),'crayon-deck-v3');
 assert.equal(cardFacePath('7♣',PRESENTATION_VERSION,'crayon-deck-v3'),'cards/borderless-v3/7-2.png');
 assert.equal(cardBackPath(PRESENTATION_VERSION,'crayon-deck-v3'),'cards/borderless-v3/card-back.png');
 assert.ok(canResumePresentation(saved,current));
 assert.notEqual(groupKey(createChallenge(randomUUID(),'001','旧',saved)),groupKey(createChallenge(randomUUID(),'002','新',current)));
});

test('whole-card challenges separate rankings and restore saved surround appearance', async()=>{
 const {challengeAppearance,challengeTargetSize,GAME_SIZE_PROFILE}=await import('./presentation.ts');
 const old={...current,stimulus:JSON.stringify({...JSON.parse(current.stimulus),appearance:'card',gameSizeProfile:'game-comfortable-v1'})};
 const next={...current,stimulus:JSON.stringify({...JSON.parse(current.stimulus),appearance:'card-face',gameSizeProfile:GAME_SIZE_PROFILE})};
 assert.equal(challengeAppearance(old.stimulus),'card');
 assert.equal(challengeAppearance(next.stimulus),'card-face');
 assert.equal(challengeAppearance('{}'),'card');
 assert.equal(challengeTargetSize(old.stimulus),'game-comfortable-v1');
 assert.equal(challengeTargetSize(next.stimulus),GAME_SIZE_PROFILE);
 assert.ok(canResumePresentation(old,next));
 assert.notEqual(groupKey(createChallenge(randomUUID(),'001','旧',old)),groupKey(createChallenge(randomUUID(),'001','新',next)));
 assert.equal(canResumePresentation({...old,stimulus:JSON.stringify({appearance:'unknown'})},next),false);
});