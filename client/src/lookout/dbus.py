from __future__ import annotations
from sdbus import (
    DbusInterfaceCommonAsync,
    DbusPropertyEmitsChangeFlag,
    DbusUnprivilegedFlag,
    dbus_method_async,
    dbus_property_async,
    set_default_bus,
    sd_bus_open_user,
)

__all__ =["cloak"]

set_default_bus(sd_bus_open_user())


##### Atomatically generated, do not edit
##### uv run python -m sdbus gen-from-file ../gnome/cloak@mirolang.org/schemas/org.mirolang.Cloak.xml
class OrgMirolangCloakInterface(
    DbusInterfaceCommonAsync,
    interface_name="org.mirolang.Cloak",
):
    @dbus_method_async(
        flags=DbusUnprivilegedFlag,
        result_args_names=(),
    )
    async def hide(
        self,
    ) -> None:
        raise NotImplementedError

    @dbus_method_async(
        flags=DbusUnprivilegedFlag,
        result_args_names=(),
    )
    async def reveal(
        self,
    ) -> None:
        raise NotImplementedError

    @dbus_method_async(
        flags=DbusUnprivilegedFlag,
        result_args_names=(),
    )
    async def toggle(
        self,
    ) -> None:
        raise NotImplementedError

    @dbus_property_async(
        property_signature="u",
        flags=DbusPropertyEmitsChangeFlag,
    )
    def status(self) -> int:
        raise NotImplementedError


cloak = OrgMirolangCloakInterface.new_proxy("org.mirolang.Cloak", "/org/mirolang/Cloak")
