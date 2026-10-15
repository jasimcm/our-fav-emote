import type { ClipName } from '../../shared/types';

/**
 * Three videos is all a Gemini Pro plan makes in a day, so each one packs several emotes.
 * They're made in ONE Gemini chat: the photo is attached once with the first prompt, and the
 * next prompts refer back to it ("same person as before"), which keeps the person consistent.
 * Every prompt asks for a return to the same relaxed pose between actions: that's where the
 * pipeline cuts (see findActions).
 */
export interface Recipe {
  id: 'hello' | 'water' | 'walk';
  title: string;
  /** Clips cut from this video, in the order the prompt asks for them. */
  makes: ClipName[];
  prompt: string;
}

const RULES =
  'Keep their face, hair and clothes exactly as in the photo, and keep the same plain single-colour background. ' +
  'Static camera, no zoom, no cuts, no talking, no music. The whole body from the top of the head to the shoes ' +
  'must stay in frame the entire time.';

export const RECIPES: Recipe[] = [
  {
    id: 'hello',
    title: 'Hello: idle, wave, laugh',
    makes: ['idle', 'wave', 'laugh'],
    prompt:
      `I'm going to ask you for three short videos of the person in this photo, one at a time. ${RULES} ` +
      'Video 1, front view: they stand relaxed and still with arms at their sides for one second. ' +
      'Then they wave hello at the camera with a big friendly smile, and lower the hand back to their side. ' +
      'They stand still for a moment. Then they laugh heartily, shoulders shaking, hands at their sides. ' +
      'Finally they return to standing relaxed and still with arms at their sides for the last second.',
  },
  {
    id: 'water',
    title: 'Water: reminder, drinking',
    makes: ['water_ask', 'drink_water'],
    prompt:
      `Video 2: the same person from the photo, same clothes, same background and the same framing as video 1. ${RULES} ` +
      'Front view, now holding a clear plastic water bottle in one hand at their side. They stand still for half a second. ' +
      'Then they raise the bottle toward the camera and point at it with the other hand, smiling, as if saying ' +
      '"drink some water!". They lower the bottle back to their side and pause for a moment. ' +
      'Then they lift the bottle to their mouth, take a sip, smile, and lower it back to their side. ' +
      'They stand still for the last second.',
  },
  {
    id: 'walk',
    title: 'Walk',
    makes: ['walk_right'], // or walk_left: the facing is detected from the feet
    prompt:
      `Video 3: the same person from the photo, same clothes, same background and the same size in the frame as before. ${RULES} ` +
      'Seen exactly from the side, they face the right edge of the frame and walk forward naturally in place, ' +
      'as if on a treadmill, at a relaxed pace with arms swinging. They stay in the centre of the frame and keep walking ' +
      'until the end of the video. Their feet move the way they are facing: no walking backwards.',
  },
];
