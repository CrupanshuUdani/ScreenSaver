import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import { Keys } from '../enums.js';
import { logError } from '../utils/logging.js';

export var GeneralPage = GObject.registerClass(
class LLSGeneralPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
            name: 'GeneralPage',
        });

        this._settings = settings;

        const group = new Adw.PreferencesGroup();
        group.add(this._buildPathRow());
        group.add(this._buildActionOnEndRow());
        group.add(this._buildScalingRow());
        group.add(this._buildVolumeRow());
        group.add(this._buildBatteryRow());
        group.add(this._buildMprisRow());
        group.add(this._buildActionOnBlankRow());
        group.add(this._buildInfoLabel());
        this.add(group);

        const playlistGroup = new Adw.PreferencesGroup({
            title: 'Playlist',
            description: 'Only used when a folder is selected',
        });
        playlistGroup.add(this._buildPlaylistOrderRow());
        playlistGroup.add(this._buildPlaylistStartRow());
        playlistGroup.add(this._buildPlaylistFadeRow());
        this.add(playlistGroup);

        const mpvGroup = new Adw.PreferencesGroup({ title: 'Player' });
        mpvGroup.add(this._buildMpvProfileRow());
        mpvGroup.add(this._buildMpvCustomArgsRow());
        mpvGroup.add(this._buildMpvProfileNote());
        this.add(mpvGroup);
    }

    _buildPlaylistOrderRow() {
        // Order matches PlaylistOrder
        const row = new Adw.ComboRow({
            title: 'Order',
            subtitle: 'Shuffle plays every video once in a random order, ' +
                      'Random picks any video next',
            model: Gtk.StringList.new(['Sequential', 'Shuffle', 'Random']),
        });
        this._settings.bind(Keys.PLAYLIST_ORDER, row, 'selected', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _buildPlaylistStartRow() {
        // Order matches PlaylistStart
        const row = new Adw.ComboRow({
            title: 'Start with',
            model: Gtk.StringList.new(['First', 'Random', 'Last played']),
        });
        this._settings.bind(Keys.PLAYLIST_START, row, 'selected', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _buildPlaylistFadeRow() {
        const row = new Adw.ExpanderRow({
            title: 'Fade between videos',
            subtitle: 'Fades through black, hides the moment the next video loads',
            show_enable_switch: true,
        });
        this._settings.bind(Keys.PLAYLIST_FADE_ENABLED, row, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);

        const durationRow = new Adw.SpinRow({
            title: 'Fade duration',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 10000,
                step_increment: 50,
                value: this._settings.get_int(Keys.PLAYLIST_FADE_DURATION),
            }),
        });
        durationRow.add_suffix(new Gtk.Label({
            label: 'ms',
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        }));
        durationRow.connect('notify::value', r => {
            this._settings.set_int(Keys.PLAYLIST_FADE_DURATION, r.get_value());
        });

        row.add_row(durationRow);
        return row;
    }

    _buildMpvProfileRow() {
        // Order matches MpvProfile
        const row = new Adw.ComboRow({
            title: 'Playback profile',
            subtitle: 'Balanced and Efficient use less GPU at the cost of image quality',
            model: Gtk.StringList.new(['Quality', 'Balanced', 'Efficient']),
        });
        this._settings.bind(Keys.MPV_PROFILE, row, 'selected', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _buildMpvProfileNote() {
        return new Gtk.Label({
            label: 'Colors may look slightly different between profiles. ' +
                   'Efficient does not support transparency, ' +
                   'transparent GIFs will get a black background.',
            css_classes: ['dim-label', 'caption'],
            wrap: true,
            xalign: 0,
            margin_top: 6,
            margin_start: 12,
            margin_end: 12,
        });
    }

    _buildMpvCustomArgsRow() {
        const toText = () => this._settings.get_strv(Keys.MPV_CUSTOM_ARGS)
            .map(arg => GLib.shell_quote(arg))
            .join(' ');

        const row = new Adw.EntryRow({
            title: 'Custom MPV arguments (e.g. --deband=yes)',
            text: toText(),
            show_apply_button: true,
        });

        // Split like a shell would, so quoted values with spaces stay one argument
        row.connect('apply', r => {
            const text = r.get_text().trim();
            try {
                const args = text ? GLib.shell_parse_argv(text)[1] : [];
                this._settings.set_strv(Keys.MPV_CUSTOM_ARGS, args);
                r.remove_css_class('error');
            } catch (e) {
                r.add_css_class('error');
                logError(`Invalid custom MPV arguments: ${e.message}`);
            }
        });

        return row;
    }

    _buildScalingRow() {
        const row = new Adw.ComboRow({
            title: 'Scaling mode',
            subtitle: 'How the video is scaled to fit the screen',
            model: new Gtk.StringList({
                strings: ['Stretch', 'Fit', 'Cover'],
            }),
        });

        row.set_selected(this._settings.get_int(Keys.SCALING_MODE));
        row.connect('notify::selected', r => {
            this._settings.set_int(Keys.SCALING_MODE, r.selected);
        });

        return row;
    }

    _buildVolumeRow() {
        const row = new Adw.SpinRow({
            title: 'Volume',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                value: this._settings.get_int(Keys.AUDIO_VOLUME),
            }),
        });

        row.add_suffix(new Gtk.Label({
            label: '%',
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        }));

        row.connect('notify::value', r => {
            this._settings.set_int(Keys.AUDIO_VOLUME, r.get_value());
        });

        return row;
    }

    _buildActionOnEndRow() {
        const row = new Adw.ComboRow({
            title: 'On video end',
            subtitle: 'What to do when the video finishes playing',
            model: Gtk.StringList.new(['Loop', 'Pause', 'Next video']),
        });
        this._settings.bind(Keys.ACTION_ON_END, row, 'selected', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _buildBatteryRow() {
        const row = new Adw.SwitchRow({ title: 'Pause on battery' });
        this._settings.bind(Keys.PAUSE_ON_BATTERY, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _buildMprisRow() {
        const row = new Adw.SwitchRow({
            title: 'Media controls',
            subtitle: 'Control the video with media keys and other MPRIS clients',
        });
        this._settings.bind(Keys.MPRIS_ENABLED, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _buildActionOnBlankRow() {
        const row = new Adw.ComboRow({
            title: 'Action on blank',
            subtitle: 'What to do with the video when the screen goes black',
            model: Gtk.StringList.new(['Ignore', 'Pause video', 'Restart video', 'Next video']),
        });
        this._settings.bind(Keys.ACTION_ON_BLANK, row, 'selected', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _buildPathRow() {
        const path = this._settings.get_string(Keys.VIDEO_PATH);

        const row = new Adw.ActionRow({
            title: 'File',
            subtitle: path !== '' ? path : 'None',
        });
        row.set_use_markup(false);

        const fileButton = new Gtk.Button({
            label: 'Choose File',
            valign: Gtk.Align.CENTER,
        });
        fileButton.connect('clicked', () => this._openFileDialog(row));

        const folderButton = new Gtk.Button({
            label: 'Choose Folder',
            valign: Gtk.Align.CENTER,
        });
        folderButton.connect('clicked', () => this._openFolderDialog(row));

        row.add_suffix(fileButton);
        row.add_suffix(folderButton);

        return row;
    }

    _buildInfoLabel() {
        return new Gtk.Label({
            label: 'To keep the screen from blanking, use the ' +
                   '<a href="https://extensions.gnome.org/extension/1414/unblank/">' +
                   'Unblank lock screen</a> extension.',
            use_markup: true,
            css_classes: ['dim-label', 'caption'],
            wrap: true,
            xalign: 0,
            margin_top: 6,
            margin_start: 12,
            margin_end: 12,
        });
    }

    _openFolderDialog(row) {
        const dialog = new Gtk.FileDialog({ title: 'Select Folder with Videos or GIFs' });

        const videoPath = this._settings.get_string(Keys.VIDEO_PATH);
        if (videoPath) {
            const parent = Gio.File.new_for_path(videoPath).get_parent();
            if (parent)
                dialog.set_initial_folder(parent);
        }

        const window = row.get_root();
        dialog.select_folder(window, null, (d, result) => {
            try {
                const folder = d.select_folder_finish(result);
                if (folder) {
                    row.subtitle = folder.get_path();
                    this._settings.set_string(Keys.VIDEO_PATH, folder.get_path());
                } else {
                    row.subtitle = 'None';
                    this._settings.set_string(Keys.VIDEO_PATH, '');
                }
            } catch (e) {
                logError(`Error selecting folder: ${e}`);
            }
        });
    }

    _openFileDialog(row) {
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });

        const allFilter = new Gtk.FileFilter();
        allFilter.set_name('Video and GIF files');
        allFilter.add_mime_type('video/*');
        allFilter.add_mime_type('image/gif');

        // Separate filters so the user can narrow down if needed.
        const videoFilter = new Gtk.FileFilter();
        videoFilter.set_name('Video files');
        videoFilter.add_mime_type('video/*');

        const gifFilter = new Gtk.FileFilter();
        gifFilter.set_name('GIF images');
        gifFilter.add_mime_type('image/gif');

        filters.append(allFilter);
        filters.append(videoFilter);
        filters.append(gifFilter);

        const dialog = new Gtk.FileDialog({ title: 'Select Video or GIF File' });
        dialog.set_filters(filters);

        const videoPath = this._settings.get_string(Keys.VIDEO_PATH);
        if (videoPath) {
            const file = Gio.File.new_for_path(videoPath);
            const parent = file.get_parent();
            if (parent)
                dialog.set_initial_folder(parent);
        }

        const window = row.get_root();
        dialog.open(window, null, (d, result) => {
            try {
                const file = d.open_finish(result);
                if (file) {
                    row.subtitle = file.get_path();
                    this._settings.set_string(Keys.VIDEO_PATH, file.get_path());
                } else {
                    row.subtitle = 'None';
                    this._settings.set_string(Keys.VIDEO_PATH, '');
                }
            } catch (e) {
                logError(`Error selecting file: ${e}`);
            }
        });
    }
});