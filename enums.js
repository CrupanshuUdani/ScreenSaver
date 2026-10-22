export const Keys = {
    // Keeping the old "general-disable-on-battery" name for backward compatibility
    PAUSE_ON_BATTERY: "general-disable-on-battery",
    ACTION_ON_BLANK: "general-action-on-blank",
    ACTION_ON_END: "general-action-on-end",

    VIDEO_PATH: "background-video-path",
    SCALING_MODE: "background-video-scaling-mode",
    USE_VIDEORATE: "background-video-use-videorate",
    FRAMERATE: "background-video-framerate",
    FADE_IN_DURATION: "background-fade-in-duration",

    BLUR_RADIUS: "background-video-blur-radius",
    BLUR_BRIGHTNESS: "background-video-blur-brightness",

    AUDIO_VOLUME: "background-audio-volume",

    PROMPT_PAUSE: "prompt-pause-video",
    PROMPT_GRAYSCALE: "prompt-grayscale",
    PROMPT_CHANGE_BLUR: "prompt-change-blur",
    PROMPT_BLUR_RADIUS: "prompt-blur-radius",
    PROMPT_BLUR_BRIGHTNESS: "prompt-blur-brightness",
    PROMPT_BLUR_ANIM_DURATION: "prompt-blur-anim-duration",
};

export const ScalingMode = {
    STRETCH: 0,
    FIT: 1,
    COVER: 2,
};

export const ActionOnBlank = {
    IGNORE: 0,
    PAUSE: 1,
    RESTART: 2,
}

export const ActionOnEnd = {
    LOOP: 0,
    PAUSE: 1,
    NEXT: 2,
    RANDOM: 3,
}

/**
 * Playback direction for ActorAnimator
 * Matches Clutter.TimelineDirection.* values 
 */
export const Direction = Object.freeze({
    BACKWARD: 1,
    FORWARD: 0,
});