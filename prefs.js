import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { GeneralPage } from './ui/general_page.js';
import { AppearancePage } from './ui/appearance_page.js';
import { PromptPage } from './ui/prompt_page.js';
import { AboutPage } from './ui/about_page.js';

export default class ScreenSaverPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(500, 600);
        window.set_search_enabled(true);

        const settings = this.getSettings();
        window.add(new GeneralPage(settings));
        window.add(new AppearancePage(settings));
        window.add(new PromptPage(settings));
        window.add(new AboutPage(this.metadata, this.path));
    }
}
