import Gio from 'gi://Gio';

import { logWarn } from './logging.js';

const FILE_ATTRIBUTES = [
    'standard::name',
    'standard::fast-content-type',
    'standard::is-hidden',
].join(',');

function isSupportedMedia(contentType) {
    return !!contentType &&
        (contentType.startsWith('video/') || contentType === 'image/gif');
}

/**
 * Lists the videos and GIFs placed directly inside a directory.
 * Sub-directories and hidden files are ignored.
 *
 * @param {string} dirPath - Absolute path of the directory
 * @returns {string[]} Absolute paths in natural (human) order
 */
export function listMediaFiles(dirPath) {
    const dir = Gio.File.new_for_path(dirPath);
    const paths = [];
    let enumerator = null;

    try {
        enumerator = dir.enumerate_children(
            FILE_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, null
        );

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_is_hidden())
                continue;

            const contentType = info.get_attribute_string('standard::fast-content-type');
            if (isSupportedMedia(contentType))
                paths.push(dir.get_child(info.get_name()).get_path());
        }
    } catch (e) {
        logWarn(`Failed to read directory "${dirPath}": ${e.message}`);
    } finally {
        enumerator?.close(null);
    }

    return paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Turns the path saved in settings into a list of files to play.
 * A directory expands to the media files inside it, a regular
 * file is returned as is.
 *
 * @param {string} path - File or directory path
 * @returns {string[]} Empty if the path is missing or has nothing to play
 */
export function resolveMediaPaths(path) {
    if (!path)
        return [];

    const type = Gio.File.new_for_path(path)
        .query_file_type(Gio.FileQueryInfoFlags.NONE, null);

    if (type === Gio.FileType.DIRECTORY)
        return listMediaFiles(path);
    if (type === Gio.FileType.REGULAR)
        return [path];

    return [];
}

function isSupportedImage(contentType) {
    return !!contentType && contentType.startsWith('image/') && contentType !== 'image/gif';
}

/**
 * Recursively lists the still images inside a folder (GIFs are handled as videos).
 * Hidden files and folders are ignored.
 *
 * @param {string} dirPath - Absolute path of the folder
 * @returns {string[]} Absolute paths in natural (human) order
 */
export function listImageFiles(dirPath) {
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
                if (info.get_file_type() === Gio.FileType.DIRECTORY)
                    pending.push(child);
                else if (isSupportedImage(info.get_attribute_string('standard::fast-content-type')))
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
