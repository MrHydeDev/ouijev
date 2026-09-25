// Seance state: where the planchette is heading, which letter is lit and what has been spelled so far.
// It doesn't touch the DOM or the canvas, so it can be tested in Node.

/** How long the planchette stays on each letter before moving to the next. */
export const HOLD_MS = 520;
/** Duration of one frame at 60 Hz: the planchette speeds are tuned for it. */
export const FRAME_MS = 1000 / 60;
/** How far the planchette moves away before returning to a repeated letter. */
const REPEAT_DETOUR = { x: 7, y: 14 };
/** Its speed, in board pixels per frame: a fraction of the distance left, between a crawl and a dash. */
const SPEED = { share: 0.08, min: 0.5, max: 4 };
/** Closer than this, in board pixels, it has arrived. */
const ARRIVED = 0.7;
/** How fast the presence follows the seance starting or ending, per frame. */
const PRESENCE_RATE = 0.04;

/**
 * A place on the board the planchette can point at (with `text`, one of the board's letters or words).
 *
 * @typedef {{ x: number, y: number, text?: string, font?: string, spacing?: number }} Spot
 */

export class Seance {
  #spots;
  #wordSpots;
  #rest;
  #onFinish;
  #motion;

  #position;
  #queue = [];
  #step = null;
  #holdUntil = 0;
  #lit = null;
  #lastSpot = null;
  #spelled = "";
  #active = false;
  #streaming = false;
  #heard = false;
  #presence = 0;

  /**
   * @param {object} options
   * @param {Record<string, Spot>} options.spots spot for each letter and digit
   * @param {Record<string, Spot>} options.wordSpots spots for YES, NO and GOODBYE
   * @param {Spot} options.rest where the planchette rests
   * @param {() => void} [options.onFinish] called when the planchette finishes pointing out the answer
   * @param {{ reduced: boolean }} [options.motion] with reduced motion, the planchette neither wanders nor sways
   */
  constructor({ spots, wordSpots, rest, onFinish = () => {}, motion = { reduced: false } }) {
    this.#spots = spots;
    this.#wordSpots = wordSpots;
    this.#rest = rest;
    this.#onFinish = onFinish;
    this.#motion = motion;
    this.#position = { x: rest.x, y: rest.y };
  }

  /** Starts a new question. */
  begin() {
    this.#queue = [];
    this.#step = null;
    this.#lit = null;
    this.#lastSpot = null;
    this.#spelled = "";
    this.#active = true;
    this.#streaming = true;
    this.#heard = false;
  }

  /**
   * Queues the moves for a server event.
   *
   * @param {import("./api.js").SeanceEvent} event
   */
  receive(event) {
    if (!this.#active) return;
    if (event.type === "word") {
      const spot = this.#wordSpots[event.word];
      if (spot) this.#moveTo(spot, event.word);
    } else if (event.type === "letters") {
      for (const ch of event.text) {
        const spot = ch === " " ? this.#rest : this.#spots[ch];
        if (spot) this.#moveTo(spot, ch);
      }
    }
    this.#heard = true;
  }

  /** The server won't send anything else (it has finished or failed): the seance ends once the queue is empty. */
  close() {
    this.#streaming = false;
  }

  /**
   * Advances the animation.
   *
   * @param {number} now timestamp in milliseconds
   * @param {number} dt milliseconds since the previous update
   */
  update(now, dt) {
    const k = dt / FRAME_MS;
    if (!this.#step && now >= this.#holdUntil) {
      this.#step = this.#queue.shift() ?? null;
      if (!this.#step && this.#active && !this.#streaming) this.#finish();
    }

    const target = this.#target(now);
    const dx = target.x - this.#position.x;
    const dy = target.y - this.#position.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.01) {
      // Starts fast and slows down on arrival, like a hesitant hand
      const speed = Math.min(distance, Math.max(SPEED.min, Math.min(SPEED.max, distance * SPEED.share)) * k);
      this.#position.x += (dx / distance) * speed;
      this.#position.y += (dy / distance) * speed;
    }

    if (this.#step && distance < ARRIVED) {
      if (this.#step.label) {
        this.#spelled += this.#step.label;
        this.#holdUntil = now + HOLD_MS;
        this.#lit = this.#step.spot.text ? this.#step.spot : null;
      }
      this.#step = null;
    }
    if (this.#lit && now >= this.#holdUntil) this.#lit = null;

    this.#presence += ((this.#active ? 1 : 0) - this.#presence) * Math.min(1, PRESENCE_RATE * k);
  }

  /** Planchette position (the center of the viewing window). */
  get position() {
    return this.#position;
  }

  /** Spot it is pointing at right now, or `null`. */
  get lit() {
    return this.#lit;
  }

  /** What has been spelled so far. */
  get spelled() {
    return this.#spelled;
  }

  get active() {
    return this.#active;
  }

  /** 0 = calm seance, 1 = the spirit is present. Changes smoothly. */
  get presence() {
    return this.#presence;
  }

  /** The planchette trembles while it moves or while letters are still to come. */
  get trembling() {
    return this.#step !== null || (this.#active && this.#heard);
  }

  #target(now) {
    if (this.#step) return this.#step;
    const rest = this.#rest;
    const still = this.#motion.reduced;
    // Waiting for the first letter: the planchette rises a little and wanders restlessly in circles
    if (this.#active && !this.#heard) {
      if (still) return { x: rest.x, y: rest.y - 30 };
      return { x: rest.x + Math.cos(now / 300) * 20, y: rest.y - 30 + Math.sin(now / 300) * 10 };
    }
    // At rest, a barely perceptible sway
    if (!this.#active) {
      if (still) return rest;
      return { x: rest.x + Math.sin(now / 900) * 2, y: rest.y + Math.cos(now / 1300) * 1.5 };
    }
    return this.#position;
  }

  #moveTo(spot, label) {
    // Repeated letter: the planchette moves away and comes back so the repeat is noticeable
    if (this.#lastSpot === spot) this.#queue.push({ x: spot.x + REPEAT_DETOUR.x, y: spot.y + REPEAT_DETOUR.y });
    this.#queue.push({ x: spot.x, y: spot.y, label, spot });
    this.#lastSpot = spot;
  }

  #finish() {
    this.#active = false;
    this.#onFinish();
  }
}
