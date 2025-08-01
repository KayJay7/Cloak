import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

/**
 * Status of the screen
 */
enum Status {
    visible = 0,
    hidden = 1
}

/**
 * Abstract DBus proxy object
 */
abstract class Cloak<T> {
    protected status: Status;
    private exportedObject?: Gio.DBusExportedObject;
    protected ownerId: number;

    /**
     * Creates the objects and exports it on the DBus session bus
     * 
     * Before deleting the object, `close()` must be invoked to close DBus
     * and to cleanup the screen
     * 
     * @param {Meta.CursorTracker} cursorTracker - the tracker for the cursor to hide
     */
    constructor(basePath: string) {
        this.interfaceSchema = GLib.file_get_contents(`${basePath}/schemas/org.mirolang.Lookout.xml`)[1].toString();
        this.status = Status.visible;

        // Own the well-known name on the session bus
        this.ownerId = Gio.DBus.own_name(
            Gio.BusType.SESSION,
            'org.mirolang.Lookout',
            Gio.BusNameOwnerFlags.NONE,
            this.onBusAcquired.bind(this),
            this.onNameAcquired.bind(this),
            this.onNameLost.bind(this));
    }

    /**
     * Cleanup before deleting the object.
     * 
     * Must be overridden by subclasses.
     * 
     * Implementers *must* call `super.close()` at the end.
     */
    close() {
        // Close DBus
        this.exportedObject?.unexport();
        Gio.bus_unown_name(this.ownerId);
        console.debug('Lookout [debug]: closing');
    }

    /**
     * Implementation of the reveal logic.
     * 
     * Must be implemented by subclasses.
     * 
     * Assume the screen is hidden when called
     */
    protected abstract revealImpl(): void

    /**
     * Implementation of the hide logic.
     * 
     * Must be implemented by subclasses.
     * 
     * Assume the screen is visible when called
     */
    protected abstract hideImpl(): void

    /**
     * Function to renew the service on display changes.
     * 
     * Optionally, implementers can use the same config object
     * as parameter for the constructor.
     * 
     * @param config Updated configuration
     */
    abstract renew(config: T): void

    /////////////////
    // Callbacks
    /////////////////

    /**
     * Invoked when the DBus connection is acquired.
     * 
     * Exports the object immediately so it's available
     * for clients watching for the well-known name.
     * 
     * @param {Gio.DBusConnection} connection - the connection to the bus
     * @param {String} _name - the name requested
     */
    private onBusAcquired(connection: Gio.DBusConnection, _name: String) {
        console.debug(`Lookout [debug]: DBus connection "${connection.get_unique_name()}" acquired`);
        // Make the object available before obtaining the well-known name
        this.exportedObject = Gio.DBusExportedObject.wrapJSObject(this.interfaceSchema, this);
        this.exportedObject.export(connection, '/org/mirolang/Lookout');
    }

    /**
     * Invoked when the DBus well-known name is acquired.
     * 
     * @param {Gio.DBusConnection} connection - the connection to the bus
     * @param {String} _name - the name requested
     */
    private onNameAcquired(_connection: Gio.DBusConnection, _name: String) {
        console.debug('Lookout [debug]: DBus name "org.mirolang.Lookout" acquired (DBus ready)');
        // Nothing to do
    }

    /**
     * Invoked if the name is lost.
     * 
     * This should only happen if the name is already owned.
     * 
     * @param {Gio.DBusConnection} connection - the connection to the bus
     * @param {String} _name - the name requested
     */
    private onNameLost(_connection: Gio.DBusConnection, _name: String) {
        console.error('Lookout [Error]: DBus name "org.mirolang.Lookout" busy');
        // Nothing we can do
    }

    /////////////////
    // DBus
    /////////////////

    readonly interfaceSchema;

    /**
     * Status read-only property.
     * 
     * Available on DBus.
     * 
     * When the property changes it must be signaled on the exported object.
     */
    get Status() {
        console.debug('Lookout [debug]: Status read');
        return this.status;
    }

    /**
     * Turns the screen black and hides the cursor.
     * 
     * Does nothing if the screen is already hidden
     * and signals Status changed if necessary.
     */
    Hide() {
        console.debug('Lookout [debug]: Hide() invoked');
        // Do nothing if already hidden
        if (this.status === Status.visible) {
            this.hideImpl()
            // Signal Status changed
            this.exportedObject?.emit_property_changed(
                'Status',
                GLib.Variant.new_uint32(this.status));
        }
    }

    /**
     * Turns the screen back to normal.
     * 
     * Does nothing if the screen is already normal
     * and signals Status changed if necessary.
     */
    Reveal() {
        console.debug('Lookout [debug]: Reveal() invoked');
        // Do nothing if already visible
        if (this.status === Status.hidden) {
            this.revealImpl()
            // Signal Status changed
            this.exportedObject?.emit_property_changed(
                'Status',
                GLib.Variant.new_uint32(this.status));
        }
    }

    /**
     * Toggles the status of the screen.
     * 
     * Intended to reduce DBus roundtrips.
     * It is implemented without calling Hide and Reveal
     */
    Toggle() {
        console.debug('Lookout [debug]: Toggle() invoked');
        switch (this.status) {
            case Status.hidden:
                this.revealImpl()
                console.debug('Lookout [debug]: Toggle() made visible');
                break;

            case Status.visible:
                this.hideImpl()
                console.debug('Lookout [debug]: Toggle() made hidden');
                break;
        }
        // Signal Status changed
        this.exportedObject?.emit_property_changed(
            'Status',
            GLib.Variant.new_uint32(this.status));
    }
}

class StandardConfig {
    actor: Clutter.Actor;
    compositor: Meta.Compositor;
    cursorTracker: Meta.CursorTracker;

    constructor(actor: Clutter.Actor, compositor: Meta.Compositor, cursorTracker: Meta.CursorTracker) {
        this.actor = actor;
        this.compositor = compositor;
        this.cursorTracker = cursorTracker;
    }
}

/**
 * Cloak implementation for regular usage
 */
class CloakRegular extends Cloak<StandardConfig> {
    private actor: Clutter.Actor;
    private compositor: Meta.Compositor;
    private cursorTracker: Meta.CursorTracker;
    private effect: Clutter.BrightnessContrastEffect;
    private cursorWatcherId = 0;

    /**
     * Creates the objects and exports it on the DBus session bus
     * 
     * Before deleting the object, `close()` must be invoked to close DBus
     * and to cleanup the screen
     * 
     * @param {string} basePath - the basepath of the extension where to find the interface schema
     * @param {Clutter.Actor} actor - the main actor to hide
     * @param {Meta.Compositor} compositor - the compositor to disable unredirect on
     * @param {Meta.CursorTracker} cursorTracker - the tracker for the cursor to hide
     */
    constructor(
        basePath: string,
        config: StandardConfig,
        // actor: Clutter.Actor,
        // compositor: Meta.Compositor,
        // cursorTracker: Meta.CursorTracker,
    ) {
        super(basePath);
        this.status = Status.visible;
        this.actor = config.actor;
        this.compositor = config.compositor;
        this.cursorTracker = config.cursorTracker;

        // Create the effect only once
        this.effect = new Clutter.BrightnessContrastEffect();
        this.effect.set_brightness(-1);
        this.effect.set_contrast(0);
    }

    /**
     * Cleanup before deleting the object
     */
    close() {
        // Fix the screen
        this.Reveal();
        // Close DBus
        super.close();
    }

    /**
     * Implementation of the reveal logic.
     * 
     * It is not intended to be called directly,
     * only by the public Reveal and Toggle methods.
     * 
     * It also re-enables unredirect for performance and untracks 
     * the visibility changes in the cursor so it can keep.
     */
    protected revealImpl() {
        this.status = Status.visible;
        // Reenable unredirect
        this.compositor.enable_unredirect();
        // Reveal the screen
        this.actor.remove_effect(this.effect);
        // Stop keeping the cursor hidden
        this.cursorTracker.disconnect(this.cursorWatcherId)
    }

    /**
     * Implementation of the hide logic.
     * 
     * It is not intended to be called directly,
     * only by the public Hide and Toggle methods.
     * 
     * It also disables unredirect so it works for fullscreen windows
     * and tracks the visibility changes in the cursor so it can keep
     * the cursor invisible.
     */
    protected hideImpl() {
        this.status = Status.hidden;
        // Disable unredirect
        this.compositor.disable_unredirect();
        // Black out the screen
        this.actor.add_effect(this.effect);
        // Make cursor permanently invisible
        this.cursorWatcherId = this.cursorTracker.connect(
            'visibility-changed',
            this.onVisibilityChanged.bind(this));
        this.cursorTracker.set_pointer_visible(false);
    }

    /**
     * Implementation of renew.
     * 
     * To be called on display changes
     * 
     * @param {StandardConfig} config New configuration
     */
    renew(config: StandardConfig): void {
        let oldStatus = this.status

        // Cleanup old config
        this.revealImpl()

        // New config
        this.actor = config.actor
        this.compositor = config.compositor;
        this.cursorTracker = config.cursorTracker;

        //eventually hide
        if (oldStatus == Status.hidden) {
            this.hideImpl()
        }
    }

    /////////////////
    // Callbacks
    /////////////////

    /**
     * Invoked when the cursor being watched visibility changes.
     * 
     * @param {Meta.CursorTracker} tracker - the cursor tracker being watched
     */
    private onVisibilityChanged(tracker: Meta.CursorTracker) {
        // Make the pointer invisible, but only if made visible by something else
        if (tracker.get_pointer_visible()) {
            tracker.set_pointer_visible(false);
        }
    }
}

/**
 * Low latency Cloak implementation
 */
class CloakLowLatency extends Cloak<StandardConfig> {
    private actor: Clutter.Actor;
    private compositor: Meta.Compositor;
    private cursorTracker: Meta.CursorTracker;
    private effect: Clutter.BrightnessContrastEffect;
    private cursorWatcherId = 0;

    /**
     * Creates the objects and exports it on the DBus session bus
     * 
     * Before deleting the object, `close()` must be invoked to close DBus
     * and to cleanup the screen.
     * 
     * It also disables unredirect so it works for fullscreen windows
     * and tracks the visibility changes in the cursor so it can keep
     * the cursor invisible.
     * 
     * @param {string} basePath - the basepath of the extension where to find the interface schema
     * @param {Clutter.Actor} actor - the main actor to hide
     * @param {Meta.Compositor} compositor - the compositor to disable unredirect on
     * @param {Meta.CursorTracker} cursorTracker - the tracker for the cursor to hide
     */
    constructor(
        basePath: string,
        config: StandardConfig,
        // actor: Clutter.Actor,
        // compositor: Meta.Compositor,
        // cursorTracker: Meta.CursorTracker,
    ) {
        super(basePath);
        this.status = Status.visible;
        this.actor = config.actor;
        this.compositor = config.compositor;
        this.cursorTracker = config.cursorTracker;

        // Create the effect only once
        this.effect = new Clutter.BrightnessContrastEffect();
        // this.effect.set_brightness(0);
        this.effect.set_contrast(0);
        this.effect.set_brightness(-0.5);


        // Disable unredirect
        this.compositor.disable_unredirect();
        // Black out the screen
        // this.actor.add_effect(this.effect);
        // Make cursor permanently invisible
        this.cursorWatcherId = this.cursorTracker.connect(
            'visibility-changed',
            this.onVisibilityChanged.bind(this));
    }

    /**
     * Cleanup before deleting the object
     * 
     * It also re-enables unredirect for performance and untracks 
     * the visibility changes in the cursor so it can keep.
     */
    close() {
        // Fix the screen
        this.Reveal();
        // Reenable unredirect
        this.compositor.enable_unredirect();
        // Reveal the screen
        // this.actor.remove_effect(this.effect);
        // Stop keeping the cursor hidden
        this.cursorTracker.disconnect(this.cursorWatcherId)
        // Close DBus
        super.close();
    }

    /**
     * Implementation of the reveal logic.
     * 
     * It is not intended to be called directly,
     * only by the public Reveal and Toggle methods.
     */
    protected revealImpl() {
        this.status = Status.visible;
        // this.effect.set_brightness(0);
        this.actor.remove_effect(this.effect);
    }

    /**
     * Implementation of the hide logic.
     * 
     * It is not intended to be called directly,
     * only by the public Hide and Toggle methods.
     */
    protected hideImpl() {
        this.status = Status.hidden;
        // this.effect.set_brightness(-1);
        this.actor.add_effect(this.effect);
        this.cursorTracker.set_pointer_visible(false);
    }

    /**
     * Implementation of renew.
     * 
     * To be called on display changes
     * 
     * @param {StandardConfig} config New configuration
     */
    renew(config: StandardConfig): void {
        // Cleanup old config (similar to `close()`)
        this.compositor.enable_unredirect();
        this.actor.remove_effect(this.effect);
        this.cursorTracker.disconnect(this.cursorWatcherId)

        // New config
        this.actor = config.actor
        this.compositor = config.compositor;
        this.cursorTracker = config.cursorTracker;

        // Reactivate cloak (similar to `constructor()`)
        this.compositor.disable_unredirect();
        this.cursorWatcherId = this.cursorTracker.connect(
            'visibility-changed',
            this.onVisibilityChanged.bind(this));
        if (this.status == Status.hidden) {
            this.actor.add_effect(this.effect);
        }
    }

    /////////////////
    // Callbacks
    /////////////////

    /**
     * Invoked when the cursor being watched visibility changes.
     * 
     * @param {Meta.CursorTracker} tracker - the cursor tracker being watched
     */
    private onVisibilityChanged(tracker: Meta.CursorTracker) {
        // Make the pointer invisible,
        // but only if hidden by us
        // and made visible by something else
        if (tracker.get_pointer_visible() &&
            this.status === Status.hidden) {
            tracker.set_pointer_visible(false);
        }
    }
}

export {
    Cloak,
    StandardConfig,
    CloakRegular,
    CloakLowLatency
}