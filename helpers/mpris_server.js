import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { logWarn } from '../utils/logging.js';

const BUS_NAME = 'org.mpris.MediaPlayer2.LiveLockScreen';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const TRACK_PATH = '/org/gnome/shell/extensions/LiveLockScreen/Track';
const IDENTITY = 'Live Lock Screen';

const ROOT_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
</node>`;

const PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek">
      <arg direction="in" type="x" name="Offset"/>
    </method>
    <method name="SetPosition">
      <arg direction="in" type="o" name="TrackId"/>
      <arg direction="in" type="x" name="Position"/>
    </method>
    <method name="OpenUri">
      <arg direction="in" type="s" name="Uri"/>
    </method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Rate" type="d" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`;

/**
 * Exposes the lock screen video as an MPRIS player on the session bus,
 * so media keys and MPRIS clients (playerctl, KDE Connect, ...) can control it.
 *
 * Only reports commands, what to do with the player is up to the caller:
 *  - onPlay(), onPause(), onPlayPause(), onStop()
 *  - onNext(), onPrevious()
 *
 * The caller keeps it up to date with setPlaying() and setTrack().
 * Position, seeking, rate, volume and opening URIs are not supported.
 *
 * NOTE: D-Bus properties are read straight from the plain objects below
 */
export class MprisServer {
    constructor({
        canGoNext = false, canGoPrevious = false,
        onPlay, onPause, onPlayPause, onStop,
        onNext, onPrevious,
    }) {
        this._trackCount = 0;

        const root = {
            Raise() {},
            Quit() {},
            CanQuit: false,
            CanRaise: false,
            HasTrackList: false,
            Identity: IDENTITY,
            SupportedUriSchemes: [],
            SupportedMimeTypes: [],
        };

        this._player = {
            Next: () => onNext?.(),
            Previous: () => onPrevious?.(),
            Play: () => onPlay?.(),
            Pause: () => onPause?.(),
            PlayPause: () => onPlayPause?.(),
            Stop: () => onStop?.(),
            Seek() {},
            SetPosition() {},
            OpenUri() {},

            PlaybackStatus: 'Paused',
            Metadata: { 'mpris:trackid': new GLib.Variant('o', `${TRACK_PATH}/0`) },
            Rate: 1.0,
            Volume: 1.0,
            MinimumRate: 1.0,
            MaximumRate: 1.0,
            CanGoNext: canGoNext,
            CanGoPrevious: canGoPrevious,
            CanPlay: true,
            CanPause: true,
            CanSeek: false,
            CanControl: true,
        };

        this._rootImpl = Gio.DBusExportedObject.wrapJSObject(ROOT_IFACE, root);
        this._playerImpl = Gio.DBusExportedObject.wrapJSObject(PLAYER_IFACE, this._player);

        this._rootImpl.export(Gio.DBus.session, OBJECT_PATH);
        this._playerImpl.export(Gio.DBus.session, OBJECT_PATH);

        this._ownerId = Gio.bus_own_name_on_connection(
            Gio.DBus.session,
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            null,
            () => logWarn(`MprisServer: could not own ${BUS_NAME}, media controls disabled`)
        );
    }

    setPlaying(playing) {
        this._setProperty('PlaybackStatus', 's', playing ? 'Playing' : 'Paused');
    }

    setTrack(path) {
        const file = Gio.File.new_for_path(path);

        this._setProperty('Metadata', 'a{sv}', {
            // A new id per track, so clients notice the change even for the same file
            'mpris:trackid': new GLib.Variant('o', `${TRACK_PATH}/${++this._trackCount}`),
            'xesam:title': new GLib.Variant('s', file.get_basename()),
            'xesam:url': new GLib.Variant('s', file.get_uri()),
        });
    }

    _setProperty(name, type, value) {
        if (this._player[name] === value)
            return;

        this._player[name] = value;
        this._playerImpl?.emit_property_changed(name, new GLib.Variant(type, value));
    }

    destroy() {
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }

        this._playerImpl?.unexport();
        this._playerImpl = null;
        this._rootImpl?.unexport();
        this._rootImpl = null;
    }
}
