import type { ClipName } from '../../shared/types';

/**
 * Three videos is all a Gemini Pro plan makes in a day, so each one packs several emotes.
 * Every prompt asks for a return to the same relaxed pose between actions: that's where
 * the pipeline cuts (see findActions).
 */
export interface Recipe {
  id: 'hello' | 'water' | 'walk';
  title: string;
  /** Clips cut from this video, in the order the prompt asks for them. */
  makes: ClipName[];
  prompt: string;
}

const KEEP =
  'Keep the face, hair, clothes and the plain single-colour background exactly as in the image. ' +
  'Static camera, no zoom, no cuts. The whole body from the top of the head to the shoes stays in frame the entire time. No talking.';

export const RECIPES: Recipe[] = [
  {
    id: 'hello',
    title: 'Hello: idle, wave, laugh',
    makes: ['idle', 'wave', 'laugh'],
    prompt:
      `Animate the person in this image, front view. ${KEEP} ` +
      'First they stand relaxed and still with arms at their sides for one second. ' +
      'Then they wave hello at the camera with a big friendly smile, and lower the hand back to their side. ' +
      'They stand still for a moment. Then they laugh heartily, shoulders shaking, hands at their sides. ' +
      'Finally they return to standing relaxed and still with arms at their sides for the last second.',
  },
  {
    id: 'water',
    title: 'Water: reminder, drinking',
    makes: ['water_ask', 'drink_water'],
    prompt:
      `Animate the person in this image, front view, now holding a clear plastic water bottle in one hand at their side. ${KEEP} ` +
      'First they stand still for half a second. Then they raise the bottle toward the camera and point at it with the other hand, ' +
      "smiling, as if saying \"drink some water!\". They lower the bottle back to their side and pause for a moment. " +
      'Then they lift the bottle to their mouth, take a sip, smile, and lower it back to their side. ' +
      'They stand still for the last second.',
  },
  {
    id: 'walk',
    title: 'Walk',
    makes: ['walk_right'],
    prompt:
      `Animate the person in this image. ${KEEP} ` +
      'They turn to face the right side of the frame and walk naturally in place, as if on a treadmill, ' +
      'at a relaxed pace with arms swinging, seen exactly from the side. They stay in the centre of the frame the whole time ' +
      'and keep walking until the end of the video.',
  },
];
