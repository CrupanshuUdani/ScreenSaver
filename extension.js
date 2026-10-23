import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Keys, ActionOnBlank } from './enums.js';

import { resolveMediaPaths } from './utils/media_files.js';
import { logWarn, logError } from './utils/logging.js';
import { destroySleeps } from './utils/base.js';
import { isMpvAvailable } from './utils/check_dependencies.js';
import { sendErrorNotification } from './utils/notifications.js';

import { DialogInjector } from './core/dialog_injector.js';
import { VideoRenderer } from './core/video_renderer.js';
import { MpvPlayerProcess } from './core/mpv_player_process.js';

import { SleepWatcher } from './helpers/sleep_watcher.js';
import { BatteryWatcher } from './helpers/battery_watcher.js';
import { ScreenBlankWatcher } from './helpers/screen_blank_watcher.js';

const WINDOW_TIMEOUT = 10000;

export default class LockscreenExtension extends Extension {
    enable() {
        this._promptShown = false;
        this._settings = this.getSettings();

        this._setup().catch((e) => {
            logError(`Unable to setup extension: ${e}`);
            this.disable();
        });
    }

    //TODO: Split into smaller functions
    async _setup() {
        if (!isMpvAvailable()) {
            sendErrorNotification(
                'Live Lock Screen needs MPV to play media. ' +
                'Install it with your package manager ' +
                '(see the README for details).'
            );
            logError('MPV not found in PATH');
            return;
        }

        const videoPath = this._settings.get_string(Keys.VIDEO_PATH);
        if (!videoPath) {
            logWarn('Video not set, falling back');
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

        this._actionOnBlank = this._settings.get_int(Keys.ACTION_ON_BLANK);
        this._disableOnBattery = this._settings.get_boolean(Keys.PAUSE_ON_BATTERY)

        const fadeInDuration = this._settings.get_int(Keys.FADE_IN_DURATION);
        const scalingMode = this._settings.get_int(Keys.SCALING_MODE);
        const blurRadius = this._settings.get_int(Keys.BLUR_RADIUS);
        const blurBrightness = this._settings.get_double(Keys.BLUR_BRIGHTNESS);

        const volume = this._settings.get_int(Keys.AUDIO_VOLUME) / 100;
        const actionOnEnd = this._settings.get_int(Keys.ACTION_ON_END);
        const useVideorate = this._settings.get_boolean(Keys.USE_VIDEORATE);
        const framerate = this._settings.get_int(Keys.FRAMERATE);
        const mpvProfile = this._settings.get_int(Keys.MPV_PROFILE);
        const mpvCustomArgs = this._settings.get_strv(Keys.MPV_CUSTOM_ARGS);

        this._promptPause = this._settings.get_boolean(Keys.PROMPT_PAUSE);
        const promptGrayscale = this._settings.get_boolean(Keys.PROMPT_GRAYSCALE);
        const promptChangeBlur = this._settings.get_boolean(Keys.PROMPT_CHANGE_BLUR);
        const promptBlurRadius = this._settings.get_int(Keys.PROMPT_BLUR_RADIUS);
        const promptBlurBrightness = this._settings.get_double(Keys.PROMPT_BLUR_BRIGHTNESS);
        const promptAnimDuration = this._settings.get_int(Keys.PROMPT_BLUR_ANIM_DURATION);

        this._setupWatchers();

        this._injector = new DialogInjector({
            onCreateBackgrounds: this._onCreateBackgrounds.bind(this),
            onPromptShow: this._onPromptShown.bind(this),
            onClockShow: this._onClockShown.bind(this),
        });
        await this._injector.inject();

        this._player = new MpvPlayerProcess({
            videoPaths,
            actionOnEnd,
            volume,
            useVideorate,
            framerate,
            configPath: this.dir.get_child('external').get_child('mpv.conf').get_path(),
            profile: mpvProfile,
            customArgs: mpvCustomArgs,
            onSizeChange: (w, h) => {
                if (!this._renderer) return;

                this._renderer.setSize(w, h);
                // If clones werent created till this point, create them now
                if (!this._renderer.clonesCreated())
                    this._injector.recreateBackgrounds();
            }
        });
        await this._player.run();
        const window = await this._player.waitForWindow(WINDOW_TIMEOUT);

        this._renderer = new VideoRenderer({
            window,
            w: this._player.w,
            h: this._player.h,
            scalingMode,
            fadeInDuration,
            blurRadius,
            blurBrightness,
            promptGrayscale,
            promptChangeBlur,
            promptAnimDuration,
            promptBlurBrightness,
            promptBlurRadius,
            onReady: this._onReady.bind(this) 
        });
        if (this._player.w)
            this._injector.recreateBackgrounds();
    }

    playVideo() {
        if (!this._player) return;

        //NOTE: Checking if something prevents playback
        // No blank watcher (ActionOnBlank.IGNORE) means the screen state is ignored
        const preventPlay = (
            (this._promptPause && this._promptShown) ||
            (this._disableOnBattery && this._batteryWatcher?.isOnBattery()) ||
            (this._blankWatcher && !this._blankWatcher.isOn)
        );

        if (!preventPlay)
            this._player.play();
    }

    _setupWatchers() {
        if (this._disableOnBattery) {
            this._batteryWatcher = new BatteryWatcher({
                onUnplugged: () => this._player?.pause(),
                onPlugged: () => this.playVideo(),
            });
        }

        this._sleepWatcher = new SleepWatcher({
            onSleep: () => {
                this._renderer?.pauseFade();
                if (this._actionOnBlank == ActionOnBlank.RESTART)
                    this._player?.stopImmediately();
                else
                    this._player?.pauseImmediately();
            },
            onResume: () => {
                this._renderer?.fadeIn();
                this.playVideo();
            }
        });

        if (this._actionOnBlank != ActionOnBlank.IGNORE) {
            this._blankWatcher = new ScreenBlankWatcher({
                onScreenOn: () => {
                    this._renderer?.fadeIn();
                    this.playVideo();
                },
                onScreenOff: () => {
                    this._renderer?.pauseFade();
                    if (this._actionOnBlank == ActionOnBlank.RESTART)
                        this._player?.stopImmediately();
                    if (this._actionOnBlank == ActionOnBlank.PAUSE)
                        this._player?.pause();
                }
            })
        }
    }

    _onCreateBackgrounds(monitorIndex, group) {
        this._renderer?.updateBackground(monitorIndex, group);
    }

    _onReady() {
        // If the screen is blank dont start the playback and animation,
        // the blank watcher starts them once the screen turns on
        if (this._blankWatcher && !this._blankWatcher.isOn)
            return;

        this._renderer?.fadeIn();
        this.playVideo();
    }

    _onPromptShown() {
        if (this._promptShown) return;
        this._promptShown = true;

        this._renderer?.onPromptShown();
        if (this._promptPause)
            this._player?.pause();
    }

    _onClockShown() {
        if (!this._promptShown) return;
        this._promptShown = false;

        this._renderer?.onClockShown();
        if (this._promptPause)
            this.playVideo();
    }

    /**
     * User unlocked the screen. 
     * Stopping the videoplayblack and cleaning everything up
    */
    disable() {
        destroySleeps();

        this._batteryWatcher?.destroy();
        this._sleepWatcher?.destroy();
        this._blankWatcher?.destroy();

        this._renderer?.destroy();
        this._player?.destroy();
        this._injector?.destroy();
    }
}
