import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import System from 'system';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import { ScalingMode } from '../enums.js';
import { logWarn } from '../utils/logging.js';

const SHELL_MAJOR = parseInt(Config.PACKAGE_VERSION.split('.')[0], 10);

function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getCoglContext() {
    const context = global.stage.context ?? global.stage.get_context?.();
    const backend = context?.get_backend?.() ?? Clutter.get_default_backend?.();
    return backend.get_cogl_context();
}

function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// Reads only the image header, in a worker thread.
function queryImageSize(path, cancellable) {
    return new Promise((resolve, reject) => {
        GdkPixbuf.Pixbuf.get_file_info_async(path, cancellable, (_source, result) => {
            try {
                const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info_finish(result);
                if (!format || width <= 0 || height <= 0)
                    throw new Error('unrecognized image format');
                resolve([width, height]);
            } catch (e) {
                reject(e);
            }
        });
    });
}

function openStream(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            try {
                resolve(source.read_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function closeStreamAsync(stream) {
    if (!stream || stream.is_closed())
        return Promise.resolve();
    return new Promise(resolve => {
        stream.close_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
            try {
                source.close_finish(res);
            } catch (_) {
            }
            resolve();
        });
    });
}

// Decodes (and downscales while decoding) in a worker thread.
function decodeStream(stream, width, height, cancellable) {
    return new Promise((resolve, reject) => {
        // Dimensions are pre-computed with the right aspect ratio, so we don't
        // let GdkPixbuf recompute (and truncate) them.
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
            stream, width, height, false, cancellable,
            (_source, result) => {
                try {
                    resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

// Crops the centre of the pixbuf to the target aspect ratio (for "cover").
function cropToAspect(pixbuf, targetWidth, targetHeight) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const targetAspect = targetWidth / targetHeight;

    let cropWidth = width;
    let cropHeight = height;
    if (width / height > targetAspect)
        cropWidth = Math.max(1, Math.round(height * targetAspect));
    else
        cropHeight = Math.max(1, Math.round(width / targetAspect));

    if (cropWidth === width && cropHeight === height)
        return pixbuf;

    return pixbuf.new_subpixbuf(
        Math.floor((width - cropWidth) / 2),
        Math.floor((height - cropHeight) / 2),
        cropWidth,
        cropHeight);
}

function createContent(pixbuf) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const rowstride = pixbuf.get_rowstride();
    const format = pixbuf.get_has_alpha()
        ? Cogl.PixelFormat.RGBA_8888
        : Cogl.PixelFormat.RGB_888;
    const bytes = pixbuf.read_pixel_bytes();

    const content = St.ImageContent.new_with_preferred_size(width, height);
    // GNOME 48 added a CoglContext parameter to set_bytes().
    if (SHELL_MAJOR >= 48)
        content.set_bytes(getCoglContext(), bytes, format, width, height, rowstride);
    else
        content.set_bytes(bytes, format, width, height, rowstride);
    return content;
}

// Native slideshow: one St.Widget layer per monitor, cross-faded between images.
//
// Images are decoded asynchronously at (at most) monitor resolution and
// uploaded into an St.ImageContent owned by the layer. We deliberately avoid
// CSS `background-image`: St caches every texture loaded that way (and the
// theme node for every unique style string) for the lifetime of gnome-shell,
// so rotating through a large folder made memory grow without bound.
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
        this._cancellable = new Gio.Cancellable();
        this._pendingLoads = new Map();
    }

    get currentPath() {
        return this._order[this._index];
    }

    createView(width, height, scale = 1) {
        const view = new St.Widget({
            width,
            height,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });
        view._size = [width, height];
        view._pixelSize = [
            Math.max(1, Math.ceil(width * scale)),
            Math.max(1, Math.ceil(height * scale)),
        ];
        view._layer = null;
        view._loadSerial = 0;
        view._loadCancellable = null;

        // The lock screen may rebuild its backgrounds (e.g. on monitor
        // changes); forget destroyed views so we neither leak nor touch them.
        view.connect('destroy', () => {
            view._loadSerial++;
            view._loadCancellable?.cancel();
            view._loadCancellable = null;
            view._layer = null;
            this._views = this._views.filter(v => v !== view);
        });

        this._views.push(view);
        this._setImage(view, this.currentPath, false);
        return view;
    }

    _isFillMode() {
        return this._scalingMode !== ScalingMode.STRETCH &&
            this._scalingMode !== ScalingMode.FIT;
    }

    // Size to decode at: never larger than the source or than what the
    // monitor needs. Any upscaling is left to the GPU via content gravity.
    _decodeSize(imageWidth, imageHeight, targetWidth, targetHeight) {
        if (this._scalingMode === ScalingMode.STRETCH) {
            return [
                Math.min(imageWidth, targetWidth),
                Math.min(imageHeight, targetHeight),
            ];
        }

        // For cover mode, also account for potential EXIF orientation swaps
        // (portrait camera photos with orientation 5-8 stored as landscape),
        // so the downscaled image has enough pixels to fill the target without
        // blur after rotation.
        const ratio = this._scalingMode === ScalingMode.FIT
            ? Math.min(targetWidth / imageWidth, targetHeight / imageHeight)
            : Math.max(
                targetWidth / imageWidth,
                targetHeight / imageHeight,
                Math.max(targetWidth, targetHeight) / Math.min(imageWidth, imageHeight)
            );
        const scale = Math.min(1, ratio);

        return [
            Math.max(1, Math.round(imageWidth * scale)),
            Math.max(1, Math.round(imageHeight * scale)),
        ];
    }

    async _decode(path, targetWidth, targetHeight, cancellable) {
        const [imageWidth, imageHeight] = await queryImageSize(path, cancellable);
        const [width, height] =
            this._decodeSize(imageWidth, imageHeight, targetWidth, targetHeight);

        const stream = await openStream(Gio.File.new_for_path(path), cancellable);
        let pixbuf;
        try {
            pixbuf = await decodeStream(stream, width, height, cancellable);
        } finally {
            await closeStreamAsync(stream);
        }

        pixbuf = pixbuf.apply_embedded_orientation() ?? pixbuf;
        if (this._isFillMode())
            pixbuf = cropToAspect(pixbuf, targetWidth, targetHeight);

        return createContent(pixbuf);
    }

    // Monitors sharing the same pixel size share a single decode/texture.
    // If all views waiting on a pending decode cancel or advance, the decode
    // is cancelled immediately to prevent pile-up.
    _loadContent(path, [width, height], cancellable) {
        const key = `${width}x${height}:${path}`;
        let item = this._pendingLoads.get(key);
        if (!item) {
            const loadCancellable = new Gio.Cancellable();
            const cancelId = this._cancellable.connect(() => loadCancellable.cancel());
            const promise = this._decode(path, width, height, loadCancellable)
                .finally(() => {
                    this._cancellable.disconnect(cancelId);
                    this._pendingLoads.delete(key);
                });
            item = { promise, cancellable: loadCancellable, refCount: 0 };
            this._pendingLoads.set(key, item);
        }

        item.refCount++;
        if (cancellable) {
            cancellable.connect(() => {
                item.refCount--;
                if (item.refCount <= 0)
                    item.cancellable.cancel();
            });
        }
        return item.promise;
    }

    _setImage(view, path, animate) {
        const serial = ++view._loadSerial;

        // Cancel any pending decode specific to this view before starting the next
        view._loadCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        view._loadCancellable = cancellable;

        this._loadContent(path, view._pixelSize, cancellable).then(content => {
            if (serial !== view._loadSerial || cancellable.is_cancelled() || this._cancellable.is_cancelled())
                return;
            this._showContent(view, content, animate);
        }).catch(e => {
            if (!isCancelled(e))
                logWarn(`Failed to load image "${path}": ${e.message ?? e}`);
        });
    }

    _showContent(view, content, animate) {
        const layer = new St.Widget({
            x_expand: true,
            y_expand: true,
            content,
            content_gravity: this._scalingMode === ScalingMode.FIT
                ? Clutter.ContentGravity.RESIZE_ASPECT
                : Clutter.ContentGravity.RESIZE_FILL,
        });
        const old = view._layer;
        view._layer = layer;
        view.add_child(layer);

        if (!old)
            return;

        let destroyed = false;
        const destroyOld = () => {
            if (destroyed)
                return;
            destroyed = true;
            if (old.get_parent?.())
                old.destroy();

            // Prompt GJS / SpiderMonkey to collect the dead JS wrappers for
            // unreferenced StImageContent and Cogl textures promptly, avoiding
            // deferral based on JS heap size alone.
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                System.gc();
                return GLib.SOURCE_REMOVE;
            });
        };

        if (!animate || this._fadeDuration <= 0) {
            destroyOld();
            return;
        }

        layer.opacity = 0;
        layer.ease({
            opacity: 255,
            duration: this._fadeDuration,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: destroyOld,
            onStopped: destroyOld,
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
        this._cancellable.cancel();
        this._views.forEach(v => {
            v._loadCancellable?.cancel();
            v._loadCancellable = null;
        });
        this._pendingLoads.clear();
        this._views = [];
        System.gc();
    }
}
