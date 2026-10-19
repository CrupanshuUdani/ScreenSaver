<div align="center">

<img src="icon.png" width="128" height="128" alt="Live Lock Screen icon">

# Live Lock Screen

**Set any video as your GNOME lock screen background.**

<p>
  <img alt="GNOME Shell 46+" src="https://img.shields.io/badge/GNOME_Shell-46%2B-4A86CF?style=for-the-badge&logo=gnome&logoColor=white&labelColor=2B2B2B">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/nick-redwill/LiveLockScreen?style=for-the-badge&color=7E57C2&labelColor=2B2B2B"></a>
  <a href="https://github.com/nick-redwill/LiveLockScreen/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/nick-redwill/LiveLockScreen?style=for-the-badge&logo=github&color=FFB300&labelColor=2B2B2B"></a>
  <img alt="Status" src="https://img.shields.io/badge/Status-Experimental-FB8C00?style=for-the-badge&labelColor=2B2B2B">
</p>

<p>
  <a href="https://www.buymeacoffee.com/nick_redwill"><img alt="Buy me a tea" src="https://img.shields.io/badge/Buy_me_a_tea-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black"></a>
</p>

<p>
  <a href="#features">Features</a> •
  <a href="#todo">TODO</a> •
  <a href="#installation">Installation</a> •
  <a href="#requirements">Requirements</a> •
  <a href="#support">Support</a>
</p>

</div>

---

> [!WARNING]
> **This is the `experimental` branch.** It aims to solve issues present in the current stable version while improving performance and compatibility with older GNOME versions.
>
> Once testing is complete, this version will replace the current stable release.

> [!TIP]
> Looking for the stable version? Switch to the [`main`](https://github.com/nick-redwill/LiveLockScreen) branch.

## Features

| | Feature | |
|:-:|---|---|
| 🎬 | **Video playback** | Use any video file as the lock screen background |
| 🔁 | **Looping** | Seamless loop support |
| 🎨 | **Scaling modes** | Cover, fit, or stretch |
| 🔲 | **Transparency** | Transparent video support (RGBA) |
| ⏸️ | **Smart pause** | Automatically pauses on suspend and resumes on wake |
| 🌌 | **Fade-in** | Configurable fade-in animation |
| 🖥️ | **Multi-monitor** | Works across all your displays |
| 🌫️ | **Blur effect** | Adjustable blur radius and brightness |
| 🎞️ | **Frame rate control** | Configurable from 1 to 120 FPS |
| 🔊 | **Audio** | Optional audio output with volume control and fade-in/out |
| 🔑 | **Password prompt reactions** | Blur/brightness change, video pause, or grayscale when the prompt appears |

## TODO

- [ ] Test thoroughly
- [ ] Publish to extensions.gnome.org

## Installation

**1. Clone the experimental branch**

```bash
git clone -b experimental https://github.com/nick-redwill/LiveLockScreen.git
```

**2. Copy it to your extensions folder**

```bash
cp -r LiveLockScreen ~/.local/share/gnome-shell/extensions/live-lockscreen@nick-redwill
```

**3. Log out and back in, then enable the extension**

```bash
gnome-extensions enable live-lockscreen@nick-redwill
```

**4. Open the extension preferences and pick your video file** 🎉

## Requirements

- **GNOME Shell 46+**
- A playback backend: **MPV** (recommended) or **GStreamer** (fallback)

### MPV (recommended)

| Distro | Command |
|---|---|
| Fedora | `sudo dnf install mpv` |
| Ubuntu / Debian | `sudo apt install mpv` |
| Arch | `sudo pacman -S mpv` |

<details>
<summary><b>GStreamer (fallback) — click to expand</b></summary>

<br>

You'll need **both** the GStreamer plugins and the GTK4 video sink (`gtk4paintablesink`).

**GStreamer good/bad/ugly plugins**

```bash
# Fedora
sudo dnf install gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-plugins-ugly gstreamer1-plugins-bad-free-extras

# Ubuntu / Debian
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly

# Arch
sudo pacman -S gst-plugins-good gst-plugins-bad gst-plugins-ugly
```

**GStreamer GTK4 video sink**

```bash
# Fedora
sudo dnf install gstreamer1-plugin-gtk4

# Ubuntu 24.10+ / Debian (newer)
sudo apt install gstreamer1.0-gtk4

# Arch
sudo pacman -S gst-plugin-gtk4
```

> [!NOTE]
> On **Ubuntu 24.04**, `gstreamer1.0-gtk4` isn't available as a package. Either build it from source or download it from Launchpad.

</details>

## Support

If you enjoy this extension, consider buying me a tea. I'm not really a coffee person :D

<p align="center">
  <a href="https://www.buymeacoffee.com/nick_redwill">
    <img src="https://img.buymeacoffee.com/button-api/?text=Buy%20Me%20a%20Tea&emoji=%F0%9F%8D%B5&slug=nick_redwill&button_colour=FFDD00&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff" height="50" alt="Buy me a tea">
  </a>
</p>

## License

Released under the [AGPL-3.0](LICENSE) license.
