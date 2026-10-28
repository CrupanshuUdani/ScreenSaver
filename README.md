<p align="center">
  <img src="https://img.shields.io/github/stars/rmacordeiro/ScreenSaver">
  <img src="https://img.shields.io/github/license/rmacordeiro/ScreenSaver">
  <img alt="GNOME Shell" src="https://img.shields.io/badge/GNOME_Shell-46%2B-4A86CF?logo=gnome&logoColor=white"/>
  <img src="https://img.shields.io/badge/status-active-success">
</p>

<p align="center">
  <img src="icon.png" width="128" height="128" alt="ScreenSaver icon">
</p>

# ScreenSaver

Current release: v1.2.0

A GNOME Shell extension that rotates images as your lock screen background.

ScreenSaver focuses on a single goal: showing still images on the lock screen.

It is designed to be simple, lightweight, and reliable.

## Features

- 🖼️ Rotate images from a selected folder in random order
- 📁 Recursive image discovery across the selected folder and nested folders
- 🔁 Loop support
- 🎨 Slideshow scaling modes (cover, fit, stretch)
- 🔒 Optional keep-screen-on behavior after manual lock, while still respecting the normal idle timeout
- 🌌 Configurable fade-in animation
- 🖥️ Multi-monitor support
- 🌫️ Blur effect with adjustable radius and brightness
- 🔑 Interactive behavior on password prompt (blur/brightness change, grayscale)

## Installation

### Install from GNOME Extensions

<a href="https://extensions.gnome.org/extension/10861/screensaver/">
  <img src="https://github.com/user-attachments/assets/d15de748-11b8-4a85-ad34-ec7786547b3c" width="250" alt="Install from GNOME Extensions">
</a>

> ⚠️ Due to the review process, the version on GNOME Extensions may lag behind the latest code in this repository.  
> For the newest features, it is recommended to install manually from this branch.

### Manual

1. Clone your fork and checkout the branch you want to test:

   ```bash
   git clone --branch <branch-name> --single-branch https://github.com/rmacordeiro/ScreenSaver.git ScreenSaver
   cd ScreenSaver
   ```
2. Copy to your extensions folder:

   ```bash
   cp -r ScreenSaver ~/.local/share/gnome-shell/extensions/screensaver@rmacordeiro
   ```
3. Compile the schema, log out and back in, then enable the extension:

   ```bash
   glib-compile-schemas schemas
   gnome-extensions enable screensaver@rmacordeiro
   ```
4. Open the extension preferences and select the top-level image folder that should be scanned.
   ScreenSaver will recursively scan that folder and all nested folders for supported images.

## Requirements

- GNOME Shell 46+
- No additional dependencies; images are rendered natively by GNOME Shell.

## Supported image formats

ScreenSaver scans for files with these extensions:

- `.jpg`
- `.jpeg`
- `.png`
- `.gif`
- `.webp`
- `.bmp`
- `.tif`
- `.tiff`

## Notes

- Images are displayed natively through GNOME Shell `St.Widget` layers; mpv is no longer required.
- The selected folder itself is scanned, not just its subfolders.
- If only one supported image is found, it stays on screen without rotating.

## Version notes

### v1.2.0

- Fixed unbounded memory growth when rotating through large image folders (#14).
- Added GNOME Shell 51 to the supported versions (static review found no removed or changed APIs in use; not yet tested on a live GNOME 51 session).

### v1.1.0

- Removed the mpv dependency entirely; slideshow playback now uses native GNOME Shell `St.Widget` layers with cross-fade transitions.
- Removed the missing-dependency preferences page and mpv availability checks.

### v1.0.5

- Fixed a compositor crash during unlock caused by destroying Mutter-owned window actors while the lock screen was tearing down.
- Removed direct MetaWindow kills from the player teardown path to avoid triggering Wayland compositor instability.
- Kept cleanup limited to extension-owned wrapper actors and cleared stale references so the unlock flow does not leave dangling handles behind.
- Hardened mpv IPC handling to avoid stale socket state and incorrect Uint8Array-to-string parsing during lock-screen startup.
- Prevented duplicate swipe signal connections and improved startup recovery when a stale `/tmp/screensaver-mpv.sock` file is present.

## Thank you

<a href="https://github.com/nick-redwill/LiveLockScreen">
  nick-redwill
</a>
<br>
<a href="https://github.com/rinzler69-wastaken/wack-sonoma-lockscreen">
  rinzler69
</a>
<br>
<a href="https://github.com/CrupanshuUdani/ScreenSaver">
  CrupanshuUdani
</a>

## Development

This project is developed with the assistance of AI tools. All changes are planned or approved by the author, and all AI-generated code is reviewed and tested before it is merged.

## Support

If you enjoy this extension, consider buying me a tea 🍵 (I’m not really a coffee person :D)

<p align="center">
  <a href="https://www.buymeacoffee.com/rmacordeiro">
    <img src="https://github.com/user-attachments/assets/3b58a7fc-e605-4742-94e9-0bf3144c5021" width="200"/>
  </a>
</p>

## License

AGPL-3.0
