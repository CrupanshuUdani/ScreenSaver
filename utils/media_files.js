import Gio from 'gi://Gio';

import { logWarn } from './logging.js';

const FILE_ATTRIBUTES = [
    'standard::name',
    'standard::fast-content-type',
    'standard::is-hidden',
].join(',');

function isSupportedMedia(contentType, includeImages) {
    if (!contentType)
        return false;

    return contentType.startsWith('video/') || contentType === 'image/gif' ||
        (includeImages && contentType.startsWith('image/'));
}

/**
 * Recursively lists the videos and GIFs (and static images if enabled) inside a directory.
 * Hidden files and folders are ignored.
 *
 * @param {string} dirPath - Absolute path of the directory
 * @param {boolean} [includeImages] - Also list static images
 * @returns {string[]} Absolute paths in natural (human) order
 */
export function listMediaFiles(dirPath, includeImages = false) {
    const paths = [];
    const pending = [Gio.File.new_for_path(dirPath)];

    while (pending.length > 0) {
        const dir = pending.pop();
        let enumerator = null;

        try {
            enumerator = dir.enumerate_children(
                `${FILE_ATTRIBUTES},standard::type`, Gio.FileQueryInfoFlags.NONE, null
            );

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_is_hidden())
                    continue;

                const child = dir.get_child(info.get_name());
                if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                    pending.push(child);
                    continue;
                }

                const contentType = info.get_attribute_string('standard::fast-content-type');
                if (isSupportedMedia(contentType, includeImages))
                    paths.push(child.get_path());
            }
        } catch (e) {
            logWarn(`Failed to read directory "${dir.get_path()}": ${e.message}`);
        } finally {
            enumerator?.close(null);
        }
    }

    return paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Turns the path saved in settings into a list of files to play.
 * A directory expands to the media files inside it, a regular
 * file is returned as is.
 *
 * @param {string} path - File or directory path
 * @param {boolean} [includeImages] - Also list static images inside a directory
 * @returns {string[]} Empty if the path is missing or has nothing to play
 */
export function resolveMediaPaths(path, includeImages = false) {
    if (!path)
        return [];

    const type = Gio.File.new_for_path(path)
        .query_file_type(Gio.FileQueryInfoFlags.NONE, null);

    if (type === Gio.FileType.DIRECTORY)
        return listMediaFiles(path, includeImages);
    if (type === Gio.FileType.REGULAR)
        return [path];

    return [];
}
