import GObject from 'gi://GObject';

const _timeoutIds = new Set();

export function sleep(ms) {
    return new Promise(resolve => {
        const id = setTimeout(() => {
            _timeoutIds.delete(id);
            resolve();
        }, ms);
        _timeoutIds.add(id);
    });
}

/**
 * NOTE: Must be called in disable()
 */
export function destroySleeps() {
    for (const id of _timeoutIds) {
        clearTimeout(id);
    }
    _timeoutIds.clear();
}

/**
 * Modulo that is never negative, unlike % for negative n
 */
export function amod(n, m) {
    return ((n % m) + m) % m;
}

/**
 * Deterministic PRNG: the same seed and n always give the same result
 * Sadly JS doesnt have its own seed based RNG so using this :)
 * @param {number} seed - 32-bit integer
 * @param {number} n - Any integer
 * @returns {number} Number in [0, 1)
 */
export function hash01(seed, n) {
    // murmur3 finalizer
    let h = Math.imul(seed ^ n, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/**
 * Shuffles the array in place (Fisher-Yates)
 * @param {Array} array
 * @returns {Array} The same array
 */
export function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export function toDouble(n) {
    const v = new GObject.Value();
    v.init(GObject.TYPE_DOUBLE);
    v.set_double(n);
    return v;
};