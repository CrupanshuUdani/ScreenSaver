import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Direction, Keys, ActionOnBlank, ActionOnEnd } from './enums.js';
import { MpvPlayerProcess } from './core/mpv_player_process.js';
import { GstPlayerProcess } from './core/gst_player_process.js';

import { applyScaling } from './utils/actors.js';
import { isOnBattery } from './utils/battery.js';
import { resolveMediaPaths } from './utils/media_files.js';
import { SHELL_VERSION } from './utils/shell_version.js';
import { logInfo, logWarn, logError } from './utils/logging.js';
import { sleep, destroySleeps } from './utils/base.js';
import { getPowerSaveMode } from './utils/dbus.js';
import { isGtk4PaintableSinkAvailable, isMpvAvailable } from './utils/check_dependencies.js';
import { sendErrorNotification } from './utils/notifications.js';

import { ActorAnimator } from './helpers/actor_animator.js';

const MAX_DIALOG_INJECT_ATTEMPTS = 100;
const DIALOG_INJECT_INTERVAL = 100;
const WINDOW_TIMEOUT = 10000;

export default class LockscreenExtension extends Extension {
    enable() {
        this._resetLockState();
        this._settings = this.getSettings();

        //NOTE: Global error handler w/ cleanup
        this._setupLock().catch(err => {
            logError(err);
            this.disable();
        });
    }

    _resetLockState() {
        this._fadeAnim = null;
        this._grayscaleAnim = null;
        this._blurRadiusAnim = null;
        this._blurBrightnessAnim = null;

        this._backgroundCreated = false;

        this._wrapperActors = [];
        this._windowActor = null;
        this._window = null;
        
        this._promptShown = false;
        this._injectionManager = null;
        this._player = null;
        this._tapAction = null;

        this._injectRetryId = 0;
        this._injectAttempts = 0;
        this._dbusSubId = 0;
    }

    async _setupLock() {
        const videoPath = this._settings.get_string(Keys.VIDEO_PATH);
        if (!videoPath) {
            logWarn('Video not set, falling back');
            return;
        }
        
        const disableOnBatter = this._settings.get_boolean(Keys.DISABLE_ON_BATTERY);
        if (disableOnBatter && await isOnBattery()) {
            logWarn('Skipping on battery');
            return;
        }

        // The saved path can point to a single file or to a folder of videos
        const videoPaths = resolveMediaPaths(videoPath);
        if (videoPaths.length === 0) {
            sendErrorNotification(
                `No supported videos or GIFs found at "${videoPath}". ` +
                `Falling back to the default lock screen.`
            );
            logError(`Nothing to play at "${videoPath}"`);
            return;
        }

        const volume = this._settings.get_int(Keys.AUDIO_VOLUME) / 100;
        const actionOnEnd = this._settings.get_int(Keys.ACTION_ON_END);
        const useVideorate = this._settings.get_boolean(Keys.USE_VIDEORATE);
        const framerate = this._settings.get_int(Keys.FRAMERATE);
        const colorAccurate = this._settings.get_boolean(Keys.DEBUG_USE_COLOR_ACCURATE);

        const forceGst = this._settings.get_boolean(Keys.DEBUG_FORCE_GST);

        let cls = null;
        if (!forceGst && isMpvAvailable()) {
            logInfo('Using MPV as playback backend');
            cls = MpvPlayerProcess;
        }
        else if (isGtk4PaintableSinkAvailable()) {
            logInfo('Using GStreamer as playback backend');
            cls = GstPlayerProcess;
        }
        
        if (!cls)
        {
            sendErrorNotification(
                `No suitable backends available for playback! ` +
                `Install MPV (recommended) or GStreamer. ` +
                `More info in README.md.`
            )
            logError('No suitable backends available for playback');
            return;
        }

        this._player = new cls({
            playerPath: this.path + '/external/run.js',
            videoPaths,
            actionOnEnd,
            scalingMode: this._scalingMode,
            volume,
            useVideorate,
            framerate,
            colorAccurate: colorAccurate
        });

        await this._player.run();
        await this._onPlayerInit();
    }

    /**
     * TODO: This function is way too overloaded. Split into smaller
     */
    async _onPlayerInit() {
        this._actionOnBlank = this._settings.get_int(Keys.ACTION_ON_BLANK);
        this._fadeInDuration = this._settings.get_int(Keys.FADE_IN_DURATION);
        this._scalingMode = this._settings.get_int(Keys.SCALING_MODE);
        this._blurRadius = this._settings.get_int(Keys.BLUR_RADIUS);
        this._blurBrightness = this._settings.get_double(Keys.BLUR_BRIGHTNESS);
        this._forceFullscreen = this._settings.get_boolean(Keys.DEBUG_FORCE_FULLSCREEN);

        this._promptSettings = {
            [Keys.PROMPT_PAUSE]:              this._settings.get_boolean(Keys.PROMPT_PAUSE),
            [Keys.PROMPT_GRAYSCALE]:          this._settings.get_boolean(Keys.PROMPT_GRAYSCALE),
            [Keys.PROMPT_CHANGE_BLUR]:        this._settings.get_boolean(Keys.PROMPT_CHANGE_BLUR),
            [Keys.PROMPT_BLUR_RADIUS]:        this._settings.get_int(Keys.PROMPT_BLUR_RADIUS),
            [Keys.PROMPT_BLUR_ANIM_DURATION]: this._settings.get_int(Keys.PROMPT_BLUR_ANIM_DURATION),
            [Keys.PROMPT_BLUR_BRIGHTNESS]:    this._settings.get_double(Keys.PROMPT_BLUR_BRIGHTNESS),
        };

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._blurRadius  *= themeContext.scale_factor;
        this._blurEffect = {
            name: 'lockscreen-extension-blur',
            radius: this._blurRadius,
            brightness: this._blurBrightness,
        };

        this._initAnimators();

        this._injectionManager = new InjectionManager();

        const win = await this._player.waitForWindow(WINDOW_TIMEOUT); 
        this._window = win
        this._windowActor = win.get_compositor_private();

        this._window.connectObject('unmanaged', () => {
            this._resetWindowActor();
            this._window = null;
        }, this);
        this._windowActor?.connectObject('destroy', () => {
            this._windowActor = null;
        }, this);
        
        //NOTE: On gnome 48 and lower this functions accepts 1 argument
        if (SHELL_VERSION > 48)
            this._window.unmaximize()                
        else
            this._window.unmaximize(true)

        const parent = this._windowActor.get_parent();
        if (parent) parent.remove_child(this._windowActor);

        global.stage.add_child(this._windowActor);
        global.stage.set_child_below_sibling(this._windowActor, null);
        this._windowActor.opacity = 0;

        await this._injectIntoDialog();
    }

    _initAnimators() {
        const dstRadius = this._promptSettings[Keys.PROMPT_BLUR_RADIUS];
        const dstBrightness = dstRadius ? this._promptSettings[Keys.PROMPT_BLUR_BRIGHTNESS] : 1;

        const srcRadius = this._blurRadius;
        const srcBrightness = srcRadius ? this._blurBrightness : 1;

        if (this._fadeInDuration > 0)
            this._fadeAnim = new ActorAnimator({
                actors: [],
                property: 'opacity',
                from: 0,
                to: 255,
                duration: this._fadeInDuration
            });
        if (this._promptSettings[Keys.PROMPT_GRAYSCALE])
            this._grayscaleAnim = new ActorAnimator({
                actors: [],
                property: '@effects.lockscreen-extension-desaturate.factor',
                from: 0,
                to: 1,
                duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION]
            });
        if (this._promptSettings[Keys.PROMPT_CHANGE_BLUR]) {
            this._blurRadiusAnim = new ActorAnimator({
                actors: [],
                property: '@effects.lockscreen-extension-blur.radius',
                from: parseFloat(srcRadius),
                to: parseFloat(dstRadius),
                duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION]
            });
            this._blurBrightnessAnim = new ActorAnimator({
                actors: [],
                property: '@effects.lockscreen-extension-blur.brightness',
                from: parseFloat(srcBrightness),
                to: parseFloat(dstBrightness),
                duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION]
            });
        }
    }

    _resetWindowActor() {
        //NOTE: 
        // This function doesnt destroy the window actor
        // it just resets it to its initial state
        // and also hides it for convinience
        if (!this._windowActor) return;

        this._windowActor.disconnectObject(this);
        this._windowActor.hide();

        const parent = this._windowActor.get_parent();
        if (parent) parent.remove_child(this._windowActor);
        global.window_group.add_child(this._windowActor);
        this._windowActor = null;
    }

    async _waitForFullLoad() {
        while (!Main.screenShield._dialog || this._player.w === 0) {
            if (this._injectAttempts >= MAX_DIALOG_INJECT_ATTEMPTS) {
                throw new Error(
                    `_dialog never appeared after ${MAX_DIALOG_INJECT_ATTEMPTS} attempts`
                );
            }

            this._injectAttempts++;
            await sleep(DIALOG_INJECT_INTERVAL);
        }

        this._injectAttempts = 0;

        return Main.screenShield._dialog;
    }

    async _injectIntoDialog() {
        let dialog = await this._waitForFullLoad();

        this._injectionManager.overrideMethod(
            dialog, '_createBackground',
            (original) => {
                const self = this;
                return function(monitorIndex) {
                    original.call(this, monitorIndex);                    
                    self._handleMonitor(monitorIndex);
                };
            }
        );
        this._injectionManager.overrideMethod(
            dialog, '_showPrompt',
            (original) => {
                const self = this;
                return function(...args) {
                    original.call(this, ...args);
                    self._onPromptShow();
                };
            }
        );
        this._injectionManager.overrideMethod(
            dialog, '_showClock',
            (original) => {
                const self = this;
                return function(...args) {
                    original.call(this, ...args);
                    self._onPromptHide();
                };
            }
        );

        this._connectFingerprintAuth(dialog);
        
        // Removing the existing signal to use our custom one
        const gtype = dialog._swipeTracker.constructor.$gtype;
        const swipeSignalId = GObject.signal_lookup('end', gtype);
        dialog._swipeTracker.disconnect(swipeSignalId);

        dialog._swipeTracker.connectObject('end', (...args) => {
            dialog._swipeEnd(...args);
            if (dialog._activePage == dialog._clock)
                this._onPromptHide();
            else
                this._onPromptShow();
        }, this);

        //NOTE: Replacing TapAction with a fresh one if exists (for gnome 48 and older)
        if (SHELL_VERSION < 49) {
            const actions = dialog.get_actions();
            const tapAction = actions.find(a => {
                //HACK: Maybe not the most beautiful solution, but works
                return a.constructor.name.includes('TapAction')
            });
            if (tapAction) {
                dialog.remove_action(tapAction);
                
                let newAction = new Clutter.TapAction();
                newAction.connectObject('tap', dialog._showPrompt.bind(dialog), this);
                dialog.add_action(newAction);
            } 
        }

        dialog._updateBackgrounds();
    }

    _connectFingerprintAuth(dialog) {
        //NOTE: 
        // I'll be honest, I have no idea if this works or not
        // I dont have a fingerprint scanner to test
        // But it should :) 
        const authPrompt = dialog._authPrompt;
        if (!authPrompt) {
            logWarn('AuthPrompt not available, fingerprint detection skipped');
            return;
        }

        // When a fingerprint verification message is shown (e.g. "Place your finger")
        // treat it as a prompt being shown so blur/pause effects apply
        authPrompt.connectObject(
            'next', () => {
                this._onPromptShow();
            },
            this
        );
    }

    _onPromptShow() {
        if (this._promptShown) return;
        this._promptShown = true;

        //NOTE: Adding small delay to prevent stuttering of video
        this._blurRadiusAnim?.play(Direction.FORWARD, 5);
        this._blurBrightnessAnim?.play(Direction.FORWARD, 5);
        this._grayscaleAnim?.play(Direction.FORWARD);

        if (this._promptSettings[Keys.PROMPT_PAUSE])
            this._player?.pause();
    }

    _onPromptHide() {
        if (!this._promptShown) return;
        this._promptShown = false;

        //NOTE: Adding small delay to prevent stuttering of video
        this._blurRadiusAnim?.play(Direction.BACKWARD, 5);
        this._blurBrightnessAnim?.play(Direction.BACKWARD, 5);
        this._grayscaleAnim?.play(Direction.BACKWARD);

        this._resumePlayback();
    }

    _handleMonitor(monitorIndex) {
        if (!this._window || this._window.unmanaging || !this._windowActor)
            return;

        if (this._player?.shouldResize) {
            this._window.move_resize_frame(
                true, 0, 0, this._player.w, this._player.h
            );
        }

        const isLastMonitor = monitorIndex === Main.layoutManager.monitors.length - 1;
        const monitor = Main.layoutManager.monitors[monitorIndex];

        const wrapper = new Clutter.Actor();

        if (monitorIndex == 0) {
            this._wrapperActors = [];
        }

        Main.screenShield._dialog._backgroundGroup.add_child(wrapper);
        Main.screenShield._dialog._backgroundGroup.set_child_above_sibling(wrapper, null);

        const cloneActor = new Clutter.Clone({
            source: this._windowActor
        });

        this._blurEffect.radius = this._blurRadiusAnim?.get_value() || this._blurRadius;
        this._blurEffect.brightness = this._blurBrightnessAnim?.get_value() || this._blurBrightness;
        wrapper.add_effect(new Shell.BlurEffect(this._blurEffect));

        // Adding color desaturation effect if needed
        if (this._promptSettings[Keys.PROMPT_GRAYSCALE]) {
            wrapper.add_effect_with_name(
                'lockscreen-extension-desaturate',
                new Clutter.DesaturateEffect({ factor: this._grayscaleAnim?.get_value() || 0.0 })
            );
        }

        if (!this._backgroundCreated && this._fadeInDuration > 0)
            wrapper.opacity = 0;

        wrapper.add_child(cloneActor);
        wrapper.set_child_above_sibling(cloneActor, null);
        this._wrapperActors.push(wrapper);

        wrapper.set_position(monitor.x, monitor.y);
        wrapper.set_size(monitor.width, monitor.height);
        wrapper.set_clip_to_allocation(true);
        
        applyScaling(
            cloneActor, 
            this._scalingMode,
            this._player.w, this._player.h,
            monitor.width, monitor.height
        );

        if (isLastMonitor) {
            this._fadeAnim?.rebind(this._wrapperActors);
            this._grayscaleAnim?.rebind(this._wrapperActors);
            this._blurRadiusAnim?.rebind(this._wrapperActors);
            this._blurBrightnessAnim?.rebind(this._wrapperActors);
        }

        if (!this._backgroundCreated && isLastMonitor) {
            this._initLoginManager();

            if (this._actionOnBlank != ActionOnBlank.IGNORE) {
                this._initScreenBlankWatcher();
                // If the screen is blank dont start the playback and animation
                getPowerSaveMode().then((state) => {
                    if (state == 0) this._onScreenOn();
                })
            // Start video and animation immediately 
            } else {
                this._onScreenOn();
            }

            this._backgroundCreated = true;
        }
    }

    _resumePlayback() {
        const shouldPlay = !this._promptShown || !this._promptSettings?.[Keys.PROMPT_PAUSE];
        if (shouldPlay) {
            this._player.play();
            // Additional kick in case GPU/DRM compositor pipeline took a moment to resume
            // NOTE: Seems like an overkill. Commented out for now
            //GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            //    if (this._player && (!this._promptShown || !this._promptSettings?.[Keys.PROMPT_PAUSE]))
            //        this._player.play();
            //    return GLib.SOURCE_REMOVE;
            //});
        }
    }

    _onScreenOn() {
        this._fadeAnim?.play();
        this._resumePlayback();
    }

    _initLoginManager() {
        this._loginManager = LoginManager.getLoginManager();
        this._loginManager.connectObject('prepare-for-sleep', (_manager, aboutToSleep) => {
            if (!this._player) return;

            if (aboutToSleep) {
                if (this._actionOnBlank == ActionOnBlank.RESTART)
                    this._player.stopImmediately();
                else
                    this._player.pauseImmediately();
            } else {
                this._onScreenOn();
            }
        }, this);
    }

    _initScreenBlankWatcher() {
        // Track display power saving state (DPMS on/off) via Mutter DBus interface.
        // PowerSaveMode: 0 = on, 1 = standby, 2 = suspend, 3 = off.
        this._dbusSubId = Gio.DBus.session.signal_subscribe(
            'org.gnome.Mutter.DisplayConfig',
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            '/org/gnome/Mutter/DisplayConfig',
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, parameters) => {
                if (!this._player) return;
                const [_, changed] = parameters.deep_unpack();
                if (!('PowerSaveMode' in changed)) return;

                let rawMode = changed['PowerSaveMode'].deep_unpack();
                const mode = Number(rawMode);
                logInfo(`PowerSaveMode changed to ${mode}`);
                
                if (mode === 0) {
                    this._onScreenOn();
                }
                else {
                    if (this._actionOnBlank == ActionOnBlank.RESTART)
                        this._player.stopImmediately();
                    else if (this._actionOnBlank == ActionOnBlank.PAUSE)
                        this._player.pause();

                    this._fadeAnim?.pause();
                }
            }
        );
    }

    /**
     * User unlocked the screen. 
     * Stopping the videoplayblack and cleaning everything up
    */
    disable() {
        destroySleeps();

        this._fadeAnim?.destroy();
        this._blurBrightnessAnim?.destroy();
        this._blurRadiusAnim?.destroy();
        this._grayscaleAnim?.destroy();

        if (this._injectRetryId) {
            GLib.source_remove(this._injectRetryId);
            this._injectRetryId = 0;
        }
        this._injectAttempts = 0;

        // Checking if the dialog even exists
        if (Main.screenShield._dialog) {
            Main.screenShield._dialog._swipeTracker?.disconnectObject(this);
            Main.screenShield._dialog._authPrompt?.disconnectObject(this);
        }
        
        this._tapAction?.disconnectObject(this);
            
        this._resetWindowActor();

        if (this._window) {
            this._window.disconnectObject(this);
            this._window = null;
        }

        this._player?.destroy();
        this._player = null;

        this._injectionManager?.clear();
        this._injectionManager = null;

        this._loginManager?.disconnectObject(this);

        if (this._dbusSubId) {
            Gio.DBus.session.signal_unsubscribe(this._dbusSubId);
            this._dbusSubId = 0;
        }

        Object.values(this._wrapperActors).forEach(actor => {
            actor.disconnectObject(this);
            actor.remove_effect_by_name('lockscreen-extension-blur');
            actor.remove_effect_by_name('lockscreen-extension-desaturate');
            actor.destroy();
        });
        this._wrapperActors = [];
        this._settings = null;
    }
}
