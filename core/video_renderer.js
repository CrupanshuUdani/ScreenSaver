import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

import { Direction } from '../enums.js';
import { applyScaling } from '../utils/actors.js';
import { SHELL_VERSION } from '../utils/shell_version.js';
import { logWarn } from '../utils/logging.js';

import { ActorAnimator } from '../helpers/actor_animator.js';

const BLUR_EFFECT_NAME = 'lockscreen-extension-blur';
const DESATURATE_EFFECT_NAME = 'lockscreen-extension-desaturate';

//NOTE: Adding small delay to prevent stuttering of video
const PROMPT_ANIM_DELAY = 5;

/**
 * Shows the player window as the lock screen background.
 * Owns the window actor, one wrapper (with a clone of the window)
 * per monitor, their effects and the animations of those effects.
 *
 * Does not touch the player or the dialog. The background group
 * is passed in by whoever creates the backgrounds.
 */
export class VideoRenderer {
    constructor({
        window, w = 0, h = 0,
        scalingMode,
        fadeInDuration = 0,
        blurRadius = 0,
        blurBrightness = 1,
        promptGrayscale = false,
        promptChangeBlur = false,
        promptBlurRadius = 0,
        promptBlurBrightness = 1,
        promptAnimDuration = 0,
        onReady,
    }) {
        //NOTE: if w/h are 0 the window is not resized and the clone is not scaled
        this._w = w;
        this._h = h;

        this._scalingMode = scalingMode;
        this._fadeInDuration = fadeInDuration;

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._blurRadius = blurRadius * themeContext.scale_factor;
        this._blurBrightness = blurBrightness;
        this._promptGrayscale = promptGrayscale;

        this._fadeAnim = null;
        this._grayscaleAnim = null;
        this._blurRadiusAnim = null;
        this._blurBrightnessAnim = null;
        this._promptChangeBlur = promptChangeBlur;

        // Called once, when backgrounds for all monitors were created for the first time
        this._onReady = onReady;

        this._wrapperActors = [];
        this._backgroundCreated = false;
        this._promptShown = false;

        this._initAnimators({
            promptChangeBlur, 
            promptBlurRadius: promptBlurRadius * themeContext.scale_factor,
            promptBlurBrightness, promptAnimDuration,
        });

        this._window = null;
        this._windowActor = null;
        this._attachWindow(window);
    }

    _initAnimators({ promptChangeBlur, promptBlurRadius, promptBlurBrightness, promptAnimDuration }) {
        const dstRadius = promptBlurRadius;
        const dstBrightness = dstRadius ? promptBlurBrightness : 1;

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
        if (this._promptGrayscale)
            this._grayscaleAnim = new ActorAnimator({
                actors: [],
                property: `@effects.${DESATURATE_EFFECT_NAME}.factor`,
                from: 0,
                to: 1,
                duration: promptAnimDuration
            });
        if (promptChangeBlur) {
            this._blurRadiusAnim = new ActorAnimator({
                actors: [],
                property: `@effects.${BLUR_EFFECT_NAME}.radius`,
                from: parseFloat(srcRadius),
                to: parseFloat(dstRadius),
                duration: promptAnimDuration
            });
            this._blurBrightnessAnim = new ActorAnimator({
                actors: [],
                property: `@effects.${BLUR_EFFECT_NAME}.brightness`,
                from: parseFloat(srcBrightness),
                to: parseFloat(dstBrightness),
                duration: promptAnimDuration
            });
        }
    }

    get _animators() {
        return [
            this._fadeAnim,
            this._grayscaleAnim,
            this._blurRadiusAnim,
            this._blurBrightnessAnim,
        ];
    }

    /**
     * Moves the player window out of the window group onto the globa.stage,
     * below everything, and hides it. Only its clones are visible
     */
    _attachWindow(window) {
        this._window = window;
        this._windowActor = window.get_compositor_private();

        this._window.connectObject('unmanaged', () => {
            this._resetWindowActor();
            this._window = null;
        }, this);
        this._windowActor?.connectObject('destroy', () => {
            this._windowActor = null;
        }, this);

        //NOTE: On gnome 48 and lower this functions accepts 1 argument
        if (SHELL_VERSION > 48)
            this._window.unmaximize();
        else
            this._window.unmaximize(true);

        this._resizeWindow();

        if (!this._windowActor) return;

        const parent = this._windowActor.get_parent();
        if (parent) parent.remove_child(this._windowActor);

        global.stage.add_child(this._windowActor);
        global.stage.set_child_below_sibling(this._windowActor, null);
        this._windowActor.opacity = 0;
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

    _hasSize() {
        return this._w > 0 && this._h > 0;
    }

    _resizeWindow() {
        if (!this._window || this._window.unmanaging || !this._hasSize())
            return;

        this._window.move_resize_frame(true, 0, 0, this._w, this._h);
    }

    /**
     * Updates the video size and resizes the window.
     * NOTE: Existing clones are not rescaled, recreate the backgrounds for that
     */
    setSize(w, h) {
        this._w = w;
        this._h = h;
        this._resizeWindow();
    }

    /**
     * Creates the wrapper for one monitor and adds it to the background group.
     * Meant to be called for every monitor in order, after the dialog
     * (re)created its own background for it
     * 
     * NOTE:
     * Should not be called directly. This function relies on unlockDialog
     * destroying existing backgroundGroups and containers inside of them
     * It must be connected to DialogInjector.onCreateBackgrounds callback
     * To actually update backgrounds call DialogInjector.recreateBackgrounds()
     */
    updateBackground(monitorIndex, backgroundGroup) {
        if (!this._window || this._window.unmanaging || !this._windowActor)
            return;

        this._resizeWindow();

        const monitors = Main.layoutManager.monitors;
        const monitor = monitors[monitorIndex];
        const isLastMonitor = monitorIndex === monitors.length - 1;

        // The dialog destroys all children of the background group before
        // recreating them, so our old wrappers are already gone at this point
        if (monitorIndex === 0)
            this._wrapperActors = [];

        const wrapper = new Clutter.Actor();
        wrapper.connectObject('destroy', () => {
            this._wrapperActors = this._wrapperActors.filter(a => a !== wrapper);
        }, this);

        backgroundGroup.add_child(wrapper);
        backgroundGroup.set_child_above_sibling(wrapper, null);

        const cloneActor = new Clutter.Clone({
            source: this._windowActor
        });

        //NOTE: Only applying this effect when its needed
        if (this._blurRadius > 0 || this._promptChangeBlur) {
            // Continue from the current animation state, the wrapper might be recreated mid-animation
            wrapper.add_effect(new Shell.BlurEffect({
                name: BLUR_EFFECT_NAME,
                radius: this._blurRadiusAnim?.get_value() ?? this._blurRadius,
                brightness: this._blurBrightnessAnim?.get_value() ?? this._blurBrightness,
            }));
        }
        
        // Adding color desaturation effect if needed
        if (this._promptGrayscale) {
            wrapper.add_effect_with_name(
                DESATURATE_EFFECT_NAME,
                new Clutter.DesaturateEffect({ factor: this._grayscaleAnim?.get_value() ?? 0.0 })
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

        if (this._hasSize()) {
            applyScaling(
                cloneActor,
                this._scalingMode,
                this._w, this._h,
                monitor.width, monitor.height
            );
        } else {
            logWarn('VideoRenderer: video size unknown, skipping scaling');
        }

        if (!isLastMonitor) return;

        this._animators.forEach(anim => anim?.rebind(this._wrapperActors));

        if (!this._backgroundCreated) {
            this._backgroundCreated = true;
            this._onReady?.();
        }
    }

    onPromptShown() {
        if (this._promptShown) return;
        this._promptShown = true;

        this._blurRadiusAnim?.play(Direction.FORWARD, PROMPT_ANIM_DELAY);
        this._blurBrightnessAnim?.play(Direction.FORWARD, PROMPT_ANIM_DELAY);
        this._grayscaleAnim?.play(Direction.FORWARD);
    }

    onClockShown() {
        if (!this._promptShown) return;
        this._promptShown = false;

        this._blurRadiusAnim?.play(Direction.BACKWARD, PROMPT_ANIM_DELAY);
        this._blurBrightnessAnim?.play(Direction.BACKWARD, PROMPT_ANIM_DELAY);
        this._grayscaleAnim?.play(Direction.BACKWARD);
    }

    /**
     * Starts (or continues) the fade in. Call when the screen turns on
     */
    fadeIn() {
        this._fadeAnim?.play();
    }

    /**
     * Pauses the fade in. Call when the screen goes blank
     */
    pauseFade() {
        this._fadeAnim?.pause();
    }

    destroy() {
        // Animators first, they hold transitions on the wrappers
        this._animators.forEach(anim => anim?.destroy());
        this._fadeAnim = null;
        this._grayscaleAnim = null;
        this._blurRadiusAnim = null;
        this._blurBrightnessAnim = null;

        this._wrapperActors.forEach(actor => {
            actor.disconnectObject(this);
            actor.remove_effect_by_name(BLUR_EFFECT_NAME);
            actor.remove_effect_by_name(DESATURATE_EFFECT_NAME);
            actor.destroy();
        });
        this._wrapperActors = [];
        this._resetWindowActor();

        if (this._window) {
            this._window.disconnectObject(this);
            this._window = null;
        }

        this._onReady = null;
    }
}
