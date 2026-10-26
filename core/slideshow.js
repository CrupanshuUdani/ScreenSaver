import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import { ScalingMode } from '../enums.js';

function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Native slideshow: one St.Widget layer per monitor, cross-faded between images.
export class Slideshow {
    constructor({ imagePaths, photoDuration, loop, scalingMode, fadeDuration }) {
        this._photoDuration = photoDuration;
        this._loop = loop;
        this._scalingMode = scalingMode;
        this._fadeDuration = fadeDuration;

        this._order = imagePaths.length > 1 ? shuffle(imagePaths) : [...imagePaths];
        this._index = 0;
        this._views = [];
        this._timeoutId = 0;
        this._playing = false;
    }

    get currentPath() {
        return this._order[this._index];
    }

    createView(width, height) {
        const view = new St.Widget({
            width,
            height,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });
        view._size = [width, height];
        view._layer = null;
        this._views.push(view);
        this._setImage(view, this.currentPath, false);
        return view;
    }

    _style(path, width, height) {
        let size;
        switch (this._scalingMode) {
        case ScalingMode.STRETCH:
            size = `${width}px ${height}px`;
            break;
        case ScalingMode.FIT:
            size = 'contain';
            break;
        default:
            size = 'cover';
        }

        const uri = GLib.filename_to_uri(path, null);
        return `background-image: url("${uri}"); background-size: ${size}; ` +
            'background-position: center; background-repeat: no-repeat;';
    }

    _setImage(view, path, animate) {
        const [width, height] = view._size;
        const layer = new St.Widget({
            x_expand: true,
            y_expand: true,
            style: this._style(path, width, height),
        });
        const old = view._layer;
        view._layer = layer;
        view.add_child(layer);

        if (!old)
            return;

        if (!animate || this._fadeDuration <= 0) {
            old.destroy();
            return;
        }

        layer.opacity = 0;
        layer.ease({
            opacity: 255,
            duration: this._fadeDuration,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => old.destroy(),
        });
    }

    _next() {
        let next = this._index + 1;
        if (next >= this._order.length) {
            if (!this._loop) {
                this._timeoutId = 0;
                this._playing = false;
                return GLib.SOURCE_REMOVE;
            }
            next = 0;
            const last = this._order[this._order.length - 1];
            this._order = shuffle(this._order);
            if (this._order[0] === last)
                this._order.push(this._order.shift());
        }

        this._index = next;
        this._views.forEach(view => this._setImage(view, this.currentPath, true));
        return GLib.SOURCE_CONTINUE;
    }

    play() {
        if (this._playing || this._order.length < 2)
            return;
        this._playing = true;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._photoDuration, () => this._next());
    }

    pause() {
        this._playing = false;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    destroy() {
        this.pause();
        this._views = [];
    }
}
