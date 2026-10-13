import { ScalingMode } from '../enums.js';

export function applyScaling(cloneActor, scalingMode, sourceW, sourceH, targetW, targetH) {
        // Keep the clone at native source size always; scaling is done via
        // set_scale() (transform-based) rather than set_size()

        // since set_size()-based scaling triggers a GNOME 48 repaint bug where
        // the clone's box only partially updates when scaled up from a smaller
        // source.set_scale() does not hit this bug.
        cloneActor.set_size(sourceW, sourceH);
        
        switch (scalingMode) {
            case ScalingMode.STRETCH: {
                // Fill the box exactly, ignore aspect ratio
                const scaleX = targetW / sourceW;
                const scaleY = targetH / sourceH;

                cloneActor.set_scale(scaleX, scaleY);
                cloneActor.set_position(0, 0);
                break;
            }

            case ScalingMode.FIT: {
                // Preserve aspect ratio, letterboxed to fit entirely within the box
                const scale = Math.min(targetW / sourceW, targetH / sourceH);
                const w = sourceW * scale;
                const h = sourceH * scale;

                cloneActor.set_scale(scale, scale);
                cloneActor.set_position(
                    (targetW - w) / 2,
                    (targetH - h) / 2
                );
                break;
            }
            default: {
                // Preserve aspect ratio, scale up to fully cover the box, crop overflow
                const scale = Math.max(targetW / sourceW, targetH / sourceH);
                const w = sourceW * scale;
                const h = sourceH * scale;

                cloneActor.set_scale(scale, scale);
                cloneActor.set_position(
                    (targetW - w) / 2,
                    (targetH - h) / 2
                );
                break;
            }
        }
    }