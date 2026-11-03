// The exact prompt production would send for a gold record: built by the real coachChat() with a context from archetypes.mjs.
import { coachChat } from '../../src/train/gemini.js';
import { BODY_PARTS } from '../../src/train/body.js';
import { makeContext, TODAY } from './archetypes.mjs';

export function contextFor(rec) {
  return makeContext(rec.athlete, rec.patch || {});
}

// { system, prompt, schema } for any model under test.
export function promptFor(rec) {
  return coachChat(rec.history, contextFor(rec), TODAY, BODY_PARTS);
}
