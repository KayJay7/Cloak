# Lookout Zigbee Gateway

```
usage: lookout [-h] [--radio {ezsp,znp,deconz,zigate,xbee}] [--baud BAUD] [--flow-control {software,hardware}] [--pair [SECONDS]] [--db PATH] [--only-open | --only-close] [-v] [-vv]
               MODEL DEVICE

ZHA Door Sensor Listener

positional arguments:
  MODEL                 the model of the zigbee device to listen for
  DEVICE                path to the device (e.g., /dev/ttyUSB0 or COM3)

options:
  -h, --help            show this help message and exit
  --radio {ezsp,znp,deconz,zigate,xbee}
                        the bellows radio type (default: ezsp)
  --baud BAUD           baud rate for the serial connection (default: 115200)
  --flow-control {software,hardware}
                        (default: no flow control)
  --pair [SECONDS]      pair mode, optionally for the given number of seconds (default: 30)
  --db PATH             path to the database file where paired devices are stored (default: zigbee.db)
  --only-open           cloak on open events only
  --only-close          cloak on close events only
  -v, --version         show program's version number and exit
  -vv, --verbose        enable verbose logging
```
