import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import { Context } from './extension.js';

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
abstract class Cloak {
    protected status: Status;
    protected ctx: Context;
    protected overlay: Clutter.Actor;
    protected ownerId: number;
    private exportedObject?: Gio.DBusExportedObject;

    /**
     * Creates the objects and exports it on the DBus session bus
     * 
     * Before deleting the object, `close()` must be invoked to close DBus
     * and to cleanup the screen
     * 
     * @param {Meta.CursorTracker} cursorTracker - the tracker for the cursor to hide
     */
    constructor(context: Context, basePath: string) {
        this.interfaceSchema = GLib.file_get_contents(`${basePath}/schemas/org.mirolang.Cloak.xml`)[1].toString();
        this.status = Status.visible;
        this.ctx = context;

        this.overlay = new Clutter.Actor({
            background_color: Cogl.Color.from_string("#000")[1],
        })

        // Own the well-known name on the session bus
        this.ownerId = Gio.DBus.own_name(
            Gio.BusType.SESSION,
            'org.mirolang.Cloak',
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
        console.debug('Cloak [debug]: closing');
    }

    protected attach() {
        // Black out the screen
        this.ctx.actor.add_child(this.overlay);
        this.ctx.actor.set_child_above_sibling(this.overlay, null);
    }

    protected detach() {
        if (this.overlay.get_parent() === this.ctx.actor) {
            this.ctx.actor.remove_child(this.overlay);
        }
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
     * Optionally, implementers can use the same context object
     * as parameter for the constructor.
     * 
     * @param context Updated context
     */
    abstract renew(context: Context): void

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
        console.debug(`Cloak [debug]: DBus connection "${connection.get_unique_name()}" acquired`);
        // Make the object available before obtaining the well-known name
        this.exportedObject = Gio.DBusExportedObject.wrapJSObject(this.interfaceSchema, this);
        this.exportedObject.export(connection, '/org/mirolang/Cloak');
    }

    /**
     * Invoked when the DBus well-known name is acquired.
     * 
     * @param {Gio.DBusConnection} connection - the connection to the bus
     * @param {String} _name - the name requested
     */
    private onNameAcquired(_connection: Gio.DBusConnection, _name: String) {
        console.debug('Cloak [debug]: DBus name "org.mirolang.Cloak" acquired (DBus ready)');
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
        console.error('Cloak [Error]: DBus name "org.mirolang.Cloak" busy');
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
        console.debug('Cloak [debug]: Status read');
        return this.status;
    }

    /**
     * Turns the screen black and hides the cursor.
     * 
     * Does nothing if the screen is already hidden
     * and signals Status changed if necessary.
     */
    Hide() {
        console.debug('Cloak [debug]: Hide() invoked');
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
        console.debug('Cloak [debug]: Reveal() invoked');
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
        console.debug('Cloak [debug]: Toggle() invoked');
        switch (this.status) {
            case Status.hidden:
                this.revealImpl()
                console.debug('Cloak [debug]: Toggle() made visible');
                break;

            case Status.visible:
                this.hideImpl()
                console.debug('Cloak [debug]: Toggle() made hidden');
                break;
        }
        // Signal Status changed
        this.exportedObject?.emit_property_changed(
            'Status',
            GLib.Variant.new_uint32(this.status));
    }
}


/**
 * Cloak implementation for regular usage
 */
class CloakRegular extends Cloak {
    /**
     * Creates the objects and exports it on the DBus session bus
     * 
     * Before deleting the object, `close()` must be invoked to close DBus
     * and to cleanup the screen
     * 
     * @param {Context} context - context with actors and trackers
     * @param {string} basePath - the basepath of the extension where to find the interface schema
     */
    constructor(
        context: Context,
        basePath: string,
    ) {
        super(context, basePath);

        this.renew(context);
        this.overlay.reactive = true;
    }

    /**
     * Cleanup before deleting the object
     */
    close() {
        this.Reveal();
        this.overlay.destroy();
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
        this.detach();
        this.ctx.cursorTracker.uninhibit_cursor_visibility()
        this.ctx.seat.uninhibit_unfocus();
        this.ctx.compositor.enable_unredirect();
        this.status = Status.visible;
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
        this.attach();
        this.ctx.cursorTracker.inhibit_cursor_visibility();
        this.ctx.seat.inhibit_unfocus();
        this.ctx.compositor.disable_unredirect();
        this.status = Status.hidden;
    }

    /**
     * Implementation of renew.
     * 
     * To be called on display changes
     * 
     * @param {Context} context New context
     */
    renew(context: Context): void {
        this.detach();
        this.ctx = context;

        // Re-bind overlay to the new actor if it changed
        this.overlay.clear_constraints();
        this.overlay.add_constraint(new Clutter.BindConstraint({
            source: this.ctx.actor,
            coordinate: Clutter.BindCoordinate.ALL,
        }));

        // Eventually hide
        if (this.status == Status.hidden) {
            this.attach();
        }
    }
}

/**
 * Low latency Cloak implementation
 */
class CloakLowLatency extends Cloak {
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
     * @param {Context} context - context with actors and trackers
     * @param {string} basePath - the basepath of the extension where to find the interface schema
     */
    constructor(
        context: Context,
        basePath: string,
    ) {
        super(context, basePath);

        this.renew(context);
        this.overlay.opacity = 0;
        this.overlay.reactive = false;
        this.ctx.compositor.disable_unredirect();
    }

    /**
     * Cleanup before deleting the object
     * 
     * It also re-enables unredirect for performance and untracks 
     * the visibility changes in the cursor so it can keep.
     */
    close() {
        this.Reveal();
        // Reenable unredirect
        this.ctx.compositor.enable_unredirect();
        this.detach();
        this.overlay.destroy();
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
        this.overlay.opacity = 0;
        this.overlay.reactive = false;
        this.ctx.cursorTracker.uninhibit_cursor_visibility();
        this.ctx.seat.uninhibit_unfocus();
        this.status = Status.visible;
    }

    /**
     * Implementation of the hide logic.
     * 
     * It is not intended to be called directly,
     * only by the public Hide and Toggle methods.
     */
    protected hideImpl() {
        this.overlay.opacity = 255;
        this.overlay.reactive = true;
        // Bring back on top
        this.ctx.actor.set_child_above_sibling(this.overlay, null);
        this.ctx.cursorTracker.inhibit_cursor_visibility();
        this.ctx.seat.inhibit_unfocus();
        this.status = Status.hidden;
    }

    /**
     * Implementation of renew.
     * 
     * To be called on display changes
     * 
     * @param {Context} context New context
     */
    renew(context: Context): void {
        this.detach();
        this.ctx = context;

        // Re-bind overlay to the new actor if it changed
        this.overlay.clear_constraints();
        this.overlay.add_constraint(new Clutter.BindConstraint({
            source: this.ctx.actor,
            coordinate: Clutter.BindCoordinate.ALL,
        }));

        this.attach();
    }
}

export {
    Cloak,
    CloakRegular,
    CloakLowLatency
}