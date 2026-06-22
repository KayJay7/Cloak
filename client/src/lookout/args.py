import argparse
import importlib.metadata
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from zha.application.const import RadioType

__all__ = ["args"]


def get_version():
    try:
        return importlib.metadata.version("lookout")
    except importlib.metadata.PackageNotFoundError:
        return "unknown (package not installed)"


_parser = argparse.ArgumentParser("lookout", description="ZHA Door Sensor Listener")

_parser.add_argument(
    "model",
    metavar="MODEL",
    help="the model of the zigbee device to listen for",
)

_parser.add_argument(
    "device",
    metavar="DEVICE",
    help="path to the device (e.g., /dev/ttyUSB0 or COM3)",
    type=Path,
)

_parser.add_argument(
    "--radio",
    default="ezsp",
    choices=[e.name for e in RadioType],
    help="the bellows radio type (default: ezsp)",
)

_parser.add_argument(
    "--baud",
    default=115200,
    metavar="BAUD",
    help="baud rate for the serial connection (default: 115200)",
    type=int,
)

_parser.add_argument(
    "--flow-control",
    choices=["software", "hardware"],
    default=None,
    help="(default: no flow control)",
)

_parser.add_argument(
    "--pair",
    nargs="?",
    const=30,
    metavar="SECONDS",
    help="pair mode, optionally for the given number of seconds (default: 30)",
    type=int,
)

_parser.add_argument(
    "--db",
    metavar="PATH",
    help="path to the database file where paired devices are stored (default: zigbee.db)",
    default="zigbee.db",
    type=Path,
)

mode_group = _parser.add_mutually_exclusive_group()

mode_group.add_argument(
    "--only-open",
    action="store_true",
    help="cloak on open events only",
)

mode_group.add_argument(
    "--only-close",
    action="store_true",
    help="cloak on close events only",
)

_parser.add_argument(
    "-v", "--version", action="version", version=f"%(prog)s {get_version()}"
)

_parser.add_argument(
    "-vv", "--verbose", action="store_true", help="enable verbose logging"
)


@dataclass
class Args:
    model: str
    device: Path
    radio: str
    baud: int
    flow_control: str | None
    pair: int
    db: Path
    only_open: bool
    only_close: bool
    verbose: bool


args = cast(Args, _parser.parse_args())
