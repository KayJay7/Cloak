import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Cloak, CloakRegular, CloakLowLatency, StandardConfig } from './cloak.js';
// import ServiceMenu from './serviceMenu.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Modes of operation, each corresponds to a different Cloak implementation.
 * 
 * @enum {REGULAR} - Regularly left enabled, no idle cost
 * @enum {LOW_LATENCY} - Faster hiding/revealing, at the cost of idle performance
 */
enum Modes {
    REGULAR = 0,
    LOW_LATENCY = 1
}

function createStandardConfig(): StandardConfig {
    let actor = global.stage;
    let compositor = global.compositor;
    let cursorTracker = global.backend.get_cursor_tracker();
    return new StandardConfig(actor, compositor, cursorTracker);
}

/**
 * Creates a service object according to `mode`.
 * 
 * @param {Modes} mode - mode of operation 
 * @returns {Cloak} - New service object
 */
function createService(mode: Modes): Cloak<StandardConfig> {
    // Fetching service constructor options 
    let basePath = `${Extension.lookupByUUID("lookout@mirolang.org")?.path}`;
    let config = createStandardConfig()

    // Select correct implementation
    switch (mode) {
        default:
            console.debug(`Lookout [debug]: Unsupported mode "${mode}", falling back to "Regular"`);
        case Modes.REGULAR:
            console.debug('Lookout [debug]: Regular mode');
            return new CloakRegular(basePath, config);
        case Modes.LOW_LATENCY:
            console.debug('Lookout [debug]: Low latency mode');
            return new CloakLowLatency(basePath, config);
    }
}

/**
 * Main extension class.
 */
export default class Lookout extends Extension {
    private gsettings?: Gio.Settings;
    private cloak?: Cloak<StandardConfig>;
    private windowManager = Main.wm;
    private layoutManager = Main.layoutManager;
    private displayWatcherId: number = 0;
    // private toggleMenu = new ServiceMenu();
    // private keyBindingAction = 0; // Not needed?

    /**
     * Helper method to add simple keybindings.
     * 
     * The keybindings must be removed using removeKeybinding.
     * 
     * @param name the key for binding the GSettings object
     * @param handler the callback function to invoke when the keys are pressed
     */
    private addKeybinding(name: string, handler: Meta.KeyHandlerFunc) {
        // If it didn't fail, set the keybinding
        if (this.gsettings != null) {
            console.debug(`Lookout [debug]: Fetch shortcut "${name}": "${this.gsettings.get_value(name)?.deepUnpack()}" (might change later)`);
            // AddKeybinding returns a number
            // for now we only need it to check for success
            let code = this.windowManager.addKeybinding(
                name,
                this.gsettings,
                Meta.KeyBindingFlags.NONE,  // No special requirements
                Shell.ActionMode.ALL,       // Always available
                handler);                   // Run handler when pressed
            if (code === Meta.KeyBindingAction.NONE) {
                console.debug(`Lookout [debug]: Shortcut registered "${name}" with ID ${code}`);
            } else {
                console.error(`Lookout [error]: Failed to register shortcut "${name}", returned "Meta.KeyBindingAction.NONE`);
            }
        } else {
            console.error(`Lookout [error]: Failed to register shortcut "${name}", prefs not set`);
        }
    }

    /**
     * Helper function to remove keybindings added with addKeybinding.
     * 
     * @param name the key for binding the GSettings object
     */
    private removeKeybinding(name: string) {
        this.windowManager.removeKeybinding(name);
    }

    private renew() {
        this.cloak?.renew(createStandardConfig());

    }

    /**
     * Invoked when the extension is enabled.
     * 
     * Creates the service object (exported on DBus)
     * and binds the keyboard shortcut to `service.Reveal()`.
     */
    enable() {
        console.debug(`Lookout [debug]: ${Extension.lookupByUUID("lookout@mirolang.org")?.path}`);
        console.debug('Lookout [debug]: Enabling');

        // Get settings
        this.gsettings = this.getSettings();
        console.debug('Lookout [debug]: Fetched prefs GSettings object');

        // Creating service object
        let mode: Modes = this.gsettings.get_enum("mode");
        this.cloak = createService(mode);

        console.debug('Lookout [debug]: Service object created, DBus might not be acquired yet');

        // Watch for display changes
        this.displayWatcherId = this.layoutManager.connect(
            'monitors-changed',
            this.renew.bind(this));

        // Add keybindings
        this.addKeybinding('reveal-shortcut', this.cloak.Reveal.bind(this.cloak));
        this.addKeybinding('hide-shortcut', this.cloak.Hide.bind(this.cloak));
        this.addKeybinding('toggle-shortcut', this.cloak.Toggle.bind(this.cloak));
    }

    /**
     * Invoked when the extension is disabled.
     * 
     * Close the service object (unexporting it on DBus)
     * and unbinds the keyboard shortcut to `service.Reveal()`.
     */
    disable() {
        console.debug('Lookout [debug]: Disabling');
        // Remove keybindings
        this.removeKeybinding('reveal-shortcut');
        this.removeKeybinding('hide-shortcut');
        this.removeKeybinding('toggle-shortcut');
        // Destroy settings
        this.gsettings = undefined;
        // Close and destroy service
        this.layoutManager.disconnect(this.displayWatcherId);
        this.cloak?.close();
        this.cloak = undefined;
    }
}