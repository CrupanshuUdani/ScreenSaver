import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

import { Extension, InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Keys } from './enums.js';
import { Slideshow } from './core/slideshow.js';
import { UnblankManager } from './unblank.js';

import { isOnBattery } from './utils/battery.js';
import { logInfo, logWarn, logError } from './utils/logging.js';
import { sleep, destroySleeps } from './utils/base.js';

const MAX_DIALOG_INJECT_ATTEMPTS = 100;
const DIALOG_INJECT_INTERVAL = 100;
const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'];

export default class ScreenSaverExtension extends Extension {
    _backgroundCreated = false;
    _wrapperActors = [];
    _promptShown = false;
    _injectionManager = null;
    _player = null;
    _injectRetryId = 0;
    _blurEffectTimeoutId = 0;
    _loginManager = null;
    _settings = null;

    enable() {
        this._resetLockState();
        this._settings = this.getSettings();
        this._unblankManager = new UnblankManager(this);

        this._setupLock().catch(err => {
            logError(err);
            this.disable();
        });
    }

    _resetLockState() {
        this._backgroundCreated = false;
        this._wrapperActors = [];

        this._promptShown = false;
        this._injectionManager = null;
        this._player = null;
        this._injectRetryId = 0;
        this._injectAttempts = 0;
        this._blurEffectTimeoutId = 0;
        this._unblankManager = null;
    }

    async _setupLock() {
        const sourcePath = this._settings.get_string(Keys.IMAGE_PATH);
        if (!sourcePath) {
            logWarn('Image folder not set, falling back');
            return;
        }

        const imagePaths = this._resolveImagePaths(sourcePath);
        if (imagePaths.length === 0) {
            logWarn(`No supported images found in selected path: ${sourcePath}`);
            return;
        }

        const disableOnBattery = this._settings.get_boolean(Keys.DISABLE_ON_BATTERY);
        if (disableOnBattery && await isOnBattery()) {
            logWarn('Skipping on battery');
            return;
        }

        const loop = this._settings.get_boolean(Keys.LOOPED);
        const photoDuration = this._settings.get_int(Keys.PHOTO_DURATION);

        this._player = new Slideshow({
            imagePaths,
            photoDuration,
            loop,
            scalingMode: this._settings.get_int(Keys.SCALING_MODE),
            fadeDuration: this._settings.get_int(Keys.FADE_IN_DURATION),
        });

        logInfo(`Loaded ${imagePaths.length} image${imagePaths.length === 1 ? '' : 's'} from ${sourcePath}`);

        await this._onPlayerInit();
    }

    _resolveImagePaths(path) {
        const file = Gio.File.new_for_path(path);
        let type;

        try {
            type = file.query_file_type(Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            logWarn(`Failed to inspect selected path "${path}": ${e}`);
            return [];
        }

        if (type === Gio.FileType.DIRECTORY)
            return this._findImagesInDirectory(file);

        if (type === Gio.FileType.REGULAR && this._isSupportedImageFile(path))
            return [path];

        return [];
    }

    _findImagesInDirectory(rootDir) {
        const results = [];
        const stack = [rootDir];

        while (stack.length > 0) {
            const dir = stack.pop();
            let enumerator = null;

            try {
                enumerator = dir.enumerate_children(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    null
                );
            } catch (e) {
                logWarn(`Unable to read directory "${dir.get_path()}": ${e}`);
                continue;
            }

            const subDirs = [];

            try {
                let info = null;
                while ((info = enumerator.next_file(null)) !== null) {
                    const type = info.get_file_type();
                    const child = enumerator.get_child(info);

                    if (type === Gio.FileType.DIRECTORY) {
                        subDirs.push(child);
                        continue;
                    }

                    if (type !== Gio.FileType.REGULAR)
                        continue;

                    const childPath = child.get_path();
                    if (childPath && this._isSupportedImageFile(childPath))
                        results.push(childPath);
                }
            } finally {
                try {
                    enumerator.close(null);
                } catch (_) {
                }
            }

            subDirs.sort((a, b) => (a.get_basename() ?? '').localeCompare(b.get_basename() ?? ''));
            for (let i = subDirs.length - 1; i >= 0; i--)
                stack.push(subDirs[i]);
        }

        results.sort((a, b) => a.localeCompare(b));
        return results;
    }

    _isSupportedImageFile(path) {
        const ext = path.split('.').pop()?.toLowerCase();
        return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
    }

    async _onPlayerInit() {
        this._fadeInDuration = this._settings.get_int(Keys.FADE_IN_DURATION);
        this._blurRadius = this._settings.get_int(Keys.BLUR_RADIUS);
        this._blurBrightness = this._settings.get_double(Keys.BLUR_BRIGHTNESS);

        this._promptSettings = {
            [Keys.PROMPT_GRAYSCALE]: this._settings.get_boolean(Keys.PROMPT_GRAYSCALE),
            [Keys.PROMPT_CHANGE_BLUR]: this._settings.get_boolean(Keys.PROMPT_CHANGE_BLUR),
            [Keys.PROMPT_BLUR_RADIUS]: this._settings.get_int(Keys.PROMPT_BLUR_RADIUS),
            [Keys.PROMPT_BLUR_ANIM_DURATION]: this._settings.get_int(Keys.PROMPT_BLUR_ANIM_DURATION),
            [Keys.PROMPT_BLUR_BRIGHTNESS]: this._settings.get_double(Keys.PROMPT_BLUR_BRIGHTNESS),
        };

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._blurRadius *= themeContext.scale_factor;

        this._blurEffect = {
            name: 'lockscreen-extension-blur',
            radius: this._blurRadius,
            brightness: this._blurBrightness,
        };

        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(
            Main.wm,
            '_shouldAnimateActor',
            original => {
                return function(actor, types) {
                    return false;
                };
            }
        );

        await this._injectIntoDialog();
    }

    async _waitForFullLoad() {
        while (true) {
            const dialog = Main.screenShield?._dialog;
            const ready = !!dialog && !!this._player;
            if (ready)
                return dialog;

            if (!this._player)
                return null;

            if (this._injectAttempts >= MAX_DIALOG_INJECT_ATTEMPTS)
                throw new Error(`_dialog never appeared after ${MAX_DIALOG_INJECT_ATTEMPTS} attempts`);

            this._injectAttempts++;
            await sleep(DIALOG_INJECT_INTERVAL);
        }
    }

    async _injectIntoDialog() {
        const dialog = await this._waitForFullLoad();
        if (!dialog) {
            logWarn('Lock screen dialog is not available; skipping injection');
            return;
        }

        this._injectionManager.overrideMethod(dialog, '_createBackground', original => {
            const self = this;
            return function(monitorIndex) {
                original.call(this, monitorIndex);
                self._handleMonitor(monitorIndex);
            };
        });
        this._injectionManager.overrideMethod(dialog, '_showPrompt', original => {
            const self = this;
            return function(...args) {
                original.call(this, ...args);
                self._onPromptShow();
            };
        });
        this._injectionManager.overrideMethod(dialog, '_showClock', original => {
            const self = this;
            return function(...args) {
                original.call(this, ...args);
                self._onPromptHide();
            };
        });

        const swipeTracker = dialog._swipeTracker;
        if (swipeTracker) {
            const gtype = swipeTracker.constructor?.$gtype;
            if (gtype) {
                if (!dialog._screenSaverSwipeConnected) {
                    swipeTracker.connectObject('end', (...args) => {
                        dialog._swipeEnd(...args);
                        if (dialog._activePage === dialog._clock)
                            this._onPromptHide();
                        else
                            this._onPromptShow();
                    }, this);
                    dialog._screenSaverSwipeConnected = true;
                }
            } else {
                logWarn('Lock screen swipe tracker is missing GType; continuing without swipe hook');
            }
        } else {
            logWarn('Lock screen swipe tracker is not ready yet; continuing without swipe hook');
        }

        dialog._updateBackgrounds();

        if (!this._backgroundCreated && dialog._backgroundGroup && dialog._backgroundGroup.get_n_children() === 0) {
            for (let i = 0; i < Main.layoutManager.monitors.length; i++)
                this._handleMonitor(i);
        }
    }

    _onPromptShow() {
        if (this._promptShown)
            return;
        this._promptShown = true;

        if (this._promptSettings[Keys.PROMPT_CHANGE_BLUR]) {
            const radius = this._promptSettings[Keys.PROMPT_BLUR_RADIUS];
            const brightness = radius ? this._promptSettings[Keys.PROMPT_BLUR_BRIGHTNESS] : 1;

            if (this._blurEffectTimeoutId) {
                GLib.source_remove(this._blurEffectTimeoutId);
                this._blurEffectTimeoutId = 0;
            }

            this._blurEffectTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                this._wrapperActors.forEach(actor => {
                    actor.ease_property('@effects.lockscreen-extension-blur.radius', radius, {
                        duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                    actor.ease_property('@effects.lockscreen-extension-blur.brightness', brightness, {
                        duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                });

                this._blurEffectTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        if (this._promptSettings[Keys.PROMPT_GRAYSCALE]) {
            this._wrapperActors.forEach(actor => {
                actor.ease_property('@effects.lockscreen-extension-desaturate.factor', 1.0, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
        }

    }

    _onPromptHide() {
        if (!this._promptShown)
            return;
        this._promptShown = false;

        if (this._promptSettings[Keys.PROMPT_CHANGE_BLUR]) {
            const radius = this._blurRadius;
            const brightness = radius ? this._blurBrightness : 1;

            this._wrapperActors.forEach(actor => {
                actor.ease_property('@effects.lockscreen-extension-blur.radius', radius, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                actor.ease_property('@effects.lockscreen-extension-blur.brightness', brightness, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
        }

        if (this._promptSettings[Keys.PROMPT_GRAYSCALE]) {
            this._wrapperActors.forEach(actor => {
                actor.ease_property('@effects.lockscreen-extension-desaturate.factor', 0.0, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
        }

    }

    _handleMonitor(monitorIndex) {
        if (!Main.screenShield?._dialog)
            return;

        const isLastMonitor = monitorIndex === Main.layoutManager.monitors.length - 1;
        const monitor = Main.layoutManager.monitors[monitorIndex];
        const wrapper = new Clutter.Actor();

        if (monitorIndex === 0)
            this._wrapperActors = [];

        Main.screenShield._dialog._backgroundGroup.add_child(wrapper);
        Main.screenShield._dialog._backgroundGroup.set_child_above_sibling(wrapper, null);

        const view = this._player.createView(monitor.width, monitor.height);

        wrapper.add_effect(new Shell.BlurEffect(this._blurEffect));

        if (this._promptSettings[Keys.PROMPT_GRAYSCALE]) {
            wrapper.add_effect_with_name(
                'lockscreen-extension-desaturate',
                new Clutter.DesaturateEffect({ factor: 0.0 })
            );
        }

        if (!this._backgroundCreated)
            wrapper.opacity = 0;

        wrapper.add_child(view);
        this._wrapperActors.push(wrapper);

        wrapper.set_position(monitor.x, monitor.y);
        wrapper.set_size(monitor.width, monitor.height);
        wrapper.set_clip_to_allocation(true);

        if (!this._backgroundCreated && isLastMonitor) {
            this._initLoginManager();
            this._startAnimation();
            this._player.play();

            this._backgroundCreated = true;
        }
    }

    _startAnimation() {
        this._wrapperActors.forEach(actor => actor.ease({
            opacity: 255,
            duration: this._fadeInDuration,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        }));
    }

    _initLoginManager() {
        this._loginManager = LoginManager.getLoginManager();
        this._loginManager.connectObject('prepare-for-sleep', (_manager, aboutToSleep) => {
            if (!this._player)
                return;
            aboutToSleep ? this._player.pause() : this._player.play();
        }, this);
    }

    disable() {
        // This extension needs unlock-dialog mode so it can keep controlling the
        // lock screen background and prompt transitions while the session is locked.
        destroySleeps();

        if (this._injectRetryId) {
            GLib.source_remove(this._injectRetryId);
            this._injectRetryId = 0;
        }
        if (this._blurEffectTimeoutId) {
            GLib.source_remove(this._blurEffectTimeoutId);
            this._blurEffectTimeoutId = 0;
        }
        this._injectAttempts = 0;

        Main.screenShield?._dialog?._swipeTracker?.disconnectObject(this);

        this._player?.destroy();
        this._player = null;

        this._injectionManager?.clear();
        this._injectionManager = null;

        this._unblankManager?.destroy();
        this._unblankManager = null;

        this._loginManager?.disconnectObject(this);

        Object.values(this._wrapperActors).forEach(actor => {
            const parent = actor.get_parent();
            if (parent)
                parent.remove_child(actor);
            actor.disconnectObject(this);
            actor.remove_effect_by_name('lockscreen-extension-blur');
            actor.remove_effect_by_name('lockscreen-extension-desaturate');
            actor.destroy();
        });
        this._wrapperActors = [];
        this._settings = null;
    }
}
